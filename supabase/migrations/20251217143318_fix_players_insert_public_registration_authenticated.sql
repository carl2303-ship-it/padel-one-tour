/*
  # Fix players INSERT policy for authenticated users in public tournaments
  
  ## Problem
  Authenticated users cannot insert players in tournaments with public registration enabled,
  even when not specifying a user_id.
  
  ## Solution
  Simplify the INSERT policy to explicitly allow authenticated users to insert players
  in public registration tournaments without requiring user_id checks.
*/

-- Drop the existing policy
DROP POLICY IF EXISTS "Authenticated users can insert players for their tournaments" ON players;

-- Create a simpler, more permissive policy for authenticated users
CREATE POLICY "Authenticated users can insert players for their tournaments"
  ON players
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- User is tournament owner
    EXISTS (
      SELECT 1 FROM tournaments t 
      WHERE t.id = players.tournament_id 
      AND t.user_id = auth.uid()
    )
    OR
    -- Tournament allows public registration (no user_id restriction for public tournaments)
    EXISTS (
      SELECT 1 FROM tournaments t 
      WHERE t.id = players.tournament_id 
      AND t.allow_public_registration = true
    )
    OR
    -- Creating player without tournament (legacy support)
    (tournament_id IS NULL AND (user_id IS NULL OR user_id = auth.uid()))
  );
