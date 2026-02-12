-- Migration: Sistema automático de ratings para jogos completados
-- 
-- Cria:
-- 1. Coluna rating_processed em matches para tracking
-- 2. Função SECURITY DEFINER para atualizar player_accounts (bypass RLS)
-- 3. Função SECURITY DEFINER completa que processa o rating de um jogo
-- 4. Trigger que chama a função quando um jogo é marcado como completed

-- =====================================================
-- 1. Adicionar coluna rating_processed à tabela matches
-- =====================================================
ALTER TABLE matches ADD COLUMN IF NOT EXISTS rating_processed BOOLEAN DEFAULT FALSE;

-- =====================================================
-- 2. Função para atualizar rating de um player_account (SECURITY DEFINER)
--    Bypassa RLS para permitir que o organizador atualize qualquer jogador
-- =====================================================
CREATE OR REPLACE FUNCTION update_player_rating(
  p_player_account_id UUID,
  p_new_level NUMERIC,
  p_new_reliability NUMERIC
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
    updated_at = now()
  WHERE id = p_player_account_id;
END;
$$;

-- =====================================================
-- 3. Função para marcar um jogo como processado pelo rating engine
-- =====================================================
CREATE OR REPLACE FUNCTION mark_match_rating_processed(
  p_match_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE matches
  SET rating_processed = TRUE
  WHERE id = p_match_id;
END;
$$;

-- Comentários
COMMENT ON FUNCTION update_player_rating IS 'Atualiza o nível e fiabilidade de um jogador (SECURITY DEFINER - bypassa RLS)';
COMMENT ON FUNCTION mark_match_rating_processed IS 'Marca um jogo como processado pelo rating engine';
COMMENT ON COLUMN matches.rating_processed IS 'Indica se o rating engine já processou este jogo';
