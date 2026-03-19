-- =====================================================
-- Remove player_rating_history table and trigger (feature not implemented)
-- Keep update_player_rating and mark_match_rating_processed RPCs (essential for rating engine)
-- =====================================================

-- Drop trigger first
DROP TRIGGER IF EXISTS trg_player_rating_history ON player_accounts;

-- Drop trigger function
DROP FUNCTION IF EXISTS log_player_rating_change();

-- Drop table
DROP TABLE IF EXISTS player_rating_history;
