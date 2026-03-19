-- =====================================================
-- Fix: Remove all overloaded versions of update_player_rating
-- Problem: PGRST203 - PostgREST cannot choose between multiple function overloads
-- There's an old version with (uuid, numeric, numeric, boolean, text, uuid) params
-- =====================================================

-- Drop ALL possible overloads
DROP FUNCTION IF EXISTS update_player_rating(UUID, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS update_player_rating(UUID, NUMERIC, NUMERIC, BOOLEAN);
DROP FUNCTION IF EXISTS update_player_rating(UUID, NUMERIC, NUMERIC, BOOLEAN, TEXT, UUID);

-- Recreate the single correct version (v3)
CREATE OR REPLACE FUNCTION update_player_rating(
  p_player_account_id UUID,
  p_new_level NUMERIC,
  p_new_reliability NUMERIC,
  p_match_won BOOLEAN DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE player_accounts
  SET 
    level = p_new_level,
    level_reliability_percent = GREATEST(
      p_new_reliability,
      COALESCE(level_reliability_percent, 0) - 2
    ),
    rated_matches = COALESCE(rated_matches, 0) + 1,
    wins = CASE 
      WHEN p_match_won = TRUE THEN COALESCE(wins, 0) + 1 
      ELSE COALESCE(wins, 0) 
    END,
    losses = CASE 
      WHEN p_match_won = FALSE THEN COALESCE(losses, 0) + 1 
      ELSE COALESCE(losses, 0) 
    END,
    updated_at = now()
  WHERE id = p_player_account_id;
END;
$$;

COMMENT ON FUNCTION update_player_rating(UUID, NUMERIC, NUMERIC, BOOLEAN) IS 'v3: Atualiza nivel, fiabilidade protegida com GREATEST, wins, losses e rated_matches';
GRANT EXECUTE ON FUNCTION update_player_rating(UUID, NUMERIC, NUMERIC, BOOLEAN) TO authenticated;
