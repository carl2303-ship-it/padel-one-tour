/*
  # Fix teams insert policy for draft tournaments

  1. Changes
    - Update INSERT policies for teams table to allow registration in both 'draft' and 'active' tournaments
    - Previously only 'active' status was allowed, blocking registrations in draft tournaments

  2. Security
    - Still requires allow_public_registration = true
    - Still checks registration fee is 0 for free tournaments
*/

DROP POLICY IF EXISTS "Anonymous users can create teams in free public tournaments" ON teams;
DROP POLICY IF EXISTS "Authenticated can view public tournament teams" ON teams;
DROP POLICY IF EXISTS "Authenticated players can create teams in free public tournamen" ON teams;

CREATE POLICY "Anonymous users can create teams in free public tournaments"
  ON teams FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM tournaments t
      LEFT JOIN tournament_categories tc ON tc.id = teams.category_id
      WHERE t.id = teams.tournament_id
        AND t.allow_public_registration = true
        AND t.status IN ('draft', 'active')
        AND COALESCE(tc.registration_fee, t.registration_fee, 0) = 0
    )
  );

CREATE POLICY "Authenticated players can create teams in free public tournaments"
  ON teams FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM tournaments t
      LEFT JOIN tournament_categories tc ON tc.id = teams.category_id
      WHERE t.id = teams.tournament_id
        AND t.allow_public_registration = true
        AND t.status IN ('draft', 'active')
        AND COALESCE(tc.registration_fee, t.registration_fee, 0) = 0
    )
    OR
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = teams.tournament_id
        AND tournaments.user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated can view public tournament teams"
  ON teams FOR SELECT
  TO authenticated
  USING (is_tournament_public(tournament_id));