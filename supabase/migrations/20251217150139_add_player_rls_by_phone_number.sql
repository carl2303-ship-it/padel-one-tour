/*
  # Fix RLS policies for players to view their enrolled tournaments
  
  ## Problem
  Players are authenticated but cannot see tournaments they are enrolled in because:
  - Players are created with user_id = null during registration
  - RLS policies check user_id which is null
  - Players should be able to see data based on their phone_number from player_accounts
  
  ## Changes
  1. Add policy for authenticated users to view tournaments they are enrolled in via phone_number
  2. Add policy for authenticated users to view their own player records via phone_number
  3. Add policy for authenticated users to view teams they are part of via phone_number
  4. Add policy for authenticated users to view matches in tournaments they are enrolled in
*/

-- Policy for players to view tournaments they are enrolled in (via phone_number)
CREATE POLICY "Players can view tournaments they are enrolled in via phone"
  ON tournaments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM player_accounts pa
      JOIN players p ON p.phone_number = pa.phone_number
      WHERE pa.user_id = auth.uid()
      AND p.tournament_id = tournaments.id
    )
    OR
    EXISTS (
      SELECT 1 FROM player_accounts pa
      JOIN players p ON p.phone_number = pa.phone_number
      JOIN teams t ON (t.player1_id = p.id OR t.player2_id = p.id)
      WHERE pa.user_id = auth.uid()
      AND t.tournament_id = tournaments.id
    )
  );

-- Policy for players to view their own player records via phone_number
CREATE POLICY "Players can view own player records via phone"
  ON players
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM player_accounts pa
      WHERE pa.user_id = auth.uid()
      AND pa.phone_number = players.phone_number
    )
  );

-- Policy for players to view teams they are part of via phone_number
CREATE POLICY "Players can view teams they are part of via phone"
  ON teams
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM player_accounts pa
      JOIN players p ON p.phone_number = pa.phone_number
      WHERE pa.user_id = auth.uid()
      AND (teams.player1_id = p.id OR teams.player2_id = p.id)
    )
  );

-- Policy for players to view matches in tournaments they are enrolled in via phone_number
CREATE POLICY "Players can view matches via phone enrollment"
  ON matches
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM player_accounts pa
      JOIN players p ON p.phone_number = pa.phone_number
      WHERE pa.user_id = auth.uid()
      AND p.tournament_id = matches.tournament_id
    )
    OR
    EXISTS (
      SELECT 1 FROM player_accounts pa
      JOIN players p ON p.phone_number = pa.phone_number
      JOIN teams t ON (t.player1_id = p.id OR t.player2_id = p.id)
      WHERE pa.user_id = auth.uid()
      AND t.tournament_id = matches.tournament_id
    )
  );
