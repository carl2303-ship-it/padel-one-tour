-- Convites como destinatário: só quem é dono de invitee_player_account_id (via player_accounts.user_id).
-- Remove o ramo "invitee_user_id = auth.uid()" isolado, que expunha linhas com UUID de convidado errado.

update public.partner_match_invites i
set invitee_user_id = pa.user_id,
    updated_at = now()
from public.player_accounts pa
where pa.id = i.invitee_player_account_id
  and pa.user_id is not null
  and i.invitee_user_id is distinct from pa.user_id;

delete from public.partner_match_invites
where requester_user_id = invitee_user_id;

drop policy if exists "partner_invites_select_participants" on public.partner_match_invites;
create policy "partner_invites_select_participants"
  on public.partner_match_invites for select
  to authenticated
  using (
    requester_user_id = (select auth.uid())
    or (
      requester_user_id is distinct from (select auth.uid())
      and exists (
        select 1
        from public.player_accounts pa
        where pa.id = partner_match_invites.invitee_player_account_id
          and pa.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "partner_invites_update_invitee" on public.partner_match_invites;
create policy "partner_invites_update_invitee"
  on public.partner_match_invites for update
  to authenticated
  using (
    requester_user_id = (select auth.uid())
    or (
      requester_user_id is distinct from (select auth.uid())
      and exists (
        select 1
        from public.player_accounts pa
        where pa.id = partner_match_invites.invitee_player_account_id
          and pa.user_id = (select auth.uid())
      )
    )
  )
  with check (
    requester_user_id = (select auth.uid())
    or (
      requester_user_id is distinct from (select auth.uid())
      and exists (
        select 1
        from public.player_accounts pa
        where pa.id = partner_match_invites.invitee_player_account_id
          and pa.user_id = (select auth.uid())
      )
    )
  );

alter table public.partner_match_invites
  drop constraint if exists partner_invites_requester_ne_invitee;

alter table public.partner_match_invites
  add constraint partner_invites_requester_ne_invitee
  check (requester_user_id <> invitee_user_id);
