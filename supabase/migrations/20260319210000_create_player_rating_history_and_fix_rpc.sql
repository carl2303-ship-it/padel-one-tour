-- =====================================================
-- Fix: Create player_rating_history table and re-ensure update_player_rating RPC
-- 
-- Problem: A trigger on player_accounts references player_rating_history 
-- but the table was never created, causing 404 errors on update_player_rating RPC
-- =====================================================

-- STEP 1: Create player_rating_history table
CREATE TABLE IF NOT EXISTS player_rating_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_account_id UUID NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
  old_level NUMERIC,
  new_level NUMERIC,
  old_reliability NUMERIC,
  new_reliability NUMERIC,
  match_won BOOLEAN,
  rated_matches INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_player_rating_history_player_id ON player_rating_history(player_account_id);
CREATE INDEX IF NOT EXISTS idx_player_rating_history_created_at ON player_rating_history(created_at DESC);

-- STEP 2: Enable RLS on the table
ALTER TABLE player_rating_history ENABLE ROW LEVEL SECURITY;

-- STEP 3: Allow authenticated users to read rating history
DROP POLICY IF EXISTS "Authenticated users can view rating history" ON player_rating_history;
CREATE POLICY "Authenticated users can view rating history" ON player_rating_history
  FOR SELECT TO authenticated USING (true);

-- STEP 4: Allow service role / security definer functions to insert
DROP POLICY IF EXISTS "Service role can insert rating history" ON player_rating_history;
CREATE POLICY "Service role can insert rating history" ON player_rating_history
  FOR INSERT WITH CHECK (true);

-- STEP 5: Drop any existing trigger that might reference player_rating_history
DROP TRIGGER IF EXISTS trg_player_rating_history ON player_accounts;

-- STEP 6: Create a clean trigger function to log rating changes
CREATE OR REPLACE FUNCTION log_player_rating_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only log when level actually changes
  IF OLD.level IS DISTINCT FROM NEW.level OR OLD.level_reliability_percent IS DISTINCT FROM NEW.level_reliability_percent THEN
    INSERT INTO player_rating_history (
      player_account_id, old_level, new_level, old_reliability, new_reliability, rated_matches
    ) VALUES (
      NEW.id, OLD.level, NEW.level, OLD.level_reliability_percent, NEW.level_reliability_percent, NEW.rated_matches
    );
  END IF;
  RETURN NEW;
END;
$$;

-- STEP 7: Create the trigger
CREATE TRIGGER trg_player_rating_history
AFTER UPDATE OF level, level_reliability_percent ON player_accounts
FOR EACH ROW
EXECUTE FUNCTION log_player_rating_change();

-- STEP 8: Re-create update_player_rating function (v3 - clean)
DROP FUNCTION IF EXISTS update_player_rating(UUID, NUMERIC, NUMERIC, BOOLEAN);
DROP FUNCTION IF EXISTS update_player_rating(UUID, NUMERIC, NUMERIC);

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

COMMENT ON FUNCTION update_player_rating(UUID, NUMERIC, NUMERIC, BOOLEAN) IS 'v3: Atualiza nível, fiabilidade protegida com GREATEST, wins, losses e rated_matches';
GRANT EXECUTE ON FUNCTION update_player_rating(UUID, NUMERIC, NUMERIC, BOOLEAN) TO authenticated;

-- STEP 9: Re-create mark_match_rating_processed (ensure it exists)
CREATE OR REPLACE FUNCTION mark_match_rating_processed(
  p_match_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE matches
  SET rating_processed = TRUE
  WHERE id = p_match_id;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_match_rating_processed(UUID) TO authenticated;
