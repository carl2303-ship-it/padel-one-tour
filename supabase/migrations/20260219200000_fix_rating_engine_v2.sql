-- =====================================================
-- Migration: Rating Engine v2 - Fix K-Factor & Reliability Bugs
-- =====================================================
-- 
-- Problemas corrigidos:
-- 1. wins/losses nunca eram incrementados → K-Factor sempre no máximo (0.15)
-- 2. Fiabilidade nunca atualizava corretamente
-- 3. rated_matches não existia como campo dedicado
--
-- Alterações:
-- 1. Adiciona coluna rated_matches a player_accounts
-- 2. Atualiza a função update_player_rating para rastrear wins/losses/rated_matches
-- =====================================================

-- =====================================================
-- STEP 1: Adicionar coluna rated_matches à player_accounts
-- =====================================================
ALTER TABLE player_accounts ADD COLUMN IF NOT EXISTS rated_matches INTEGER DEFAULT 0;

-- Inicializar rated_matches com wins + losses para jogadores existentes
UPDATE player_accounts 
SET rated_matches = COALESCE(wins, 0) + COALESCE(losses, 0)
WHERE rated_matches IS NULL OR rated_matches = 0;

-- =====================================================
-- STEP 2: Atualizar a função update_player_rating 
--         Agora também rastreia wins, losses e rated_matches
-- =====================================================
CREATE OR REPLACE FUNCTION update_player_rating(
  p_player_account_id UUID,
  p_new_level NUMERIC,
  p_new_reliability NUMERIC,
  p_match_won BOOLEAN DEFAULT NULL  -- TRUE=win, FALSE=loss, NULL=draw
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
    level_reliability_percent = p_new_reliability,
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

-- Atualizar comentário
COMMENT ON FUNCTION update_player_rating IS 'v2: Atualiza nível, fiabilidade, wins, losses e rated_matches (SECURITY DEFINER - bypassa RLS)';

-- =====================================================
-- STEP 3: Garantir que GRANT EXECUTE existe
-- =====================================================
GRANT EXECUTE ON FUNCTION update_player_rating(UUID, NUMERIC, NUMERIC, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_match_rating_processed(UUID) TO authenticated;
