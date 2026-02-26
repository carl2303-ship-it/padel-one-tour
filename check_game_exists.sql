-- Check if a specific open game exists
-- Run this in Supabase SQL Editor to verify the game exists

SELECT 
  og.id,
  og.status,
  og.scheduled_at,
  og.duration_minutes,
  og.creator_user_id,
  og.created_at,
  COUNT(ogp.id) as player_count
FROM open_games og
LEFT JOIN open_game_players ogp ON ogp.game_id = og.id
WHERE og.id = '4943c90e-5fb6-4477-a945-c3edfab60219'
GROUP BY og.id, og.status, og.scheduled_at, og.duration_minutes, og.creator_user_id, og.created_at;

-- Check if there are orphaned open_game_players records (players without a game)
SELECT 
  ogp.id,
  ogp.game_id,
  ogp.player_account_id,
  ogp.user_id,
  ogp.status,
  CASE 
    WHEN og.id IS NULL THEN 'ORPHANED - Game does not exist'
    ELSE 'OK - Game exists'
  END as status_check
FROM open_game_players ogp
LEFT JOIN open_games og ON og.id = ogp.game_id
WHERE ogp.game_id = '4943c90e-5fb6-4477-a945-c3edfab60219';
