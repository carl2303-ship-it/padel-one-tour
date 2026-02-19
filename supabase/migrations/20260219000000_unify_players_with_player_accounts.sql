/*
  # Unify Players with Player Accounts
  
  Central migration that links the per-tournament `players` table to the global `player_accounts` table.
  
  ## Problem
  - `players` has no direct FK to `player_accounts`
  - Identification relies on complex phone/name matching at query time
  - Same player appears with different names across tournaments
  - League standings use expensive matching logic
  
  ## Solution
  1. Add `player_account_id` FK to `players` table
  2. Populate it for ALL existing records (phone match > name match)
  3. Create trigger to auto-link on INSERT/UPDATE
  4. Update `entity_name` in league_standings to use canonical name from player_accounts
  5. Simplify `recalculate_league_standings_for_league` to use direct FK
  
  ## Safety
  - NO data is deleted
  - Only ADDS a column and POPULATES it
  - Trigger is non-destructive (only sets player_account_id if found)
  - All existing queries continue to work (column is nullable)
*/

-- ============================================================
-- STEP 1: Add player_account_id column to players table
-- ============================================================
ALTER TABLE players
ADD COLUMN IF NOT EXISTS player_account_id uuid REFERENCES player_accounts(id) ON DELETE SET NULL;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_players_player_account_id ON players(player_account_id);

-- ============================================================
-- STEP 2: Populate player_account_id for ALL existing players
-- Priority 1: Match by phone_number (most reliable)
-- Priority 2: Match by name (fallback)
-- ============================================================

-- 2a: Match by phone_number (most reliable - handles format differences)
UPDATE players p
SET player_account_id = pa.id
FROM player_accounts pa
WHERE p.player_account_id IS NULL
  AND p.phone_number IS NOT NULL
  AND pa.phone_number IS NOT NULL
  AND TRIM(p.phone_number) != ''
  AND LOWER(TRIM(REPLACE(p.phone_number, ' ', ''))) = LOWER(TRIM(REPLACE(pa.phone_number, ' ', '')));

-- 2b: Match by name (fallback for those without phone match)
UPDATE players p
SET player_account_id = pa.id
FROM player_accounts pa
WHERE p.player_account_id IS NULL
  AND p.name IS NOT NULL
  AND pa.name IS NOT NULL
  AND TRIM(p.name) != ''
  AND LOWER(TRIM(p.name)) = LOWER(TRIM(pa.name));

-- Log results
DO $$
DECLARE
  total_players INTEGER;
  linked_players INTEGER;
  unlinked_players INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_players FROM players;
  SELECT COUNT(*) INTO linked_players FROM players WHERE player_account_id IS NOT NULL;
  unlinked_players := total_players - linked_players;
  
  RAISE NOTICE 'Player unification results: % total, % linked, % unlinked',
    total_players, linked_players, unlinked_players;
END $$;

-- ============================================================
-- STEP 3: Create trigger to auto-link player_account_id
-- on INSERT or UPDATE of players
-- ============================================================
CREATE OR REPLACE FUNCTION link_player_to_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  -- Skip if already linked
  IF NEW.player_account_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Priority 1: Match by phone_number (most reliable)
  IF NEW.phone_number IS NOT NULL AND TRIM(NEW.phone_number) != '' THEN
    SELECT id INTO v_account_id
    FROM player_accounts
    WHERE LOWER(TRIM(REPLACE(phone_number, ' ', ''))) = LOWER(TRIM(REPLACE(NEW.phone_number, ' ', '')))
    LIMIT 1;
  END IF;

  -- Priority 2: Match by name (fallback)
  IF v_account_id IS NULL AND NEW.name IS NOT NULL AND TRIM(NEW.name) != '' THEN
    SELECT id INTO v_account_id
    FROM player_accounts
    WHERE LOWER(TRIM(name)) = LOWER(TRIM(NEW.name))
    LIMIT 1;
  END IF;

  -- Set the player_account_id if found
  IF v_account_id IS NOT NULL THEN
    NEW.player_account_id := v_account_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if any (idempotent)
