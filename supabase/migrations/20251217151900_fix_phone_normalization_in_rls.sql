/*
  # Fix phone number normalization for RLS policies
  
  ## Problem
  Phone numbers are stored in different formats:
  - player_accounts: "+351 965 400 457" (with spaces)
  - players: "+351965400457" (without spaces)
  
  This causes RLS policies that compare phone numbers to fail.
  
  ## Solution
  1. Create a function to normalize phone numbers (remove spaces, dashes, etc.)
  2. Drop existing policies that use phone number comparison
  3. Create new policies that use normalized phone comparison
  4. Normalize existing phone numbers in the database
*/

-- Create function to normalize phone numbers
CREATE OR REPLACE FUNCTION normalize_phone(phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF phone IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN REGEXP_REPLACE(phone, '[^0-9+]', '', 'g');
END;
$$;

-- Drop existing phone-based policies
DROP POLICY IF EXISTS "Players can view tournaments they are enrolled in via phone" ON tournaments;
DROP POLICY IF EXISTS "Players can view own player records via phone" ON players;
DROP POLICY IF EXISTS "Players can view teams they are part of via phone" ON teams;
DROP POLICY IF EXISTS "Players can view matches via phone enrollment" ON matches;

-- Recreate policies with normalized phone comparison
CREATE POLICY "Players can view tournaments they are enrolled in via phone"
  ON tournaments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM player_accounts pa
      JOIN players p ON normalize_phone(p.phone_number) = normalize_phone(pa.phone_number)
      WHERE pa.user_id = auth.uid()
      AND p.tournament_id = tournaments.id
    )
    OR
    EXISTS (
      SELECT 1 FROM player_accounts pa
      JOIN players p ON normalize_phone(p.phone_number) = normalize_phone(pa.phone_number)
      JOIN teams t ON (t.player1_id = p.id OR t.player2_id = p.id)
      WHERE pa.user_id = auth.uid()
      AND t.tournament_id = tournaments.id
    )
  );

CREATE POLICY "Players can view own player records via phone"
  ON players
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM player_accounts pa
      WHERE pa.user_id = auth.uid()
      AND normalize_phone(pa.phone_number) = normalize_phone(players.phone_number)
    )
  );

CREATE POLICY "Players can view teams they are part of via phone"
  ON teams
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM player_accounts pa
      JOIN players p ON normalize_phone(p.phone_number) = normalize_phone(pa.phone_number)
      WHERE pa.user_id = auth.uid()
      AND (teams.player1_id = p.id OR teams.player2_id = p.id)
    )
  );

CREATE POLICY "Players can view matches via phone enrollment"
  ON matches
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM player_accounts pa
      JOIN players p ON normalize_phone(p.phone_number) = normalize_phone(pa.phone_number)
      WHERE pa.user_id = auth.uid()
      AND p.tournament_id = matches.tournament_id
    )
    OR
    EXISTS (
      SELECT 1 FROM player_accounts pa
      JOIN players p ON normalize_phone(p.phone_number) = normalize_phone(pa.phone_number)
      JOIN teams t ON (t.player1_id = p.id OR t.player2_id = p.id)
      WHERE pa.user_id = auth.uid()
      AND t.tournament_id = matches.tournament_id
    )
  );

-- Normalize phone numbers in player_accounts
UPDATE player_accounts
SET phone_number = normalize_phone(phone_number)
WHERE phone_number IS NOT NULL
AND phone_number != normalize_phone(phone_number);

-- Normalize phone numbers in players
UPDATE players
SET phone_number = normalize_phone(phone_number)
WHERE phone_number IS NOT NULL
AND phone_number != normalize_phone(phone_number);
