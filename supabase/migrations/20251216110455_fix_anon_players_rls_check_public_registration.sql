/*
  # Fix Anonymous Players RLS Policy

  ## Changes
    - Updates the INSERT policy for anonymous users to verify tournament allows public registration
    - Ensures anonymous users can only create players for tournaments with allow_public_registration = true
    
  ## Security
    - Maintains all existing security checks
    - Prevents anonymous users from adding players to private tournaments
    - Only allows user_id to be NULL for anonymous users
*/

-- Drop the existing anonymous policy
DROP POLICY IF EXISTS "Anonymous users can create players for public registration" ON players;

-- Create updated policy that checks allow_public_registration
CREATE POLICY "Anonymous users can create players for public registration"
  ON players
  FOR INSERT
  TO anon
  WITH CHECK (
    user_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM tournaments t
      WHERE t.id = players.tournament_id
      AND t.allow_public_registration = true
    )
  );
