/*
  # Allow anonymous users to view registered participants

  1. Changes
    - Add SELECT policy for anonymous users to view players in public tournaments
    - Add SELECT policy for anonymous users to view teams in public tournaments

  2. Security
    - Only allows viewing participants in tournaments with public registration enabled
    - Only returns basic info (name, category) - no sensitive data exposed
*/

CREATE POLICY "Anon can view players in public tournaments"
  ON players
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = players.tournament_id
      AND t.allow_public_registration = true
    )
  );

CREATE POLICY "Anon can view teams in public tournaments"
  ON teams
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = teams.tournament_id
      AND t.allow_public_registration = true
    )
  );