/*
  # Recalculate all league standings v6 - fixed duplicates
  
  1. Purpose
    - Recalculate league standings from scratch
    - Process each tournament only once
    - Handle both team and individual tournaments
    - Fix duplicate player names (case sensitivity issues)
    
  2. Method
    - Create a comprehensive view of all tournament results
    - Aggregate points per player ID only (not by name to avoid duplicates)
    - Insert final results into league_standings
*/

DO $$
DECLARE
  league_uuid uuid := '47ea3ff2-7709-4b9b-add2-9fce1ce1af00';
  scoring_sys jsonb;
BEGIN
  -- Get the league scoring system
  SELECT scoring_system INTO scoring_sys
  FROM leagues
  WHERE id = league_uuid;

  -- Create temp table with all player results across all tournaments
  CREATE TEMP TABLE temp_all_results AS
  -- Results from team tournaments - player 1
  SELECT 
    p.id as player_id,
    p.name as player_name,
    tm.final_position,
    tm.tournament_id
  FROM teams tm
  JOIN tournaments t ON t.id = tm.tournament_id
  JOIN players p ON p.id = tm.player1_id
  WHERE t.league_id = league_uuid
    AND t.status = 'completed'
    AND tm.final_position IS NOT NULL
    AND (t.round_robin_type IS NULL OR t.round_robin_type = 'teams')
  
  UNION ALL
  
  -- Results from team tournaments - player 2
  SELECT 
    p.id as player_id,
    p.name as player_name,
    tm.final_position,
    tm.tournament_id
  FROM teams tm
  JOIN tournaments t ON t.id = tm.tournament_id
  JOIN players p ON p.id = tm.player2_id
  WHERE t.league_id = league_uuid
    AND t.status = 'completed'
    AND tm.final_position IS NOT NULL
    AND (t.round_robin_type IS NULL OR t.round_robin_type = 'teams')
  
  UNION ALL
  
  -- Results from individual tournaments
  SELECT 
    p.id as player_id,
    ip.name as player_name,
    ip.final_position,
    ip.tournament_id
  FROM individual_players ip
  JOIN tournaments t ON t.id = ip.tournament_id
  LEFT JOIN players p ON LOWER(TRIM(p.name)) = LOWER(TRIM(ip.name))
  WHERE t.league_id = league_uuid
    AND t.status = 'completed'
    AND ip.final_position IS NOT NULL
    AND t.round_robin_type = 'individual';

  -- Aggregate results per player (group by player_id only)
  INSERT INTO league_standings (
    league_id,
    entity_type,
    entity_id,
    entity_name,
    total_points,
    tournaments_played,
    best_position
  )
  SELECT 
    league_uuid,
    'player',
    player_id,
    MAX(player_name) as player_name,
    SUM(COALESCE((scoring_sys->>final_position::text)::int, 0)) as total_points,
    COUNT(DISTINCT tournament_id)::int as tournaments_played,
    MIN(final_position) as best_position
  FROM temp_all_results
  WHERE player_id IS NOT NULL
  GROUP BY player_id;

  DROP TABLE temp_all_results;
END $$;
