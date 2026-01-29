/*
  # Fix Potential Recursion in Teams and Players RLS Policies

  1. Problem
    - "Players can view teams in tournaments they are enrolled in" on teams table
      queries players and teams tables which may cause recursion

  2. Solution
    - Drop the problematic policy
    - Keep the simpler "View teams policy" which handles visibility correctly
*/

DROP POLICY IF EXISTS "Players can view teams in tournaments they are enrolled in" ON teams;
