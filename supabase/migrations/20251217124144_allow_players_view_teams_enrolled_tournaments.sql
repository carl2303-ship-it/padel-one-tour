/*
  # Allow players to view teams in tournaments they are enrolled in

  1. Problem
    - Players can only see teams in public tournaments or tournaments they own
    - They cannot see teams in private tournaments where they are registered

  2. Solution
    - Add policy for authenticated users to view teams in tournaments they are enrolled in

  3. Changes
    - Add new SELECT policy for teams based on player enrollment
*/

CREATE POLICY "Players can view teams in tournaments they are enrolled in"
  ON teams
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM players p
      WHERE p.tournament_id = teams.tournament_id
      AND p.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM teams t2
      JOIN players p1 ON t2.player1_id = p1.id
      WHERE t2.tournament_id = teams.tournament_id
      AND p1.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM teams t2
      JOIN players p2 ON t2.player2_id = p2.id
      WHERE t2.tournament_id = teams.tournament_id
      AND p2.user_id = auth.uid()
    )
  );