/*
  # Fix Anonymous Player Registration RLS Policy

  1. Changes
    - Update the anonymous insert policy to allow user_id to be set
    - This allows anonymous users to register players linked to their player_accounts
    
  2. Security
    - Still restricted to tournaments with allow_public_registration = true
    - Maintains data integrity while allowing player account linking
*/

-- Drop the old restrictive policy
DROP POLICY IF EXISTS "Anonymous users can create players for public registration" ON players;

-- Create updated policy that allows user_id to be set
CREATE POLICY "Anonymous users can create players for public registration"
  ON players
  FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM tournaments t
      WHERE t.id = players.tournament_id
        AND t.allow_public_registration = true
    )
  );
