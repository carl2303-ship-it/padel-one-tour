/*
  # Fix Matches RLS for Enrolled Players
  
  1. Problem
    - Matches policies check tournaments which can cause recursion
    - Need simpler policy using the enrollment function
  
  2. Solution
    - Add policy using is_player_enrolled_in_tournament function
*/

-- Add policy for enrolled players to view matches
CREATE POLICY "Enrolled players can view all matches in tournament"
  ON matches
  FOR SELECT
  TO authenticated
  USING (is_player_enrolled_in_tournament(tournament_id));