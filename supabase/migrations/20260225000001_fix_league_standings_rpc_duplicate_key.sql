/*
  # Fix League Standings RPC - Duplicate Key Error
  
  Problem: 
    When a player (e.g., "Hugo Ferreira") appears in multiple teams across 
    different tournaments in the same league, the SELECT-then-INSERT pattern 
    can cause unique constraint violations on (league_id, entity_type, lower(entity_name)).
  
  Fix:
    Replace SELECT-then-INSERT/UPDATE pattern with INSERT ... ON CONFLICT DO UPDATE.
    This is atomic and eliminates any possibility of duplicate key errors.
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
BEGIN
  SELECT l.scoring_system, l.category_scoring_systems
  INTO v_league_scoring_system, v_category_scoring_systems
  FROM leagues l
  WHERE l.id = league_uuid;

  IF v_league_scoring_system IS NULL THEN
    RAISE EXCEPTION 'League not found';
  END IF;

  -- Limpar todos os standings desta liga para recalcular do zero
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

    -- Processar equipas com posição final
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

      -- Player 1
      IF team_record.player1_name IS NOT NULL 
         AND (v_group_filter IS NULL OR team_record.player1_group = v_group_filter) THEN
        INSERT INTO league_standings (league_id, entity_type, entity_id, entity_name, total_points, tournaments_played, best_position)
        VALUES (league_uuid, 'player', team_record.player1_id, team_record.player1_name, points_value, 1, team_record.final_position)
        ON CONFLICT (league_id, entity_type, LOWER(entity_name))
        DO UPDATE SET
          total_points = league_standings.total_points + EXCLUDED.total_points,
          tournaments_played = league_standings.tournaments_played + 1,
          best_position = LEAST(league_standings.best_position, EXCLUDED.best_position),
          entity_id = EXCLUDED.entity_id,
          updated_at = NOW();
      END IF;

      -- Player 2
      IF team_record.player2_name IS NOT NULL
         AND (v_group_filter IS NULL OR team_record.player2_group = v_group_filter) THEN
        INSERT INTO league_standings (league_id, entity_type, entity_id, entity_name, total_points, tournaments_played, best_position)
        VALUES (league_uuid, 'player', team_record.player2_id, team_record.player2_name, points_value, 1, team_record.final_position)
        ON CONFLICT (league_id, entity_type, LOWER(entity_name))
        DO UPDATE SET
          total_points = league_standings.total_points + EXCLUDED.total_points,
          tournaments_played = league_standings.tournaments_played + 1,
          best_position = LEAST(league_standings.best_position, EXCLUDED.best_position),
          entity_id = EXCLUDED.entity_id,
          updated_at = NOW();
      END IF;
    END LOOP;

    -- Processar jogadores individuais com posição final (que não estão em equipas)
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

      INSERT INTO league_standings (league_id, entity_type, entity_id, entity_name, total_points, tournaments_played, best_position)
      VALUES (league_uuid, 'player', player_record.id, player_record.name, points_value, 1, player_record.final_position)
      ON CONFLICT ON CONSTRAINT league_standings_league_entity_type_name_unique
      DO UPDATE SET
        total_points = league_standings.total_points + EXCLUDED.total_points,
        tournaments_played = league_standings.tournaments_played + 1,
        best_position = LEAST(league_standings.best_position, EXCLUDED.best_position),
        entity_id = EXCLUDED.entity_id,
        updated_at = NOW();
    END LOOP;

  END LOOP;
END;
$$;
