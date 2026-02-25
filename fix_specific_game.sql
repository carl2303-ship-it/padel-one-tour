-- Quick fix for game: 4943c90e-5fb6-4477-a945-c3edfab60219
-- Run this directly in SQL Editor to fix all players in this game

-- Step 1: Update user_id for all players in this game
UPDATE open_game_players ogp
SET user_id = pa.user_id
FROM player_accounts pa
WHERE ogp.game_id = '4943c90e-5fb6-4477-a945-c3edfab60219'
  AND ogp.player_account_id = pa.id
  AND ogp.status = 'confirmed'
  AND pa.user_id IS NOT NULL
  AND (ogp.user_id IS NULL OR ogp.user_id != pa.user_id);

-- Step 2: Verify the fix
SELECT 
  ogp.id,
  ogp.user_id,
  ogp.player_account_id,
  ogp.status,
  ogp.position,
  pa.name as player_name,
  pa.user_id as account_user_id,
  CASE 
    WHEN ogp.user_id IS NULL THEN '❌ user_id NULL'
    WHEN ogp.user_id != pa.user_id THEN '⚠️ user_id MISMATCH'
    WHEN ogp.user_id = pa.user_id THEN '✅ OK'
    ELSE '❓ UNKNOWN'
  END as status_check
FROM open_game_players ogp
LEFT JOIN player_accounts pa ON pa.id = ogp.player_account_id
WHERE ogp.game_id = '4943c90e-5fb6-4477-a945-c3edfab60219'
ORDER BY ogp.position;
