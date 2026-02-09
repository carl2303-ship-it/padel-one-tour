/*
  # Allow authenticated users to view all leagues (SELECT only)
  
  The leagues table only contains metadata (name, description, scoring config).
  No sensitive data. Players need to see league info to display their standings.
  
  The previous policy "Players can view leagues with own standings" was dropped
  because it caused infinite recursion (league_standings -> leagues -> league_standings).
  
  This simpler policy just allows any authenticated user to read leagues.
*/

-- Allow any authenticated user to view leagues (read-only)
DROP POLICY IF EXISTS "Authenticated users can view leagues" ON leagues;
CREATE POLICY "Authenticated users can view leagues"
  ON leagues
  FOR SELECT
  TO authenticated
  USING (true);
