-- Align invitee_user_id with the owner of invitee_player_account_id (fixes wrong recipient).
-- Allow SELECT/UPDATE when the auth user owns the invitee player_account row (RLS).

update public.partner_match_invites i
set invitee_user_id = pa.user_id,
    updated_at = now()
from public.player_accounts pa
where pa.id = i.invitee_player_account_id
  and pa.user_id is not null
  and i.invitee_user_id is distinct from pa.user_id;

drop policy if exists "partner_invites_select_participants" on public.partner_match_invites;
create policy "partner_invites_select_participants"
  on public.partner_match_invites for select
  to authenticated
  using (
    requester_user_id = (select auth.uid())
    or invitee_user_id = (select auth.uid())
    or exists (
      select 1
      from public.player_accounts pa
      where pa.id = partner_match_invites.invitee_player_account_id
        and pa.user_id = (select auth.uid())
    )
  );

drop policy if exists "partner_invites_update_invitee" on public.partner_match_invites;
create policy "partner_invites_update_invitee"
  on public.partner_match_invites for update
  to authenticated
  using (
    requester_user_id = (select auth.uid())
    or invitee_user_id = (select auth.uid())
    or exists (
      select 1
      from public.player_accounts pa
      where pa.id = partner_match_invites.invitee_player_account_id
        and pa.user_id = (select auth.uid())
    )
  )
  with check (
    requester_user_id = (select auth.uid())
    or invitee_user_id = (select auth.uid())
    or exists (
      select 1
      from public.player_accounts pa
      where pa.id = partner_match_invites.invitee_player_account_id
        and pa.user_id = (select auth.uid())
    )
  );
