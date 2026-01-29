/*
  # Fix authenticated users viewing public tournament teams

  1. Problem
    - Authenticated users who are not tournament owners cannot see teams in public tournaments
    - The existing "Anyone view public tournament teams" policy uses role {0} which may not include authenticated users properly

  2. Solution
    - Add explicit policy for authenticated users to view teams in public tournaments
*/

CREATE POLICY "Authenticated can view public tournament teams"
  ON teams
  FOR SELECT
  TO authenticated
  USING (is_tournament_public(tournament_id));