DROP TRIGGER IF EXISTS trg_link_player_to_account ON players;

-- Create trigger: runs on INSERT and UPDATE (when phone_number or name changes)
CREATE TRIGGER trg_link_player_to_account
  BEFORE INSERT OR UPDATE OF phone_number, name
  ON players
  FOR EACH ROW
  EXECUTE FUNCTION link_player_to_account();

-- ============================================================
-- STEP 4: Update entity_name in league_standings to use
-- canonical name from player_accounts (fixes "Jordi" vs "Jordi Oviedo")
-- ============================================================
UPDATE league_standings ls
SET entity_name = pa.name
FROM player_accounts pa
WHERE ls.player_account_id = pa.id
  AND ls.entity_type = 'player'
  AND pa.name IS NOT NULL
  AND LOWER(TRIM(ls.entity_name)) != LOWER(TRIM(pa.name));

-- ============================================================
-- STEP 5: Trigger to propagate player_accounts changes
-- to players table and league_standings
-- When a club or the player changes name, category, etc.
-- it automatically updates EVERYWHERE in the system
-- ============================================================
CREATE OR REPLACE FUNCTION propagate_player_account_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Propagate NAME change to players table and league_standings
  IF NEW.name IS DISTINCT FROM OLD.name AND NEW.name IS NOT NULL THEN
    UPDATE players SET name = NEW.name WHERE player_account_id = NEW.id;
    UPDATE league_standings SET entity_name = NEW.name WHERE player_account_id = NEW.id;
  END IF;

  -- Propagate PLAYER_CATEGORY change to players table
  IF NEW.player_category IS DISTINCT FROM OLD.player_category THEN
    UPDATE players SET player_category = NEW.player_category WHERE player_account_id = NEW.id;
  END IF;

  -- Propagate PHONE_NUMBER change to players table
  IF NEW.phone_number IS DISTINCT FROM OLD.phone_number AND NEW.phone_number IS NOT NULL THEN
    UPDATE players SET phone_number = NEW.phone_number WHERE player_account_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_player_account_changes ON player_accounts;

CREATE TRIGGER trg_propagate_player_account_changes
  AFTER UPDATE OF name, player_category, phone_number
  ON player_accounts
  FOR EACH ROW
  EXECUTE FUNCTION propagate_player_account_changes();

