-- Partner confirmation workflow: acceptance is provisional until the requester confirms.

alter table public.partner_match_requests
  add column if not exists min_level numeric null,
  add column if not exists max_level numeric null;

alter table public.partner_match_requests
  drop constraint if exists partner_match_requests_side_preference_check;

alter table public.partner_match_requests
  add constraint partner_match_requests_side_preference_check
  check (side_preference in ('right', 'left', 'both'));

alter table public.partner_match_requests
  drop constraint if exists partner_match_requests_level_range_check;

alter table public.partner_match_requests
  add constraint partner_match_requests_level_range_check
  check (
    (min_level is null or min_level >= 0)
    and (max_level is null or max_level >= 0)
    and (min_level is null or max_level is null or min_level <= max_level)
  );

alter table public.teams
  add column if not exists registration_source text null,
  add column if not exists partner_match_invite_id uuid null,
  add column if not exists organizer_review_status text null;

alter table public.teams
  drop constraint if exists teams_registration_source_check;

alter table public.teams
  add constraint teams_registration_source_check
  check (registration_source is null or registration_source in ('partner_invite'));

alter table public.teams
  drop constraint if exists teams_organizer_review_status_check;

alter table public.teams
  add constraint teams_organizer_review_status_check
  check (organizer_review_status is null or organizer_review_status in ('pending', 'confirmed'));

alter table public.teams
  drop constraint if exists teams_partner_match_invite_id_fkey;

alter table public.teams
  add constraint teams_partner_match_invite_id_fkey
  foreign key (partner_match_invite_id)
  references public.partner_match_invites(id)
  on delete set null;

create unique index if not exists idx_teams_partner_match_invite_unique
  on public.teams(partner_match_invite_id)
  where partner_match_invite_id is not null;

create index if not exists idx_teams_partner_review
  on public.teams(tournament_id, organizer_review_status)
  where registration_source = 'partner_invite';

create index if not exists idx_partner_match_requests_level_range
  on public.partner_match_requests(tournament_id, min_level, max_level)
  where status = 'open';

-- Conservative backfill: only link an existing team when exactly one accepted/matched
-- invite maps to its two player accounts in the same tournament and category.
with candidate_matches as (
  select
    t.id as team_id,
    i.id as invite_id
  from public.teams t
  join public.players p1 on p1.id = t.player1_id
  join public.players p2 on p2.id = t.player2_id
  join public.partner_match_invites i
    on i.tournament_id = t.tournament_id
   and i.status = 'accepted'
   and (
     (i.requester_player_account_id = p1.player_account_id and i.invitee_player_account_id = p2.player_account_id)
     or
     (i.requester_player_account_id = p2.player_account_id and i.invitee_player_account_id = p1.player_account_id)
   )
   and i.category_id is not distinct from t.category_id
  join public.partner_match_requests r
    on r.id = i.request_id
   and r.status = 'matched'
  where t.partner_match_invite_id is null
    and p1.player_account_id is not null
    and p2.player_account_id is not null
),
team_unique as (
  select team_id, min(invite_id::text)::uuid as invite_id
  from candidate_matches
  group by team_id
  having count(*) = 1
),
invite_unique as (
  select invite_id, min(team_id::text)::uuid as team_id
  from candidate_matches
  group by invite_id
  having count(*) = 1
),
safe_matches as (
  select tu.team_id, tu.invite_id
  from team_unique tu
  join invite_unique iu
    on iu.invite_id = tu.invite_id
   and iu.team_id = tu.team_id
)
update public.teams t
set registration_source = 'partner_invite',
    partner_match_invite_id = sm.invite_id,
    organizer_review_status = 'pending'
from safe_matches sm
where t.id = sm.team_id;

drop policy if exists "Tournament organizers review partner teams" on public.teams;
create policy "Tournament organizers review partner teams"
  on public.teams for update
  to authenticated
  using (
    exists (
      select 1
      from public.tournaments tournament
      where tournament.id = teams.tournament_id
        and tournament.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.tournaments tournament
      where tournament.id = teams.tournament_id
        and tournament.user_id = (select auth.uid())
    )
  );

