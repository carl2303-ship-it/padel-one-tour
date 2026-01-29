/*
  # Fix Leagues RLS - Remove Infinite Recursion

  1. Problem
    - Policy "Players can view leagues with own standings" causes infinite recursion
    - It queries league_standings, which queries leagues back, creating a loop
  
  2. Solution
    - Drop the problematic policy
    - Keep existing policies that already allow:
      - Users to view their own leagues (by user_id)
      - Users to view public leagues (by allow_public_view)
  
  3. Security
    - No security impact - remaining policies are sufficient
    - Users still see their own leagues + public leagues
*/

-- Drop the problematic policy that causes recursion
DROP POLICY IF EXISTS "Players can view leagues with own standings" ON leagues;
