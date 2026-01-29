/*
  # Fix Tournament Standings View Security
  
  Resolves security issue by explicitly setting SECURITY INVOKER on the view.
  This ensures the view respects the permissions and RLS policies of the querying user,
  not the view creator.
  
  1. Changes
    - Drop and recreate tournament_standings_view with SECURITY INVOKER
  
  2. Security
    - View now executes with querying user's permissions
    - Respects RLS policies properly
    - Follows Supabase security best practices
*/

-- Drop the existing view
DROP VIEW IF EXISTS tournament_standings_view;

-- Recreate the view with SECURITY INVOKER
CREATE VIEW tournament_standings_view
WITH (security_invoker = true) AS
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