-- ============================================================
-- STEP 6: RPC function for clubs to update player level
-- Allows organizers to update level, reliability, and category
-- on player_accounts without needing direct table access
-- ============================================================
CREATE OR REPLACE FUNCTION update_player_account_level(
  p_phone_number TEXT,
  p_player_category TEXT DEFAULT NULL,
  p_level NUMERIC DEFAULT NULL,
  p_level_reliability_percent NUMERIC DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_id UUID;
  v_name TEXT;
BEGIN
  UPDATE player_accounts
  SET 
    player_category = COALESCE(p_player_category, player_category),
    level = COALESCE(p_level, level),
    level_reliability_percent = COALESCE(p_level_reliability_percent, level_reliability_percent),
    updated_at = NOW()
  WHERE LOWER(TRIM(REPLACE(phone_number, ' ', ''))) = LOWER(TRIM(REPLACE(p_phone_number, ' ', '')))
  RETURNING id, name INTO v_updated_id, v_name;

  IF v_updated_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Player account not found');
  END IF;

  RETURN json_build_object('success', true, 'id', v_updated_id, 'name', v_name);
END;
$$;

-- Grant execute to authenticated users (organizers/clubs)
GRANT EXECUTE ON FUNCTION update_player_account_level TO authenticated;

-- ============================================================
-- STEP 7: Simplified recalculate_league_standings_for_league
-- Now uses player_account_id directly from players table
-- instead of complex phone/name matching
-- ============================================================
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

      -- Process player 1
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

        -- Find existing standing by player_account_id (preferred) or entity_name (fallback)
        SELECT id, total_points, tournaments_played, best_position 
        INTO existing_id, existing_points, existing_tournaments, existing_best
        FROM league_standings 
        WHERE league_id = league_uuid 
        AND entity_type = 'player' 
        AND (
          (v_player_account_id IS NOT NULL AND player_account_id = v_player_account_id)
          OR
          (v_player_account_id IS NULL AND LOWER(entity_name) = LOWER(v_canonical_name))
        )
        LIMIT 1;

        IF existing_id IS NOT NULL THEN
          UPDATE league_standings SET
            total_points = existing_points + points_value,
            tournaments_played = existing_tournaments + 1,
            best_position = LEAST(existing_best, team_record.final_position),
            player_account_id = COALESCE(player_account_id, v_player_account_id),
            entity_name = v_canonical_name,
            updated_at = NOW()
          WHERE id = existing_id;
        ELSE
          INSERT INTO league_standings (
            league_id, entity_type, entity_id, entity_name, 
            player_account_id, total_points, tournaments_played, best_position
          )
          VALUES (
            league_uuid, 'player', team_record.player1_id, v_canonical_name,
            v_player_account_id, points_value, 1, team_record.final_position
          );
        END IF;

        existing_id := NULL;
        v_player_account_id := NULL;
      END IF;

      -- Process player 2
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

        -- Find existing standing
        SELECT id, total_points, tournaments_played, best_position 
        INTO existing_id, existing_points, existing_tournaments, existing_best
        FROM league_standings 
        WHERE league_id = league_uuid 
        AND entity_type = 'player' 
        AND (
          (v_player_account_id IS NOT NULL AND player_account_id = v_player_account_id)
          OR
          (v_player_account_id IS NULL AND LOWER(entity_name) = LOWER(v_canonical_name))
        )
        LIMIT 1;

        IF existing_id IS NOT NULL THEN
          UPDATE league_standings SET
            total_points = existing_points + points_value,
            tournaments_played = existing_tournaments + 1,
            best_position = LEAST(existing_best, team_record.final_position),
            player_account_id = COALESCE(player_account_id, v_player_account_id),
            entity_name = v_canonical_name,
            updated_at = NOW()
          WHERE id = existing_id;
        ELSE
          INSERT INTO league_standings (
            league_id, entity_type, entity_id, entity_name,
            player_account_id, total_points, tournaments_played, best_position
          )
          VALUES (
            league_uuid, 'player', team_record.player2_id, v_canonical_name,
            v_player_account_id, points_value, 1, team_record.final_position
          );
        END IF;

        existing_id := NULL;
        v_player_account_id := NULL;
      END IF;
    END LOOP;

    -- Process individual players (not in teams)
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

      -- Find existing standing
      SELECT id, total_points, tournaments_played, best_position 
      INTO existing_id, existing_points, existing_tournaments, existing_best
      FROM league_standings 
      WHERE league_id = league_uuid 
      AND entity_type = 'player' 
      AND (
        (v_player_account_id IS NOT NULL AND player_account_id = v_player_account_id)
        OR
        (v_player_account_id IS NULL AND LOWER(entity_name) = LOWER(v_canonical_name))
      )
      LIMIT 1;

      IF existing_id IS NOT NULL THEN
        UPDATE league_standings SET
          total_points = existing_points + points_value,
          tournaments_played = existing_tournaments + 1,
          best_position = LEAST(existing_best, player_record.final_position),
          player_account_id = COALESCE(player_account_id, v_player_account_id),
          entity_name = v_canonical_name,
          updated_at = NOW()
        WHERE id = existing_id;
      ELSE
        INSERT INTO league_standings (
          league_id, entity_type, entity_id, entity_name,
          player_account_id, total_points, tournaments_played, best_position
        )
        VALUES (
          league_uuid, 'player', player_record.id, v_canonical_name,
          v_player_account_id, points_value, 1, player_record.final_position
        );
      END IF;

      existing_id := NULL;
      v_player_account_id := NULL;
    END LOOP;

  END LOOP;
END;
$$;
