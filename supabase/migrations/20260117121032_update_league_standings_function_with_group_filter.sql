/*
  # Update League Standings Function with Group Filter
  
  1. Changes
    - Modify recalculate_league_standings_for_league function
    - Add support for group_filter from tournament_leagues
    - Players are now filtered by their group_name when group_filter is set
  
  2. Logic
    - If group_filter is NULL: include all players from tournament
    - If group_filter is set (e.g., 'A'): only include players where group_name = 'A'
*/

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
  v_group_filter TEXT;
  points_value INTEGER;
  existing_id UUID;
  existing_points INTEGER;
  existing_tournaments INTEGER;
  existing_best INTEGER;
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
      tl.group_filter,
      t.status
    FROM tournament_leagues tl
    JOIN tournaments t ON t.id = tl.tournament_id
    WHERE tl.league_id = league_uuid
    AND t.status = 'completed'
  LOOP
    league_cat := tournament_record.league_category;
    v_group_filter := tournament_record.group_filter;

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
        p1.group_name as player1_group,
        p2.id as player2_id,
        p2.name as player2_name,
        p2.group_name as player2_group
      FROM teams t
      LEFT JOIN players p1 ON p1.id = t.player1_id
      LEFT JOIN players p2 ON p2.id = t.player2_id
      WHERE t.tournament_id = tournament_record.tournament_id
      AND t.final_position IS NOT NULL
    LOOP
      points_value := COALESCE((v_scoring_system->>team_record.final_position::text)::integer, 0);

      IF team_record.player1_name IS NOT NULL 
         AND (v_group_filter IS NULL OR team_record.player1_group = v_group_filter) THEN
        SELECT id, total_points, tournaments_played, best_position 
        INTO existing_id, existing_points, existing_tournaments, existing_best
        FROM league_standings 
        WHERE league_id = league_uuid 
        AND entity_type = 'player' 
        AND LOWER(entity_name) = LOWER(team_record.player1_name);

        IF existing_id IS NOT NULL THEN
          UPDATE league_standings SET
            total_points = existing_points + points_value,
            tournaments_played = existing_tournaments + 1,
            best_position = LEAST(existing_best, team_record.final_position),
            updated_at = NOW()
          WHERE id = existing_id;
        ELSE
          INSERT INTO league_standings (league_id, entity_type, entity_id, entity_name, total_points, tournaments_played, best_position)
          VALUES (league_uuid, 'player', team_record.player1_id, team_record.player1_name, points_value, 1, team_record.final_position);
        END IF;

        existing_id := NULL;
      END IF;

      IF team_record.player2_name IS NOT NULL
         AND (v_group_filter IS NULL OR team_record.player2_group = v_group_filter) THEN
        SELECT id, total_points, tournaments_played, best_position 
        INTO existing_id, existing_points, existing_tournaments, existing_best
        FROM league_standings 
        WHERE league_id = league_uuid 
        AND entity_type = 'player' 
        AND LOWER(entity_name) = LOWER(team_record.player2_name);

        IF existing_id IS NOT NULL THEN
          UPDATE league_standings SET
            total_points = existing_points + points_value,
            tournaments_played = existing_tournaments + 1,
            best_position = LEAST(existing_best, team_record.final_position),
            updated_at = NOW()
          WHERE id = existing_id;
        ELSE
          INSERT INTO league_standings (league_id, entity_type, entity_id, entity_name, total_points, tournaments_played, best_position)
          VALUES (league_uuid, 'player', team_record.player2_id, team_record.player2_name, points_value, 1, team_record.final_position);
        END IF;

        existing_id := NULL;
      END IF;
    END LOOP;

    FOR player_record IN
      SELECT p.id, p.name, p.final_position, p.group_name
      FROM players p
      WHERE p.tournament_id = tournament_record.tournament_id
      AND p.final_position IS NOT NULL
      AND p.name IS NOT NULL
      AND (v_group_filter IS NULL OR p.group_name = v_group_filter)
      AND NOT EXISTS (
        SELECT 1 FROM teams t2 
        WHERE t2.tournament_id = tournament_record.tournament_id
        AND (t2.player1_id = p.id OR t2.player2_id = p.id)
      )
    LOOP
      points_value := COALESCE((v_scoring_system->>player_record.final_position::text)::integer, 0);

      SELECT id, total_points, tournaments_played, best_position 
      INTO existing_id, existing_points, existing_tournaments, existing_best
      FROM league_standings 
      WHERE league_id = league_uuid 
      AND entity_type = 'player' 
      AND LOWER(entity_name) = LOWER(player_record.name);

      IF existing_id IS NOT NULL THEN
        UPDATE league_standings SET
          total_points = existing_points + points_value,
          tournaments_played = existing_tournaments + 1,
          best_position = LEAST(existing_best, player_record.final_position),
          updated_at = NOW()
        WHERE id = existing_id;
      ELSE
        INSERT INTO league_standings (league_id, entity_type, entity_id, entity_name, total_points, tournaments_played, best_position)
        VALUES (league_uuid, 'player', player_record.id, player_record.name, points_value, 1, player_record.final_position);
      END IF;

      existing_id := NULL;
    END LOOP;

  END LOOP;
END;
$$;