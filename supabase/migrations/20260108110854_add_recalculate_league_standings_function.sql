/*
  # Add Recalculate League Standings Function

  1. New Function
    - `recalculate_league_standings_for_league(league_uuid UUID)` - Recalculates all standings for a league
    - Uses category-specific scoring systems when available
    - Properly handles entity_id requirement

  2. Purpose
    - Fix issue where recalculation was using wrong scoring system
    - Ensure proper entity_id is set for all standings
*/

CREATE OR REPLACE FUNCTION recalculate_league_standings_for_league(league_uuid UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  league_record RECORD;
  tournament_record RECORD;
  team_record RECORD;
  player_record RECORD;
  scoring_system JSONB;
  category_scoring JSONB;
  league_cat TEXT;
  points_value INTEGER;
BEGIN
  SELECT id, scoring_system, category_scoring_systems
  INTO league_record
  FROM leagues
  WHERE id = league_uuid;

  IF league_record IS NULL THEN
    RAISE EXCEPTION 'League not found';
  END IF;

  DELETE FROM league_standings WHERE league_id = league_uuid;

  FOR tournament_record IN
    SELECT 
      tl.tournament_id,
      tl.league_category,
      t.status
    FROM tournament_leagues tl
    JOIN tournaments t ON t.id = tl.tournament_id
    WHERE tl.league_id = league_uuid
      AND t.status = 'completed'
  LOOP
    league_cat := tournament_record.league_category;

    IF league_cat IS NOT NULL 
       AND league_record.category_scoring_systems IS NOT NULL 
       AND league_record.category_scoring_systems ? league_cat THEN
      scoring_system := league_record.category_scoring_systems->league_cat;
      RAISE NOTICE 'Using category scoring for %: %', league_cat, scoring_system;
    ELSE
      scoring_system := league_record.scoring_system;
      RAISE NOTICE 'Using default scoring: %', scoring_system;
    END IF;

    FOR team_record IN
      SELECT 
        t.final_position,
        p1.id as player1_id,
        p1.name as player1_name,
        p2.id as player2_id,
        p2.name as player2_name
      FROM teams t
      LEFT JOIN players p1 ON p1.id = t.player1_id
      LEFT JOIN players p2 ON p2.id = t.player2_id
      WHERE t.tournament_id = tournament_record.tournament_id
        AND t.final_position IS NOT NULL
    LOOP
      points_value := COALESCE((scoring_system->>team_record.final_position::text)::integer, 0);

      IF team_record.player1_name IS NOT NULL THEN
        INSERT INTO league_standings (league_id, entity_type, entity_id, entity_name, total_points, tournaments_played, best_position)
        VALUES (league_uuid, 'player', team_record.player1_id, team_record.player1_name, points_value, 1, team_record.final_position)
        ON CONFLICT (league_id, entity_type, entity_name) 
        DO UPDATE SET
          total_points = league_standings.total_points + EXCLUDED.total_points,
          tournaments_played = league_standings.tournaments_played + 1,
          best_position = LEAST(league_standings.best_position, EXCLUDED.best_position),
          entity_id = COALESCE(league_standings.entity_id, EXCLUDED.entity_id),
          updated_at = NOW();
      END IF;

      IF team_record.player2_name IS NOT NULL THEN
        INSERT INTO league_standings (league_id, entity_type, entity_id, entity_name, total_points, tournaments_played, best_position)
        VALUES (league_uuid, 'player', team_record.player2_id, team_record.player2_name, points_value, 1, team_record.final_position)
        ON CONFLICT (league_id, entity_type, entity_name) 
        DO UPDATE SET
          total_points = league_standings.total_points + EXCLUDED.total_points,
          tournaments_played = league_standings.tournaments_played + 1,
          best_position = LEAST(league_standings.best_position, EXCLUDED.best_position),
          entity_id = COALESCE(league_standings.entity_id, EXCLUDED.entity_id),
          updated_at = NOW();
      END IF;
    END LOOP;

    FOR player_record IN
      SELECT id, name, final_position
      FROM players
      WHERE tournament_id = tournament_record.tournament_id
        AND final_position IS NOT NULL
        AND name IS NOT NULL
    LOOP
      points_value := COALESCE((scoring_system->>player_record.final_position::text)::integer, 0);

      INSERT INTO league_standings (league_id, entity_type, entity_id, entity_name, total_points, tournaments_played, best_position)
      VALUES (league_uuid, 'player', player_record.id, player_record.name, points_value, 1, player_record.final_position)
      ON CONFLICT (league_id, entity_type, entity_name) 
      DO UPDATE SET
        total_points = league_standings.total_points + EXCLUDED.total_points,
        tournaments_played = league_standings.tournaments_played + 1,
        best_position = LEAST(league_standings.best_position, EXCLUDED.best_position),
        entity_id = COALESCE(league_standings.entity_id, EXCLUDED.entity_id),
        updated_at = NOW();
    END LOOP;

  END LOOP;
END;
$$;
