/*
  # Allow Enrolled Players to View Tournaments
  
  1. Problem
    - Players can only see tournaments with allow_public_registration = true
    - Players enrolled in private tournaments cannot see them in their dashboard
  
  2. Solution
    - Add RLS policy to allow players to view tournaments they are enrolled in
    - Check enrollment via players table (individual) or teams table (doubles)
*/

-- Policy for players to view tournaments they are enrolled in
CREATE POLICY "Players can view enrolled tournaments"
  ON tournaments
  FOR SELECT
  TO authenticated
  USING (
    -- Player is enrolled directly (individual tournaments)
    EXISTS (
      SELECT 1 FROM players p
      WHERE p.tournament_id = tournaments.id
      AND p.phone_number = (
        SELECT phone_number FROM player_accounts 
        WHERE user_id = auth.uid()
        LIMIT 1
      )
    )
    OR
    -- Player is enrolled via team (doubles tournaments)
    EXISTS (
      SELECT 1 FROM teams t
      JOIN players p1 ON t.player1_id = p1.id OR t.player2_id = p1.id
      WHERE t.tournament_id = tournaments.id
      AND p1.name ILIKE (
        SELECT name FROM player_accounts 
        WHERE user_id = auth.uid()
        LIMIT 1
      )
    )
  );