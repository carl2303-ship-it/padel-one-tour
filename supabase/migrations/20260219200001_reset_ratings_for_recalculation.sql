-- =====================================================
-- SQL para RESET e RECALCULAÇÃO de todos os ratings
-- =====================================================
-- 
-- INSTRUÇÕES:
-- 1. Executar este SQL no Supabase SQL Editor
-- 2. Depois, na app padel-one-tour (Manager), ir a Configurações > Rating
--    e clicar "Processar Todos os Jogos" para recalcular com o engine v2
--
-- O que este SQL faz:
-- 1. Reseta o nível de cada jogador para o valor baseado na sua categoria
-- 2. Reseta rated_matches, wins, losses, level_reliability_percent a 0
-- 3. Marca todos os jogos como NÃO processados (para o engine reprocessar)
-- =====================================================

-- =====================================================
-- STEP 1: Reset dos ratings baseado na categoria do jogador
-- =====================================================
-- Mapping de categorias para nível inicial:
--   M1/F1 → 6.0 (profissional)
--   M2/F2 → 5.0 (avançado+)
--   M3/F3 → 4.0 (avançado)
--   M4/F4 → 3.0 (intermédio)
--   M5/F5 → 2.0 (iniciante+)
--   M6/F6 → 1.5 (iniciante)
--   NULL   → 3.0 (default intermédio)
-- =====================================================

UPDATE player_accounts
SET 
  level = CASE
    WHEN player_category IN ('M1', 'F1') THEN 6.0
    WHEN player_category IN ('M2', 'F2') THEN 5.0
    WHEN player_category IN ('M3', 'F3') THEN 4.0
    WHEN player_category IN ('M4', 'F4') THEN 3.0
    WHEN player_category IN ('M5', 'F5') THEN 2.0
    WHEN player_category IN ('M6', 'F6') THEN 1.5
    ELSE COALESCE(level, 3.0)  -- manter nível atual se não tem categoria
  END,
  rated_matches = 0,
  wins = 0,
  losses = 0,
  level_reliability_percent = 0,
  updated_at = NOW();

-- =====================================================
-- STEP 2: Marcar TODOS os jogos como não processados
-- =====================================================
UPDATE matches 
SET rating_processed = FALSE 
WHERE rating_processed = TRUE;

-- =====================================================
-- Verificação: ver o estado atual dos jogadores
-- =====================================================
SELECT 
  name, 
  player_category, 
  level, 
  rated_matches, 
  wins, 
  losses, 
  level_reliability_percent
FROM player_accounts 
WHERE level IS NOT NULL
ORDER BY name;
