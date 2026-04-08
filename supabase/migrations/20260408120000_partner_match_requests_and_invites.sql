-- Partner matching requests/invites for Player app

create table if not exists public.partner_match_requests (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  category_id uuid null references public.tournament_categories(id) on delete set null,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  requester_player_account_id uuid not null references public.player_accounts(id) on delete cascade,
  side_preference text not null check (side_preference in ('right', 'left')),
  target_mode text not null check (target_mode in ('any', 'following')),
  status text not null default 'open' check (status in ('open', 'matched', 'cancelled', 'expired')),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_partner_match_requests_tournament on public.partner_match_requests(tournament_id);
create index if not exists idx_partner_match_requests_requester on public.partner_match_requests(requester_user_id);
create index if not exists idx_partner_match_requests_status on public.partner_match_requests(status);

create table if not exists public.partner_match_invites (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.partner_match_requests(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  category_id uuid null references public.tournament_categories(id) on delete set null,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  requester_player_account_id uuid not null references public.player_accounts(id) on delete cascade,
  invitee_user_id uuid not null references auth.users(id) on delete cascade,
  invitee_player_account_id uuid not null references public.player_accounts(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  accepted_at timestamptz null,
  declined_at timestamptz null,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(request_id, invitee_player_account_id)
);

create index if not exists idx_partner_match_invites_invitee on public.partner_match_invites(invitee_user_id, status);
create index if not exists idx_partner_match_invites_request on public.partner_match_invites(request_id);
create index if not exists idx_partner_match_invites_tournament on public.partner_match_invites(tournament_id);

alter table public.partner_match_requests enable row level security;
alter table public.partner_match_invites enable row level security;

drop policy if exists "partner_requests_select_own" on public.partner_match_requests;
create policy "partner_requests_select_own"
  on public.partner_match_requests for select
  to authenticated
  using (requester_user_id = auth.uid());

drop policy if exists "partner_requests_insert_own" on public.partner_match_requests;
create policy "partner_requests_insert_own"
  on public.partner_match_requests for insert
  to authenticated
  with check (requester_user_id = auth.uid());

drop policy if exists "partner_requests_update_own" on public.partner_match_requests;
create policy "partner_requests_update_own"
  on public.partner_match_requests for update
  to authenticated
  using (requester_user_id = auth.uid())
  with check (requester_user_id = auth.uid());

drop policy if exists "partner_invites_select_participants" on public.partner_match_invites;
create policy "partner_invites_select_participants"
  on public.partner_match_invites for select
  to authenticated
  using (requester_user_id = auth.uid() or invitee_user_id = auth.uid());

drop policy if exists "partner_invites_update_invitee" on public.partner_match_invites;
create policy "partner_invites_update_invitee"
  on public.partner_match_invites for update
  to authenticated
  using (invitee_user_id = auth.uid() or requester_user_id = auth.uid())
  with check (invitee_user_id = auth.uid() or requester_user_id = auth.uid());

