/*
  # Fix Anonymous Player Registration for Teams

  1. Changes
    - Update the anonymous insert policy to allow creating players without tournament_id
    - This allows anonymous users to create generic players that will be linked to teams
    
  2. Security
    - Allows players with tournament_id if tournament has allow_public_registration = true
    - Also allows creating players without tournament_id (for team registrations)
*/

-- Drop the old policy
DROP POLICY IF EXISTS "Anonymous users can create players for public registration" ON players;

-- Create updated policy that allows both cases:
-- 1. Players with tournament_id (for individual tournaments)
-- 2. Players without tournament_id (for team registrations)
CREATE POLICY "Anonymous users can create players for public registration"
  ON players
  FOR INSERT
  TO anon
  WITH CHECK (
    -- Allow players without tournament_id (will be linked to teams)
    tournament_id IS NULL
    OR
    -- Allow players with tournament_id if tournament allows public registration
    EXISTS (
      SELECT 1
      FROM tournaments t
      WHERE t.id = players.tournament_id
        AND t.allow_public_registration = true
    )
  );
