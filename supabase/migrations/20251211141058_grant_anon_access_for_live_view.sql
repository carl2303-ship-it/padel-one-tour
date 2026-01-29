/*
  # Grant anonymous access for live tournament view

  1. Changes
    - Grant SELECT permission to anonymous users on tournaments, teams, matches, players tables
    - These grants work together with existing RLS policies to allow public access to public tournaments

  2. Security
    - Access is still controlled by RLS policies
    - Only public tournaments and their data are accessible
*/

-- Grant SELECT to anon role (already protected by RLS policies)
GRANT SELECT ON tournaments TO anon;
GRANT SELECT ON teams TO anon;
GRANT SELECT ON matches TO anon;
GRANT SELECT ON players TO anon;
GRANT SELECT ON individual_players TO anon;
