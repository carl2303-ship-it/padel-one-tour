-- ============================================================
-- QUICK FIX: RPC function for clubs to update player_accounts
-- This function is self-contained and propagates changes
-- to players table and league_standings directly
-- Can be applied IMMEDIATELY without the full migration
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
  v_old_category TEXT;
  v_old_name TEXT;
BEGIN
  -- Save old values for comparison
  SELECT id, name, player_category
  INTO v_updated_id, v_old_name, v_old_category
  FROM player_accounts
  WHERE LOWER(TRIM(REPLACE(phone_number, ' ', ''))) = LOWER(TRIM(REPLACE(p_phone_number, ' ', '')))
  LIMIT 1;

  IF v_updated_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Player account not found for phone: ' || p_phone_number);
  END IF;

  -- Update player_accounts
  UPDATE player_accounts
  SET 
    player_category = COALESCE(p_player_category, player_category),
    level = COALESCE(p_level, level),
    level_reliability_percent = COALESCE(p_level_reliability_percent, level_reliability_percent),
    updated_at = NOW()
  WHERE id = v_updated_id
  RETURNING name INTO v_name;

  -- Propagate category change to ALL players records (matched by phone)
  IF p_player_category IS NOT NULL THEN
    UPDATE players
    SET player_category = p_player_category
    WHERE LOWER(TRIM(REPLACE(phone_number, ' ', ''))) = LOWER(TRIM(REPLACE(p_phone_number, ' ', '')));
  END IF;

  -- Propagate category change to ALL players records (matched by player_account_id if column exists)
  BEGIN
    IF p_player_category IS NOT NULL THEN
      EXECUTE 'UPDATE players SET player_category = $1 WHERE player_account_id = $2'
      USING p_player_category, v_updated_id;
    END IF;
  EXCEPTION WHEN undefined_column THEN
    -- player_account_id column doesn't exist yet, skip
    NULL;
  END;

  -- Update league_standings entity_name if name changed
  IF v_name IS DISTINCT FROM v_old_name AND v_name IS NOT NULL THEN
    UPDATE league_standings
    SET entity_name = v_name
    WHERE player_account_id = v_updated_id;
  END IF;

  RETURN json_build_object(
    'success', true, 
    'id', v_updated_id, 
    'name', v_name,
    'player_category', COALESCE(p_player_category, v_old_category)
  );
END;
$$;

-- Grant execute to authenticated users (organizers/clubs)
GRANT EXECUTE ON FUNCTION update_player_account_level TO authenticated;
