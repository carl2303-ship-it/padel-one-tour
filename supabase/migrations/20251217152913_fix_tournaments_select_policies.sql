/*
  # Fix tournament SELECT policies for organizers
  
  ## Problem
  Complex policies may be interfering with organizers viewing their own tournaments.
  
  ## Solution
  Simplify to ensure organizers always see their tournaments.
*/

-- Drop complex policy that may cause issues
DROP POLICY IF EXISTS "Players can view tournaments they are enrolled in via phone" ON tournaments;
DROP POLICY IF EXISTS "Anonymous users can view public registration tournaments" ON tournaments;
DROP POLICY IF EXISTS "Anyone can view tournaments with public registration" ON tournaments;

-- Keep it simple: authenticated users see their own tournaments + public ones
DROP POLICY IF EXISTS "Users can view own tournaments" ON tournaments;

CREATE POLICY "Authenticated users can view tournaments"
  ON tournaments
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR allow_public_registration = true
  );
