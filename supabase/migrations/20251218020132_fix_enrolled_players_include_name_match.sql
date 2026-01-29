/*
  # Fix Enrolled Players - Include Name Match for Individual Tournaments
  
  1. Problem
    - Previous policy only checks phone for individual tournaments
    - Some players don't have phone_number set
  
  2. Solution
    - Add name matching for individual tournaments too
*/

DROP POLICY IF EXISTS "Players can view enrolled tournaments" ON tournaments;

CREATE POLICY "Players can view enrolled tournaments"
  ON tournaments
  FOR SELECT
  TO authenticated
  USING (
    -- Player is enrolled directly via phone
    EXISTS (
      SELECT 1 FROM players p
      JOIN player_accounts pa ON pa.user_id = auth.uid()
      WHERE p.tournament_id = tournaments.id
      AND pa.phone_number IS NOT NULL
      AND p.phone_number = pa.phone_number
    )
    OR
    -- Player is enrolled directly via name (individual tournaments)
    EXISTS (
      SELECT 1 FROM players p
      JOIN player_accounts pa ON pa.user_id = auth.uid()
      WHERE p.tournament_id = tournaments.id
      AND pa.name IS NOT NULL
      AND p.name ILIKE pa.name
    )
    OR
    -- Player is enrolled via team (doubles tournaments)
    EXISTS (
      SELECT 1 FROM teams t
      JOIN players p1 ON (t.player1_id = p1.id OR t.player2_id = p1.id)
      JOIN player_accounts pa ON pa.user_id = auth.uid()
      WHERE t.tournament_id = tournaments.id
      AND pa.name IS NOT NULL
      AND p1.name ILIKE pa.name
    )
  );