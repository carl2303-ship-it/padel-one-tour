/*
  # Allow Enrolled Players to View Players in Their Tournaments

  1. Problem
    - Players enrolled in non-public tournaments may not see other players
    - Need to ensure players can see participants in tournaments where they are enrolled

  2. Solution
    - Add RLS policy allowing authenticated players to view players in tournaments where they are enrolled
    - Uses the existing is_player_enrolled_in_tournament function

  3. Security
    - Only allows viewing, not modifying
    - Only for authenticated users
    - Only for tournaments where the player is actually enrolled
*/

CREATE POLICY "Enrolled players can view their tournament players"
  ON players
  FOR SELECT
  TO authenticated
  USING (
    tournament_id IS NOT NULL 
    AND is_player_enrolled_in_tournament(tournament_id)
  );
