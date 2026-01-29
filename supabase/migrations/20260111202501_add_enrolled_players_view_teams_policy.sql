/*
  # Allow Enrolled Players to View Teams in Their Tournaments

  1. Problem
    - Players enrolled in non-public tournaments cannot see teams
    - This prevents them from seeing tournaments like "Quinta - Duplas - Blu 3" and "Blu 4"

  2. Solution
    - Add RLS policy allowing authenticated players to view teams in tournaments where they are enrolled
    - Uses the existing is_player_enrolled_in_tournament function

  3. Security
    - Only allows viewing, not modifying
    - Only for authenticated users
    - Only for tournaments where the player is actually enrolled
*/

CREATE POLICY "Enrolled players can view their tournament teams"
  ON teams
  FOR SELECT
  TO authenticated
  USING (is_player_enrolled_in_tournament(tournament_id));