create or replace function public.confirm_partner_match_invite(
  p_invite_id uuid,
  p_requester_user_id uuid
)
returns table(team_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invite public.partner_match_invites%rowtype;
  v_request public.partner_match_requests%rowtype;
  v_requester public.player_accounts%rowtype;
  v_invitee public.player_accounts%rowtype;
  v_requester_player_id uuid;
  v_invitee_player_id uuid;
  v_team_id uuid;
  v_team_name text;
  v_seed integer;
begin
  if p_requester_user_id is null then
    raise exception 'Requester user is required';
  end if;

  select *
  into v_invite
  from public.partner_match_invites
  where id = p_invite_id
  for update;

  if not found then
    raise exception 'Invite not found';
  end if;

  if v_invite.requester_user_id <> p_requester_user_id then
    raise exception 'Only the requester can confirm this invite';
  end if;

  select *
  into v_request
  from public.partner_match_requests
  where id = v_invite.request_id
  for update;

  if not found then
    raise exception 'Partner request not found';
  end if;

  select t.id
  into v_team_id
  from public.teams t
  where t.partner_match_invite_id = v_invite.id;

  if v_team_id is not null then
    if v_invite.status = 'accepted' and v_request.status = 'matched' then
      return query select v_team_id;
      return;
    end if;
    raise exception 'Invite has an inconsistent existing team';
  end if;

  if v_invite.status <> 'accepted' then
    raise exception 'Invite must be accepted before confirmation';
  end if;
  if v_request.status <> 'open' then
    raise exception 'Partner request is not open';
  end if;

  select * into v_requester
  from public.player_accounts
  where id = v_invite.requester_player_account_id;
  select * into v_invitee
  from public.player_accounts
  where id = v_invite.invitee_player_account_id;

  if v_requester.id is null or v_invitee.id is null then
    raise exception 'Player account not found';
  end if;

  if exists (
    select 1
    from public.players p
    where p.tournament_id = v_invite.tournament_id
      and p.player_account_id in (v_requester.id, v_invitee.id)
  ) then
    raise exception 'One of the players is already registered';
  end if;

  insert into public.players (
    tournament_id, category_id, player_account_id, user_id, name, email, phone_number
  )
  values (
    v_invite.tournament_id, v_invite.category_id, v_requester.id,
    v_invite.requester_user_id, v_requester.name, v_requester.email,
    coalesce(v_requester.phone_number, '')
  )
  returning id into v_requester_player_id;

  insert into public.players (
    tournament_id, category_id, player_account_id, user_id, name, email, phone_number
  )
  values (
    v_invite.tournament_id, v_invite.category_id, v_invitee.id,
    v_invite.invitee_user_id, v_invitee.name, v_invitee.email,
    coalesce(v_invitee.phone_number, '')
  )
  returning id into v_invitee_player_id;

  v_team_name := v_requester.name || ' / ' || v_invitee.name;
  select coalesce(max(seed), 0) + 1
  into v_seed
  from public.teams
  where tournament_id = v_invite.tournament_id;

  insert into public.teams (
    tournament_id, category_id, name, player1_id, player2_id, seed,
    registration_source, partner_match_invite_id, organizer_review_status
  )
  values (
    v_invite.tournament_id, v_invite.category_id, v_team_name,
    v_requester_player_id, v_invitee_player_id, v_seed,
    'partner_invite', v_invite.id, 'pending'
  )
  returning id into v_team_id;

  update public.partner_match_requests
  set status = 'matched', updated_at = now()
  where id = v_request.id;

  update public.partner_match_invites
  set status = case when status = 'accepted' then 'cancelled' else 'expired' end,
      updated_at = now()
  where request_id = v_request.id
    and id <> v_invite.id
    and status in ('pending', 'accepted');

  return query select v_team_id;
end;
$$;

revoke all on function public.confirm_partner_match_invite(uuid, uuid) from public;
revoke all on function public.confirm_partner_match_invite(uuid, uuid) from anon;
revoke all on function public.confirm_partner_match_invite(uuid, uuid) from authenticated;
grant execute on function public.confirm_partner_match_invite(uuid, uuid) to service_role;
