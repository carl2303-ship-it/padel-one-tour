/*
  # Allow players to view tournaments where they are enrolled

  1. Changes
    - Add RLS policy to allow authenticated users to view tournaments where they are registered as players
    - This fixes the issue where players can't see tournaments in their dashboard

  2. Security
    - Only allows viewing tournaments where the user has a player record with matching user_id
*/

-- Allow authenticated users to view tournaments where they are enrolled as players
CREATE POLICY "Players can view tournaments where they are enrolled"
  ON tournaments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM players p
      WHERE p.tournament_id = tournaments.id
        AND p.user_id = auth.uid()
    )
  );
