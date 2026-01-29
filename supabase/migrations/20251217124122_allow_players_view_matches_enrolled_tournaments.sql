/*
  # Allow players to view matches in tournaments they are enrolled in

  1. Problem
    - Players can only see matches in public tournaments or tournaments they own
    - They cannot see matches in private tournaments where they are registered

  2. Solution
    - Add policy for authenticated users to view matches in tournaments they are enrolled in

  3. Changes
    - Add new SELECT policy for matches based on player enrollment
*/

CREATE POLICY "Players can view matches in tournaments they are enrolled in"
  ON matches
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM players p
      WHERE p.tournament_id = matches.tournament_id
      AND p.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM teams t
      JOIN players p1 ON t.player1_id = p1.id
      WHERE t.tournament_id = matches.tournament_id
      AND p1.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM teams t
      JOIN players p2 ON t.player2_id = p2.id
      WHERE t.tournament_id = matches.tournament_id
      AND p2.user_id = auth.uid()
    )
  );