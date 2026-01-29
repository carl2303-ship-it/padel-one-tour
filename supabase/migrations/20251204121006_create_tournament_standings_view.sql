
/*
  # Create Tournament Standings View
  
  Creates a helpful view to easily see tournament standings and final positions.
  This makes it easier to verify and display tournament results.
  
  1. New View
    - `tournament_standings_view` - Shows all teams with their positions and player details
  
  2. Benefits
    - Easy visibility of final positions
    - Clear display of team composition
    - Quick verification of tournament results
*/

-- Drop the view if it exists
DROP VIEW IF EXISTS tournament_standings_view;

-- Create a view for easy access to tournament standings
CREATE VIEW tournament_standings_view AS
SELECT 
  t.id as tournament_id,
  t.name as tournament_name,
  t.status as tournament_status,
  t.league_id,
  tm.id as team_id,
  tm.name as team_name,
  tm.final_position,
  p1.name as player1_name,
  p2.name as player2_name,
  CASE 
    WHEN tm.final_position IS NOT NULL THEN 'Positioned'
    ELSE 'No Position'
  END as position_status
FROM tournaments t
JOIN teams tm ON tm.tournament_id = t.id
LEFT JOIN players p1 ON p1.id = tm.player1_id
LEFT JOIN players p2 ON p2.id = tm.player2_id
ORDER BY t.created_at DESC, tm.final_position NULLS LAST;

-- Grant access to authenticated users
GRANT SELECT ON tournament_standings_view TO authenticated;
