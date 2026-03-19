-- =====================================================
-- Reset rating_processed to allow reprocessing
-- 
-- Problem: Due to PGRST203 overload bug, matches were marked as
-- rating_processed=TRUE even when the player rating updates FAILED.
-- This caused the rating engine to skip those matches on retry.
--
-- Fix: Reset ALL rating_processed flags so the engine can reprocess everything.
-- The engine is idempotent when processing in chronological order with cache.
-- =====================================================

-- Reset all matches to allow full reprocessing
UPDATE matches 
SET rating_processed = FALSE
WHERE rating_processed = TRUE;

-- Also reset player rated_matches, wins, losses counters
-- so they can be rebuilt correctly from scratch
UPDATE player_accounts
SET 
  rated_matches = 0,
  wins = 0,
  losses = 0
WHERE rated_matches > 0 OR wins > 0 OR losses > 0;
