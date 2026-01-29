/*
  # Fix Enrolled Players Tournament View Policy
  
  1. Problem
    - Previous policy may cause issues when player_accounts subquery returns null
    - Need safer check with COALESCE
  
  2. Solution
    - Drop and recreate with safer null handling
*/

-- Drop the problematic policy
DROP POLICY IF EXISTS "Players can view enrolled tournaments" ON tournaments;

-- Recreate with safer null handling
CREATE POLICY "Players can view enrolled tournaments"
  ON tournaments
  FOR SELECT
  TO authenticated
  USING (
    -- Player is enrolled directly (individual tournaments) via phone
    EXISTS (
      SELECT 1 FROM players p
      JOIN player_accounts pa ON pa.user_id = auth.uid()
      WHERE p.tournament_id = tournaments.id
      AND pa.phone_number IS NOT NULL
      AND p.phone_number = pa.phone_number
    )
    OR
    -- Player is enrolled via team (doubles tournaments) via name match
    EXISTS (
      SELECT 1 FROM teams t
      JOIN players p1 ON (t.player1_id = p1.id OR t.player2_id = p1.id)
      JOIN player_accounts pa ON pa.user_id = auth.uid()
      WHERE t.tournament_id = tournaments.id
      AND pa.name IS NOT NULL
      AND p1.name ILIKE pa.name
    )
  );