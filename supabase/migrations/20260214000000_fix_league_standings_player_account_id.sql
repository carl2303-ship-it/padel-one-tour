/*
  # Fix League Standings Player Account ID
  
  1. Problem
     - League standings use entity_name to identify players, causing duplicates when names vary
     - player_account_id is often NULL, preventing proper player identification
     - Same player appears with different names (e.g., "Jordi" vs "Jordi Oviedo")
  
  2. Solution
     - Update all existing league_standings records to have player_account_id
     - Match by entity_id (player) -> players table -> player_accounts via phone/name
     - Update recalculate_league_standings_for_league to always set player_account_id
     - Use player_account_id as primary identifier instead of entity_name
*/

-- Step 1: Update existing league_standings records with player_account_id
-- Match by entity_id (player) -> players -> player_accounts
UPDATE league_standings ls
SET player_account_id = pa.id
FROM players p
JOIN player_accounts pa ON (
  -- Match by phone (most reliable)
  (pa.phone_number IS NOT NULL AND p.phone_number IS NOT NULL AND 
   LOWER(TRIM(REPLACE(COALESCE(p.phone_number, ''), ' ', ''))) = LOWER(TRIM(REPLACE(COALESCE(pa.phone_number, ''), ' ', ''))))
  OR
  -- Match by name (fallback)
  (pa.name IS NOT NULL AND p.name IS NOT NULL AND 
   LOWER(TRIM(p.name)) = LOWER(TRIM(pa.name)))
)
WHERE ls.entity_type = 'player'
  AND ls.entity_id = p.id
  AND ls.player_account_id IS NULL;

