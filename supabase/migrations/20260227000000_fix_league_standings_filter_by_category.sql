-- Fix league standings: Remove duplicate key error by using UPSERT
-- IMPORTANT: This function processes ALL players from tournaments, regardless of their category.
-- The league_category only determines the scoring system to use, not which players to include.
-- Players are grouped by their permanent category (player_accounts.player_category) in the league display.

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
  v_player_account_id UUID;
  v_canonical_name TEXT;
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

    -- league_category determines the scoring system, NOT which players to include
    -- All players from the tournament are included, regardless of their category
    IF league_cat IS NOT NULL 
       AND v_category_scoring_systems IS NOT NULL 
       AND v_category_scoring_systems ? league_cat THEN
      v_scoring_system := v_category_scoring_systems->league_cat;
    ELSE
      v_scoring_system := v_league_scoring_system;
    END IF;

    -- Process teams (players in teams)
    FOR team_record IN
      SELECT 
        t.final_position,
        p1.id as player1_id,
        p1.name as player1_name,
        p1.group_name as player1_group,
        p1.player_account_id as player1_account_id,
        p2.id as player2_id,
        p2.name as player2_name,
        p2.group_name as player2_group,
        p2.player_account_id as player2_account_id
      FROM teams t
      LEFT JOIN players p1 ON p1.id = t.player1_id
      LEFT JOIN players p2 ON p2.id = t.player2_id
      WHERE t.tournament_id = tournament_record.tournament_id
      AND t.final_position IS NOT NULL
    LOOP
      points_value := COALESCE((v_scoring_system->>team_record.final_position::text)::integer, 0);

      -- Process player 1 (NO category filter - all players included)
      IF team_record.player1_name IS NOT NULL 
         AND (v_group_filter IS NULL OR team_record.player1_group = v_group_filter) THEN
        
        v_player_account_id := team_record.player1_account_id;
        
        -- Get canonical name from player_accounts if linked
        v_canonical_name := team_record.player1_name;
        IF v_player_account_id IS NOT NULL THEN
          SELECT pa.name INTO v_canonical_name
          FROM player_accounts pa WHERE pa.id = v_player_account_id;
          v_canonical_name := COALESCE(v_canonical_name, team_record.player1_name);
        END IF;

        -- Use UPSERT to handle duplicates
        INSERT INTO league_standings (
          league_id, entity_type, entity_id, entity_name, 
          player_account_id, total_points, tournaments_played, best_position
        )
        VALUES (
          league_uuid, 'player', team_record.player1_id, v_canonical_name,
          v_player_account_id, points_value, 1, team_record.final_position
        )
        ON CONFLICT (league_id, entity_type, LOWER(entity_name)) 
        DO UPDATE SET
          total_points = league_standings.total_points + EXCLUDED.total_points,
          tournaments_played = league_standings.tournaments_played + 1,
          best_position = LEAST(league_standings.best_position, EXCLUDED.best_position),
          player_account_id = COALESCE(league_standings.player_account_id, EXCLUDED.player_account_id),
          entity_name = EXCLUDED.entity_name,
          updated_at = NOW();

        v_player_account_id := NULL;
      END IF;

      -- Process player 2 (NO category filter - all players included)
      IF team_record.player2_name IS NOT NULL
         AND (v_group_filter IS NULL OR team_record.player2_group = v_group_filter) THEN
        
        v_player_account_id := team_record.player2_account_id;
        
        -- Get canonical name from player_accounts if linked
        v_canonical_name := team_record.player2_name;
        IF v_player_account_id IS NOT NULL THEN
          SELECT pa.name INTO v_canonical_name
          FROM player_accounts pa WHERE pa.id = v_player_account_id;
          v_canonical_name := COALESCE(v_canonical_name, team_record.player2_name);
        END IF;

        -- Use UPSERT to handle duplicates
        INSERT INTO league_standings (
          league_id, entity_type, entity_id, entity_name,
          player_account_id, total_points, tournaments_played, best_position
        )
        VALUES (
          league_uuid, 'player', team_record.player2_id, v_canonical_name,
          v_player_account_id, points_value, 1, team_record.final_position
        )
        ON CONFLICT (league_id, entity_type, LOWER(entity_name)) 
        DO UPDATE SET
          total_points = league_standings.total_points + EXCLUDED.total_points,
          tournaments_played = league_standings.tournaments_played + 1,
          best_position = LEAST(league_standings.best_position, EXCLUDED.best_position),
          player_account_id = COALESCE(league_standings.player_account_id, EXCLUDED.player_account_id),
          entity_name = EXCLUDED.entity_name,
          updated_at = NOW();

        v_player_account_id := NULL;
      END IF;
    END LOOP;

    -- Process individual players (not in teams) - NO category filter, ALL players included
    FOR player_record IN
      SELECT p.id, p.name, p.final_position, p.group_name, p.player_account_id
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

      v_player_account_id := player_record.player_account_id;

      -- Get canonical name from player_accounts if linked
      v_canonical_name := player_record.name;
      IF v_player_account_id IS NOT NULL THEN
        SELECT pa.name INTO v_canonical_name
        FROM player_accounts pa WHERE pa.id = v_player_account_id;
        v_canonical_name := COALESCE(v_canonical_name, player_record.name);
      END IF;

      -- Use UPSERT to handle duplicates
      INSERT INTO league_standings (
        league_id, entity_type, entity_id, entity_name,
        player_account_id, total_points, tournaments_played, best_position
      )
      VALUES (
        league_uuid, 'player', player_record.id, v_canonical_name,
        v_player_account_id, points_value, 1, player_record.final_position
      )
      ON CONFLICT (league_id, entity_type, LOWER(entity_name)) 
      DO UPDATE SET
        total_points = league_standings.total_points + EXCLUDED.total_points,
        tournaments_played = league_standings.tournaments_played + 1,
        best_position = LEAST(league_standings.best_position, EXCLUDED.best_position),
        player_account_id = COALESCE(league_standings.player_account_id, EXCLUDED.player_account_id),
        entity_name = EXCLUDED.entity_name,
        updated_at = NOW();

      v_player_account_id := NULL;
    END LOOP;

  END LOOP;
END;
$$;
