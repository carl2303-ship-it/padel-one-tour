-- Debug query for game: 4943c90e-5fb6-4477-a945-c3edfab60219
-- Check all players in this game and their user_id/player_account_id status

SELECT 
  ogp.id,
  ogp.game_id,
  ogp.user_id,
  ogp.player_account_id,
  ogp.status,
  ogp.position,
  pa.name as player_name,
  pa.user_id as account_user_id,
  CASE 
    WHEN ogp.user_id IS NULL THEN '❌ user_id NULL'
    WHEN ogp.user_id != pa.user_id THEN '⚠️ user_id MISMATCH'
    ELSE '✅ OK'
  END as status_check
FROM open_game_players ogp
LEFT JOIN player_accounts pa ON pa.id = ogp.player_account_id
WHERE ogp.game_id = '4943c90e-5fb6-4477-a945-c3edfab60219'
ORDER BY ogp.position;

-- Check the game details
SELECT 
  id,
  creator_user_id,
  scheduled_at,
  status,
  max_players
FROM open_games
WHERE id = '4943c90e-5fb6-4477-a945-c3edfab60219';
