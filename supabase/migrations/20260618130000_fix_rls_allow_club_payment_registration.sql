/*
  Fix: Allow player registration for tournaments with allow_club_payment = true.
  
  The migration 20260611100000 restricted anonymous INSERT to free tournaments only
  (all fees = 0), which broke the "pay at club" registration flow for paid tournaments.

  When a tournament has allow_club_payment = true, the organizer explicitly allows
  players to register and pay later at the club. The player's payment_status defaults
  to 'pending' and the club owner tracks payment manually.

  This migration:
  1. Creates a helper function that checks if a tournament allows public registration
     (free OR club payment enabled)
  2. Updates the anon INSERT policy to allow club-payment tournaments
  3. Updates the authenticated INSERT policy to allow club-payment tournaments
*/

-- Helper: check if tournament allows direct registration (free or pay-at-club)
CREATE OR REPLACE FUNCTION public.tournament_allows_direct_registration(
  p_tournament_id uuid,
  p_category_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tournaments t
    LEFT JOIN tournament_categories tc ON tc.id = p_category_id
    WHERE t.id = p_tournament_id
      AND t.allow_public_registration = true
      AND t.status IN ('draft', 'active')
      AND (
        t.allow_club_payment = true
        OR (
          COALESCE(tc.registration_fee, t.registration_fee, 0) = 0
          AND COALESCE(tc.member_price, t.member_price, 0) = 0
          AND COALESCE(tc.non_member_price, t.non_member_price, 0) = 0
        )
      )
  );
$$;

-- Update anon INSERT policy: allow free tournaments OR club-payment tournaments
DROP POLICY IF EXISTS "Anonymous users can create players in free public tournaments" ON players;
DROP POLICY IF EXISTS "Anon can insert players for public tournaments" ON players;

CREATE POLICY "Anon can insert players for public tournaments"
  ON players
  FOR INSERT
  TO anon
  WITH CHECK (
    tournament_id IS NULL
    OR tournament_allows_direct_registration(tournament_id, category_id) = true
  );

-- Update authenticated INSERT policy: same logic + tournament owner bypass
DROP POLICY IF EXISTS "Auth can insert players" ON players;

CREATE POLICY "Auth can insert players"
  ON players
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tournament_id IS NULL
    OR tournament_owned_by_user(tournament_id, auth.uid())
    OR (
      tournament_allows_direct_registration(tournament_id, category_id) = true
      AND (user_id IS NULL OR user_id = auth.uid())
    )
  );

-- Same fix for teams table (both anon and authenticated)
DROP POLICY IF EXISTS "Anonymous users can create teams in free public tournaments" ON teams;
DROP POLICY IF EXISTS "Anon can insert teams for public tournaments" ON teams;

CREATE POLICY "Anon can insert teams for public tournaments"
  ON teams
  FOR INSERT
  TO anon
  WITH CHECK (
    tournament_id IS NULL
    OR tournament_allows_direct_registration(tournament_id, category_id) = true
  );

DROP POLICY IF EXISTS "Authenticated players can create teams in free public tournaments" ON teams;

CREATE POLICY "Authenticated players can create teams in public tournaments"
  ON teams
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tournament_allows_direct_registration(tournament_id, category_id) = true
    OR EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = teams.tournament_id
        AND tournaments.user_id = auth.uid()
    )
  );
