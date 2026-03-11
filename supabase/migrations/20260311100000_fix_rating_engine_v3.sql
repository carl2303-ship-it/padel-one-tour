-- =====================================================
-- Migration: Rating Engine v3 - Fix K-Factor, Reliability & Level Precision
-- =====================================================
-- 
-- Problemas corrigidos:
-- 1. K-Factor demasiado baixo (0.12) → níveis quase não mudavam após jogos
-- 2. Fiabilidade sobrescrita: avaliação do clube (80%) destruída após 1-2 jogos
-- 3. Coluna level era numeric(3,1) → arredondava deltas pequenos
--
-- Alterações:
-- 1. Altera coluna level para numeric (sem restrição de precisão)
-- 2. Atualiza update_player_rating para proteger fiabilidade com GREATEST
--    (nunca cai mais de 2% por jogo — preserva avaliação do clube)
-- =====================================================

-- =====================================================
-- STEP 1: Alterar tipo da coluna level para numeric sem restrição
-- Antes era numeric(3,1) = 1 casa decimal → perdia precisão
-- Agora numeric sem restrição = precisão total
-- =====================================================
ALTER TABLE player_accounts ALTER COLUMN level TYPE numeric;

-- =====================================================
-- STEP 2: Apagar versão antiga e criar update_player_rating v3
-- Agora com GREATEST para proteger a fiabilidade do clube
-- =====================================================
DROP FUNCTION IF EXISTS update_player_rating(UUID, NUMERIC, NUMERIC, BOOLEAN);

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
    -- Fiabilidade protegida: usa o MAIOR entre:
    -- 1. A nova fiabilidade calculada pela fórmula (baseada em rated_matches)
    -- 2. A fiabilidade actual - 2% (decaimento lento da avaliação do clube)
    -- Isto garante que uma avaliação do clube (ex: 80%) não cai abruptamente
    -- para 16% após o primeiro jogo rated. Em vez disso, cai gradualmente:
    -- 80% → 78% → 76% → ... até a fórmula ultrapassar o decaimento.
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

-- Atualizar comentário
COMMENT ON FUNCTION update_player_rating(UUID, NUMERIC, NUMERIC, BOOLEAN) IS 'v3: Atualiza nível (numeric sem restrição), fiabilidade protegida com GREATEST (nunca cai >2%/jogo), wins, losses e rated_matches (SECURITY DEFINER - bypassa RLS)';

-- =====================================================
-- STEP 3: Garantir que GRANT EXECUTE existe
-- =====================================================
GRANT EXECUTE ON FUNCTION update_player_rating(UUID, NUMERIC, NUMERIC, BOOLEAN) TO authenticated;
