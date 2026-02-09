-- Verificar ligas do jogador fb238544-a99c-4199-9a04-dfa22868e084

-- 1. Dados do player_account
SELECT 'Player Account Info:' as section;
SELECT id, name, phone_number
FROM player_accounts 
WHERE id = 'fb238544-a99c-4199-9a04-dfa22868e084';

-- 2. Players associados
SELECT 'Players by phone/name:' as section;
SELECT p.id, p.name, p.phone_number, p.tournament_id
FROM players p
WHERE p.phone_number IN (
  SELECT phone_number FROM player_accounts WHERE id = 'fb238544-a99c-4199-9a04-dfa22868e084'
)
OR LOWER(p.name) LIKE LOWER((SELECT '%' || name || '%' FROM player_accounts WHERE id = 'fb238544-a99c-4199-9a04-dfa22868e084'))
LIMIT 20;

-- 3. Teams associadas
SELECT 'Teams:' as section;
SELECT t.id, t.name, t.tournament_id
FROM teams t
WHERE t.player1_id IN (
  SELECT p.id FROM players p
  WHERE p.phone_number IN (
    SELECT phone_number FROM player_accounts WHERE id = 'fb238544-a99c-4199-9a04-dfa22868e084'
  )
)
OR t.player2_id IN (
  SELECT p.id FROM players p
  WHERE p.phone_number IN (
    SELECT phone_number FROM player_accounts WHERE id = 'fb238544-a99c-4199-9a04-dfa22868e084'
  )
)
LIMIT 20;

-- 4. League standings (todas as formas)
SELECT 'League Standings (by player_account_id):' as section;
SELECT 
  ls.id,
  ls.league_id,
  l.name as league_name,
  ls.entity_name,
  ls.entity_id,
  ls.total_points,
  ls.tournaments_played
FROM league_standings ls
JOIN leagues l ON l.id = ls.league_id
WHERE ls.player_account_id = 'fb238544-a99c-4199-9a04-dfa22868e084'
ORDER BY ls.total_points DESC;

SELECT 'League Standings (by entity_name):' as section;
SELECT 
  ls.id,
  ls.league_id,
  l.name as league_name,
  ls.entity_name,
  ls.entity_id,
  ls.total_points,
  ls.tournaments_played
FROM league_standings ls
JOIN leagues l ON l.id = ls.league_id
WHERE LOWER(ls.entity_name) LIKE LOWER((SELECT '%' || name || '%' FROM player_accounts WHERE id = 'fb238544-a99c-4199-9a04-dfa22868e084'))
ORDER BY ls.total_points DESC;

SELECT 'League Standings (by entity_id - players):' as section;
SELECT 
  ls.id,
  ls.league_id,
  l.name as league_name,
  ls.entity_name,
  ls.entity_id,
  ls.total_points,
  ls.tournaments_played
FROM league_standings ls
JOIN leagues l ON l.id = ls.league_id
WHERE ls.entity_id IN (
  SELECT p.id FROM players p
  WHERE p.phone_number IN (
    SELECT phone_number FROM player_accounts WHERE id = 'fb238544-a99c-4199-9a04-dfa22868e084'
  )
)
ORDER BY ls.total_points DESC;

-- 5. Todas as ligas únicas (agregado)
SELECT 'ALL UNIQUE LEAGUES:' as section;
SELECT DISTINCT
  l.id as league_id,
  l.name as league_name,
  COUNT(*) OVER (PARTITION BY l.id) as standings_count
FROM league_standings ls
JOIN leagues l ON l.id = ls.league_id
WHERE 
  ls.player_account_id = 'fb238544-a99c-4199-9a04-dfa22868e084'
  OR LOWER(ls.entity_name) LIKE LOWER((SELECT '%' || name || '%' FROM player_accounts WHERE id = 'fb238544-a99c-4199-9a04-dfa22868e084'))
  OR ls.entity_id IN (
    SELECT p.id FROM players p
    WHERE p.phone_number IN (
      SELECT phone_number FROM player_accounts WHERE id = 'fb238544-a99c-4199-9a04-dfa22868e084'
    )
  )
ORDER BY l.name;
