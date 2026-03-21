-- ================================================
-- Reset ALL ratings for full recalculation
-- ================================================
-- O utilizador definiu manualmente:
--   - Todos os niveis de fiabilidade a 0
--   - Niveis por categoria: M6=1, M5=2, M4=3, M3=4, M2=5, M1=6
-- 
-- Esta migration:
-- 1. Reset rating_processed em TODOS os matches completed
-- 2. Reset contadores de jogos (rated_matches, wins, losses) em player_accounts
-- 3. NÃO altera level nem level_reliability_percent (já definidos pelo user)
-- ================================================

-- 1. Reset rating_processed flag em TODOS os jogos completed
UPDATE matches
SET rating_processed = false
WHERE status = 'completed'
  AND (rating_processed = true OR rating_processed IS NULL);

-- 2. Reset contadores de jogos em player_accounts
-- Não tocamos em level nem level_reliability_percent que o user já definiu
UPDATE player_accounts
SET rated_matches = 0,
    wins = 0,
    losses = 0;
