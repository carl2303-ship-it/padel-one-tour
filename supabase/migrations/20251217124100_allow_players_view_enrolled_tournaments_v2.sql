/*
  # Allow players to view tournaments they are enrolled in

  1. Problem
    - Authenticated players can only see tournaments they own
    - They cannot see tournaments where they are registered as players

  2. Solution
    - Add policy for authenticated users to view tournaments where they are enrolled
    - Check if user is a player directly (individual format) or part of a team

  3. Changes
    - Add new SELECT policy for authenticated users to view enrolled tournaments
*/

CREATE POLICY "Players can view tournaments they are enrolled in"
  ON tournaments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM players p
      WHERE p.tournament_id = tournaments.id
      AND p.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM teams t
      JOIN players p1 ON t.player1_id = p1.id
      WHERE t.tournament_id = tournaments.id
      AND p1.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM teams t
      JOIN players p2 ON t.player2_id = p2.id
      WHERE t.tournament_id = tournaments.id
      AND p2.user_id = auth.uid()
    )
  );