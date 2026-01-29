/*
  # Fix tournaments RLS for enrolled players
  
  ## Problem
  Players cannot see tournaments they are enrolled in unless they are public.
  
  ## Solution
  Update policy to allow players to see tournaments where they are enrolled via phone number.
*/

-- Drop existing policy
DROP POLICY IF EXISTS "Authenticated users can view tournaments" ON tournaments;

-- Create comprehensive policy for authenticated users
CREATE POLICY "Authenticated users can view tournaments"
  ON tournaments
  FOR SELECT
  TO authenticated
  USING (
    -- Organizers see their own tournaments
    user_id = auth.uid()
    -- Anyone sees public registration tournaments
    OR allow_public_registration = true
    -- Players see tournaments they're enrolled in (individual)
    OR EXISTS (
      SELECT 1 FROM players p
      JOIN player_accounts pa ON normalize_phone(pa.phone_number) = normalize_phone(p.phone_number)
      WHERE pa.user_id = auth.uid() AND p.tournament_id = tournaments.id
    )
    -- Players see tournaments they're enrolled in (teams)
    OR EXISTS (
      SELECT 1 FROM teams t
      JOIN players p ON (p.id = t.player1_id OR p.id = t.player2_id)
      JOIN player_accounts pa ON normalize_phone(pa.phone_number) = normalize_phone(p.phone_number)
      WHERE pa.user_id = auth.uid() AND t.tournament_id = tournaments.id
    )
  );
