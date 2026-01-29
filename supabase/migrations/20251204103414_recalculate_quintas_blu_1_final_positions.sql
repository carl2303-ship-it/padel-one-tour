/*
  # Recalculate final positions for Quintas no Blu 1 tournament
  
  1. Purpose
    - Fix incorrect final_position values in individual_players table
    - Calculate positions based on actual match results (wins, games won/lost)
    
  2. Method
    - Calculate statistics from completed matches
    - Order players by wins, then goal difference, then goals scored
    - Update final_position values based on correct order
*/

DO $$
DECLARE
  tournament_uuid uuid := 'd4a88b8c-eb49-4345-94ca-5ffdd298edb4';
  player_stats RECORD;
  position_counter int := 1;
BEGIN
  -- Create temp table with player statistics
  CREATE TEMP TABLE temp_player_stats AS
  WITH player_list AS (
    SELECT id, name
    FROM individual_players
    WHERE tournament_id = tournament_uuid
  ),
  match_results AS (
    SELECT 
      m.player1_individual_id,
      m.player2_individual_id,
      m.player3_individual_id,
      m.player4_individual_id,
      m.team1_score_set1,
      m.team2_score_set1,
      CASE 
        WHEN m.team1_score_set1 > m.team2_score_set1 THEN 1 -- team1 wins
        WHEN m.team1_score_set1 < m.team2_score_set1 THEN 2 -- team2 wins
        ELSE 0 -- draw
      END as winner_team
    FROM matches m
    WHERE m.tournament_id = tournament_uuid 
      AND m.status = 'completed'
  ),
  player_wins AS (
    SELECT 
      player1_individual_id as player_id,
      COUNT(*) FILTER (WHERE winner_team = 1) as wins,
      COUNT(*) FILTER (WHERE winner_team = 2) as losses,
      SUM(team1_score_set1) as games_won,
      SUM(team2_score_set1) as games_lost
    FROM match_results
    WHERE player1_individual_id IS NOT NULL
    GROUP BY player1_individual_id
    
    UNION ALL
    
    SELECT 
      player2_individual_id as player_id,
      COUNT(*) FILTER (WHERE winner_team = 1) as wins,
      COUNT(*) FILTER (WHERE winner_team = 2) as losses,
      SUM(team1_score_set1) as games_won,
      SUM(team2_score_set1) as games_lost
    FROM match_results
    WHERE player2_individual_id IS NOT NULL
    GROUP BY player2_individual_id
    
    UNION ALL
    
    SELECT 
      player3_individual_id as player_id,
      COUNT(*) FILTER (WHERE winner_team = 2) as wins,
      COUNT(*) FILTER (WHERE winner_team = 1) as losses,
      SUM(team2_score_set1) as games_won,
      SUM(team1_score_set1) as games_lost
    FROM match_results
    WHERE player3_individual_id IS NOT NULL
    GROUP BY player3_individual_id
    
    UNION ALL
    
    SELECT 
      player4_individual_id as player_id,
      COUNT(*) FILTER (WHERE winner_team = 2) as wins,
      COUNT(*) FILTER (WHERE winner_team = 1) as losses,
      SUM(team2_score_set1) as games_won,
      SUM(team1_score_set1) as games_lost
    FROM match_results
    WHERE player4_individual_id IS NOT NULL
    GROUP BY player4_individual_id
  )
  SELECT 
    pl.id,
    pl.name,
    COALESCE(SUM(pw.wins), 0)::int as total_wins,
    COALESCE(SUM(pw.losses), 0)::int as total_losses,
    COALESCE(SUM(pw.games_won), 0)::int as total_games_won,
    COALESCE(SUM(pw.games_lost), 0)::int as total_games_lost,
    COALESCE(SUM(pw.games_won), 0)::int - COALESCE(SUM(pw.games_lost), 0)::int as goal_difference
  FROM player_list pl
  LEFT JOIN player_wins pw ON pw.player_id = pl.id
  GROUP BY pl.id, pl.name
  ORDER BY 
    total_wins DESC,
    goal_difference DESC,
    total_games_won DESC;

  -- Update final_position for each player based on sorted order
  FOR player_stats IN 
    SELECT id FROM temp_player_stats ORDER BY total_wins DESC, goal_difference DESC, total_games_won DESC
  LOOP
    UPDATE individual_players
    SET final_position = position_counter
    WHERE id = player_stats.id;
    
    position_counter := position_counter + 1;
  END LOOP;

  DROP TABLE temp_player_stats;
END $$;
