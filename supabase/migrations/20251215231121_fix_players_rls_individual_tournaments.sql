/*
  # Fix RLS for Individual Tournament Players

  1. Changes
    - Add policy to allow authenticated users to view players in their own individual tournaments
    - This fixes the issue where players in individual tournaments (format: 'individual_groups_knockout' or round_robin with type 'individual') were not visible
  
  2. Security
    - Policy checks that the tournament belongs to the authenticated user (tournaments.user_id = auth.uid())
    - Only allows SELECT operations
*/

DROP POLICY IF EXISTS "Users can view players in their individual tournaments" ON players;

CREATE POLICY "Users can view players in their individual tournaments"
  ON players
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM tournaments t
      WHERE t.id = players.tournament_id
      AND t.user_id = auth.uid()
    )
  );
