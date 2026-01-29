/*
  # Fix Recalculate Function to Use Lower Name Index

  1. Changes
    - Update ON CONFLICT to match the new unique index with LOWER(entity_name)
*/

DROP FUNCTION IF EXISTS recalculate_league_standings_for_league(UUID);

CREATE OR REPLACE FUNCTION recalculate_league_standings_for_league(league_uuid UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league_scoring_system JSONB;
  v_category_scoring_systems JSONB;
  tournament_record RECORD;
  team_record RECORD;
  player_record RECORD;
  v_scoring_system JSONB;
  league_cat TEXT;
  points_value INTEGER;
  existing_standing RECORD;
BEGIN
  SELECT l.scoring_system, l.category_scoring_systems
  INTO v_league_scoring_system, v_category_scoring_systems
  FROM leagues l
  WHERE l.id = league_uuid;

  IF v_league_scoring_system IS NULL THEN
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
       AND v_category_scoring_systems IS NOT NULL 
       AND v_category_scoring_systems ? league_cat THEN
      v_scoring_system := v_category_scoring_systems->league_cat;
    ELSE
      v_scoring_system := v_league_scoring_system;
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
      points_value := COALESCE((v_scoring_system->>team_record.final_position::text)::integer, 0);

      IF team_record.player1_name IS NOT NULL THEN
        SELECT * INTO existing_standing FROM league_standings 
        WHERE league_id = league_uuid 
          AND entity_type = 'player' 
          AND LOWER(entity_name) = LOWER(team_record.player1_name);

        IF existing_standing IS NOT NULL THEN
          UPDATE league_standings SET
            total_points = existing_standing.total_points + points_value,
            tournaments_played = existing_standing.tournaments_played + 1,
            best_position = LEAST(existing_standing.best_position, team_record.final_position),
            entity_id = COALESCE(existing_standing.entity_id, team_record.player1_id),
            updated_at = NOW()
          WHERE id = existing_standing.id;
        ELSE
          INSERT INTO league_standings (league_id, entity_type, entity_id, entity_name, total_points, tournaments_played, best_position)
          VALUES (league_uuid, 'player', team_record.player1_id, team_record.player1_name, points_value, 1, team_record.final_position);
        END IF;
      END IF;

      IF team_record.player2_name IS NOT NULL THEN
        SELECT * INTO existing_standing FROM league_standings 
        WHERE league_id = league_uuid 
          AND entity_type = 'player' 
          AND LOWER(entity_name) = LOWER(team_record.player2_name);

        IF existing_standing IS NOT NULL THEN
          UPDATE league_standings SET
            total_points = existing_standing.total_points + points_value,
            tournaments_played = existing_standing.tournaments_played + 1,
            best_position = LEAST(existing_standing.best_position, team_record.final_position),
            entity_id = COALESCE(existing_standing.entity_id, team_record.player2_id),
            updated_at = NOW()
          WHERE id = existing_standing.id;
        ELSE
          INSERT INTO league_standings (league_id, entity_type, entity_id, entity_name, total_points, tournaments_played, best_position)
          VALUES (league_uuid, 'player', team_record.player2_id, team_record.player2_name, points_value, 1, team_record.final_position);
        END IF;
      END IF;
    END LOOP;

    FOR player_record IN
      SELECT p.id, p.name, p.final_position
      FROM players p
      WHERE p.tournament_id = tournament_record.tournament_id
        AND p.final_position IS NOT NULL
        AND p.name IS NOT NULL
    LOOP
      points_value := COALESCE((v_scoring_system->>player_record.final_position::text)::integer, 0);

      SELECT * INTO existing_standing FROM league_standings 
      WHERE league_id = league_uuid 
        AND entity_type = 'player' 
        AND LOWER(entity_name) = LOWER(player_record.name);

      IF existing_standing IS NOT NULL THEN
        UPDATE league_standings SET
          total_points = existing_standing.total_points + points_value,
          tournaments_played = existing_standing.tournaments_played + 1,
          best_position = LEAST(existing_standing.best_position, player_record.final_position),
          entity_id = COALESCE(existing_standing.entity_id, player_record.id),
          updated_at = NOW()
        WHERE id = existing_standing.id;
      ELSE
        INSERT INTO league_standings (league_id, entity_type, entity_id, entity_name, total_points, tournaments_played, best_position)
        VALUES (league_uuid, 'player', player_record.id, player_record.name, points_value, 1, player_record.final_position);
      END IF;
    END LOOP;

  END LOOP;
END;
$$;
