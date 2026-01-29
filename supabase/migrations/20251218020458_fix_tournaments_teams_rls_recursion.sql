/*
  # Fix Tournaments/Teams RLS Recursion
  
  1. Problem
    - tournaments policy checks teams table
    - teams "View teams policy" checks tournaments table
    - This causes infinite recursion
  
  2. Solution
    - Create a SECURITY DEFINER function to check enrollment
    - Use function in policy to avoid recursion
*/

-- Create a security definer function to check if user is enrolled
CREATE OR REPLACE FUNCTION is_player_enrolled_in_tournament(tournament_uuid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    -- Check via phone number
    SELECT 1 FROM players p
    JOIN player_accounts pa ON pa.user_id = auth.uid()
    WHERE p.tournament_id = tournament_uuid
    AND pa.phone_number IS NOT NULL
    AND p.phone_number = pa.phone_number
  )
  OR EXISTS (
    -- Check via name in players
    SELECT 1 FROM players p
    JOIN player_accounts pa ON pa.user_id = auth.uid()
    WHERE p.tournament_id = tournament_uuid
    AND pa.name IS NOT NULL
    AND p.name ILIKE pa.name
  )
  OR EXISTS (
    -- Check via name in teams
    SELECT 1 FROM teams t
    JOIN players p1 ON (t.player1_id = p1.id OR t.player2_id = p1.id)
    JOIN player_accounts pa ON pa.user_id = auth.uid()
    WHERE t.tournament_id = tournament_uuid
    AND pa.name IS NOT NULL
    AND p1.name ILIKE pa.name
  );
$$;

-- Drop the problematic policy
DROP POLICY IF EXISTS "Players can view enrolled tournaments" ON tournaments;

-- Recreate using the function
CREATE POLICY "Players can view enrolled tournaments"
  ON tournaments
  FOR SELECT
  TO authenticated
  USING (is_player_enrolled_in_tournament(id));

-- Also drop the problematic teams policy that causes recursion
DROP POLICY IF EXISTS "View teams policy" ON teams;