-- Step 2: Update function to always set player_account_id and use it as primary identifier
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
  v_player_account_id UUID;
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

    -- Process teams (players in teams)
    FOR team_record IN
      SELECT 
        t.final_position,
        p1.id as player1_id,
        p1.name as player1_name,
        p1.group_name as player1_group,
        p1.phone_number as player1_phone,
        p2.id as player2_id,
        p2.name as player2_name,
        p2.group_name as player2_group,
        p2.phone_number as player2_phone
      FROM teams t
      LEFT JOIN players p1 ON p1.id = t.player1_id
      LEFT JOIN players p2 ON p2.id = t.player2_id
      WHERE t.tournament_id = tournament_record.tournament_id
      AND t.final_position IS NOT NULL
    LOOP
      points_value := COALESCE((v_scoring_system->>team_record.final_position::text)::integer, 0);

      -- Process player 1
      IF team_record.player1_name IS NOT NULL 
         AND (v_group_filter IS NULL OR team_record.player1_group = v_group_filter) THEN
        
        -- Find player_account_id for player1
        SELECT pa.id INTO v_player_account_id
        FROM player_accounts pa
        WHERE (
          -- Match by phone (most reliable)
          (pa.phone_number IS NOT NULL AND team_record.player1_phone IS NOT NULL AND 
           LOWER(TRIM(REPLACE(COALESCE(team_record.player1_phone, ''), ' ', ''))) = LOWER(TRIM(REPLACE(COALESCE(pa.phone_number, ''), ' ', ''))))
          OR
          -- Match by name (fallback)
          (pa.name IS NOT NULL AND team_record.player1_name IS NOT NULL AND 
           LOWER(TRIM(pa.name)) = LOWER(TRIM(team_record.player1_name)))
        )
        LIMIT 1;

        -- Find existing standing by player_account_id (preferred) or entity_name (fallback)
        SELECT id, total_points, tournaments_played, best_position 
        INTO existing_id, existing_points, existing_tournaments, existing_best
        FROM league_standings 
        WHERE league_id = league_uuid 
        AND entity_type = 'player' 
        AND (
          (v_player_account_id IS NOT NULL AND player_account_id = v_player_account_id)
          OR
          (v_player_account_id IS NULL AND LOWER(entity_name) = LOWER(team_record.player1_name))
        )
        LIMIT 1;

        IF existing_id IS NOT NULL THEN
          UPDATE league_standings SET
            total_points = existing_points + points_value,
            tournaments_played = existing_tournaments + 1,
            best_position = LEAST(existing_best, team_record.final_position),
            player_account_id = COALESCE(player_account_id, v_player_account_id),
            entity_id = COALESCE(entity_id, team_record.player1_id),
            updated_at = NOW()
          WHERE id = existing_id;
        ELSE
          INSERT INTO league_standings (
            league_id, entity_type, entity_id, entity_name, 
            player_account_id, total_points, tournaments_played, best_position
          )
          VALUES (
            league_uuid, 'player', team_record.player1_id, team_record.player1_name,
            v_player_account_id, points_value, 1, team_record.final_position
          );
        END IF;

        existing_id := NULL;
        v_player_account_id := NULL;
      END IF;

      -- Process player 2
      IF team_record.player2_name IS NOT NULL
         AND (v_group_filter IS NULL OR team_record.player2_group = v_group_filter) THEN
        
        -- Find player_account_id for player2
        SELECT pa.id INTO v_player_account_id
        FROM player_accounts pa
        WHERE (
          -- Match by phone (most reliable)
          (pa.phone_number IS NOT NULL AND team_record.player2_phone IS NOT NULL AND 
           LOWER(TRIM(REPLACE(COALESCE(team_record.player2_phone, ''), ' ', ''))) = LOWER(TRIM(REPLACE(COALESCE(pa.phone_number, ''), ' ', ''))))
          OR
          -- Match by name (fallback)
          (pa.name IS NOT NULL AND team_record.player2_name IS NOT NULL AND 
           LOWER(TRIM(pa.name)) = LOWER(TRIM(team_record.player2_name)))
        )
        LIMIT 1;

        -- Find existing standing by player_account_id (preferred) or entity_name (fallback)
        SELECT id, total_points, tournaments_played, best_position 
        INTO existing_id, existing_points, existing_tournaments, existing_best
        FROM league_standings 
        WHERE league_id = league_uuid 
        AND entity_type = 'player' 
        AND (
          (v_player_account_id IS NOT NULL AND player_account_id = v_player_account_id)
          OR
          (v_player_account_id IS NULL AND LOWER(entity_name) = LOWER(team_record.player2_name))
        )
        LIMIT 1;

        IF existing_id IS NOT NULL THEN
          UPDATE league_standings SET
            total_points = existing_points + points_value,
            tournaments_played = existing_tournaments + 1,
            best_position = LEAST(existing_best, team_record.final_position),
            player_account_id = COALESCE(player_account_id, v_player_account_id),
            entity_id = COALESCE(entity_id, team_record.player2_id),
            updated_at = NOW()
          WHERE id = existing_id;
        ELSE
          INSERT INTO league_standings (
            league_id, entity_type, entity_id, entity_name,
            player_account_id, total_points, tournaments_played, best_position
          )
          VALUES (
            league_uuid, 'player', team_record.player2_id, team_record.player2_name,
            v_player_account_id, points_value, 1, team_record.final_position
          );
        END IF;

        existing_id := NULL;
        v_player_account_id := NULL;
      END IF;
    END LOOP;

    -- Process individual players (not in teams)
    FOR player_record IN
      SELECT p.id, p.name, p.final_position, p.group_name, p.phone_number
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

      -- Find player_account_id
      SELECT pa.id INTO v_player_account_id
      FROM player_accounts pa
      WHERE (
        -- Match by phone (most reliable)
        (pa.phone_number IS NOT NULL AND player_record.phone_number IS NOT NULL AND 
         LOWER(TRIM(REPLACE(COALESCE(player_record.phone_number, ''), ' ', ''))) = LOWER(TRIM(REPLACE(COALESCE(pa.phone_number, ''), ' ', ''))))
        OR
        -- Match by name (fallback)
        (pa.name IS NOT NULL AND player_record.name IS NOT NULL AND 
         LOWER(TRIM(pa.name)) = LOWER(TRIM(player_record.name)))
      )
      LIMIT 1;

      -- Find existing standing by player_account_id (preferred) or entity_name (fallback)
      SELECT id, total_points, tournaments_played, best_position 
      INTO existing_id, existing_points, existing_tournaments, existing_best
      FROM league_standings 
      WHERE league_id = league_uuid 
      AND entity_type = 'player' 
      AND (
        (v_player_account_id IS NOT NULL AND player_account_id = v_player_account_id)
        OR
        (v_player_account_id IS NULL AND LOWER(entity_name) = LOWER(player_record.name))
      )
      LIMIT 1;

      IF existing_id IS NOT NULL THEN
        UPDATE league_standings SET
          total_points = existing_points + points_value,
          tournaments_played = existing_tournaments + 1,
          best_position = LEAST(existing_best, player_record.final_position),
          player_account_id = COALESCE(player_account_id, v_player_account_id),
          entity_id = COALESCE(entity_id, player_record.id),
          updated_at = NOW()
        WHERE id = existing_id;
      ELSE
        INSERT INTO league_standings (
          league_id, entity_type, entity_id, entity_name,
          player_account_id, total_points, tournaments_played, best_position
        )
        VALUES (
          league_uuid, 'player', player_record.id, player_record.name,
          v_player_account_id, points_value, 1, player_record.final_position
        );
      END IF;

      existing_id := NULL;
      v_player_account_id := NULL;
    END LOOP;

  END LOOP;
END;
$$;
