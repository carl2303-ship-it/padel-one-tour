-- =====================================================
-- OPEN GAME JOIN VOTING SYSTEM
-- =====================================================
-- Quando um jogador fora do intervalo de nível pede para entrar,
-- todos os jogadores confirmados votam para aceitar/rejeitar.
-- Se TODOS aceitam → jogador confirmado.
-- Se QUALQUER UM rejeita → jogador rejeitado.
-- =====================================================

-- 1. Tabela de votos
CREATE TABLE IF NOT EXISTS public.open_game_join_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.open_games(id) ON DELETE CASCADE,
  request_player_id UUID NOT NULL REFERENCES public.open_game_players(id) ON DELETE CASCADE,
  voter_user_id UUID NOT NULL, -- auth user_id do jogador que vota
  vote TEXT NOT NULL CHECK (vote IN ('accept', 'reject')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(request_player_id, voter_user_id) -- cada jogador vota uma vez por pedido
);

-- 2. RLS para open_game_join_votes
ALTER TABLE public.open_game_join_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view votes for their games" ON public.open_game_join_votes;
CREATE POLICY "Authenticated users can view votes for their games"
  ON public.open_game_join_votes FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Confirmed players can vote" ON public.open_game_join_votes;
CREATE POLICY "Confirmed players can vote"
  ON public.open_game_join_votes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = voter_user_id);

DROP POLICY IF EXISTS "Players can update their own vote" ON public.open_game_join_votes;
CREATE POLICY "Players can update their own vote"
  ON public.open_game_join_votes FOR UPDATE TO authenticated
  USING (auth.uid() = voter_user_id);

-- 3. RPC: Votar num pedido de adesão (verifica se é jogador confirmado + auto-resolve)
CREATE OR REPLACE FUNCTION vote_on_join_request(
  p_request_player_id UUID,  -- id do open_game_players com status='pending'
  p_vote TEXT                  -- 'accept' ou 'reject'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game_id UUID;
  v_voter_user_id UUID;
  v_is_confirmed BOOLEAN;
  v_total_confirmed INT;
  v_total_votes INT;
  v_accept_votes INT;
  v_reject_votes INT;
  v_new_status TEXT;
  v_request_status TEXT;
  v_next_position INT;
BEGIN
  v_voter_user_id := auth.uid();
  
  -- Verificar que o pedido existe e está pendente
  SELECT game_id, status INTO v_game_id, v_request_status
  FROM open_game_players
  WHERE id = p_request_player_id;
  
  IF v_game_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Pedido não encontrado');
  END IF;
  
  IF v_request_status != 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'Este pedido já foi resolvido');
  END IF;
  
  -- Verificar que o votante é jogador confirmado neste jogo
  SELECT EXISTS(
    SELECT 1 FROM open_game_players
    WHERE game_id = v_game_id AND user_id = v_voter_user_id AND status = 'confirmed'
  ) INTO v_is_confirmed;
  
  IF NOT v_is_confirmed THEN
    RETURN json_build_object('success', false, 'error', 'Apenas jogadores confirmados podem votar');
  END IF;
  
  -- Inserir ou atualizar voto
  INSERT INTO open_game_join_votes (game_id, request_player_id, voter_user_id, vote)
  VALUES (v_game_id, p_request_player_id, v_voter_user_id, p_vote)
  ON CONFLICT (request_player_id, voter_user_id)
  DO UPDATE SET vote = p_vote, created_at = now();
  
  -- Contar votos
  SELECT COUNT(*) INTO v_total_confirmed
  FROM open_game_players
  WHERE game_id = v_game_id AND status = 'confirmed';
  
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE vote = 'accept'),
    COUNT(*) FILTER (WHERE vote = 'reject')
  INTO v_total_votes, v_accept_votes, v_reject_votes
  FROM open_game_join_votes
  WHERE request_player_id = p_request_player_id;
  
  v_new_status := NULL;
  
  -- Se algum rejeita → rejeitado imediatamente
  IF v_reject_votes > 0 THEN
    v_new_status := 'rejected';
  -- Se todos aceitaram → confirmado
  ELSIF v_accept_votes >= v_total_confirmed THEN
    v_new_status := 'confirmed';
  END IF;
  
  -- Resolver o pedido
  IF v_new_status IS NOT NULL
  IF v_new_status = 'confirmed' THEN
      -- Atribuir a próxima posição
      SELECT COALESCE(MAX(position), 0) + 1 INTO v_next_position
      FROM open_game_players
      WHERE game_id = v_game_id AND status = 'confirmed';
      
      UPDATE open_game_players
      SET status = 'confirmed', position = v_next_position
      WHERE id = p_request_player_id;
      
      -- Verificar se o jogo ficou completo
      PERFORM 1 FROM open_game_players
      WHERE game_id = v_game_id AND status = 'confirmed'
      HAVING COUNT(*) >= (SELECT max_players FROM open_games WHERE id = v_game_id);
      
      IF FOUND THEN
        UPDATE open_games SET status = 'full' WHERE id = v_game_id;
      END IF;
    ELSE
      UPDATE open_game_players
      SET status = 'rejected'
      WHERE id = p_request_player_id;
    END IF;
    
    -- Limpar votos resolvidos
    DELETE FROM open_game_join_votes WHERE request_player_id = p_request_player_id;
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'resolved', v_new_status IS NOT NULL,
    'new_status', COALESCE(v_new_status, 'pending'),
    'votes_count', v_total_votes,
    'votes_needed', v_total_confirmed,
    'accept_count', v_accept_votes,
    'reject_count', v_reject_votes
  );
END;
$$;
COMMENT ON FUNCTION vote_on_join_request(UUID, TEXT) IS 'Permite que jogadores confirmados votem para aceitar/rejeitar um pedido de adesão. Resolve automaticamente quando todos votam ou alguém rejeita.';
GRANT EXECUTE ON FUNCTION vote_on_join_request(UUID, TEXT) TO authenticated;

-- 4. RPC: Adicionar jogador a um jogo aberto (qualquer jogador confirmado pode)
CREATE OR REPLACE FUNCTION add_player_to_open_game(
  p_game_id UUID,
  p_player_account_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_user_id UUID;
  v_is_confirmed BOOLEAN;
  v_target_user_id UUID;
  v_already_in_game BOOLEAN;
  v_next_position INT;
  v_confirmed_count INT;
  v_max_players INT;
  v_game_status TEXT;
BEGIN
  v_caller_user_id := auth.uid();
  
  -- Verificar que o jogo existe e está aberto
  SELECT status, max_players INTO v_game_status, v_max_players
  FROM open_games WHERE id = p_game_id;
  
  IF v_game_status IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Jogo não encontrado');
  END IF;
  
  IF v_game_status NOT IN ('open') THEN
    RETURN json_build_object('success', false, 'error', 'O jogo não está aberto');
  END IF;
  
  -- Verificar que quem chama é jogador confirmado OU é o dono do clube
  SELECT EXISTS(
    SELECT 1 FROM open_game_players
    WHERE game_id = p_game_id AND user_id = v_caller_user_id AND status = 'confirmed'
  ) INTO v_is_confirmed;
  
  IF NOT v_is_confirmed THEN
    -- Verificar se é dono do clube
    PERFORM 1 FROM open_games og
    JOIN clubs c ON c.id = og.club_id
    WHERE og.id = p_game_id AND c.owner_id = v_caller_user_id;
    
    IF NOT FOUND THEN
      RETURN json_build_object('success', false, 'error', 'Apenas jogadores confirmados ou o clube podem adicionar jogadores');
    END IF;
  END IF;
  
  -- Obter user_id do jogador a adicionar
  SELECT user_id INTO v_target_user_id
  FROM player_accounts WHERE id = p_player_account_id;
  
  IF v_target_user_id IS NULL THEN
  -- O jogador pode não ter user_id (não tem conta auth), aceitar mesmo assim
    v_target_user_id := v_caller_user_id; -- fallback
  END IF;
  
  -- Verificar se já está no jogo
  SELECT EXISTS(
    SELECT 1 FROM open_game_players
    WHERE game_id = p_game_id AND player_account_id = p_player_account_id
  ) INTO v_already_in_game;
  
  IF v_already_in_game THEN
    RETURN json_build_object('success', false, 'error', 'Jogador já está no jogo');
  END IF;
  
  -- Verificar vagas
  SELECT COUNT(*) INTO v_confirmed_count
  FROM open_game_players WHERE game_id = p_game_id AND status = 'confirmed';
  
  IF v_confirmed_count >= v_max_players THEN
    RETURN json_build_object('success', false, 'error', 'O jogo já está completo');
  END IF;
  
  -- Atribuir posição
  SELECT COALESCE(MAX(position), 0) + 1 INTO v_next_position
  FROM open_game_players WHERE game_id = p_game_id AND status = 'confirmed';
  
  -- Inserir jogador
  INSERT INTO open_game_players (game_id, user_id, player_account_id, status, position)
  VALUES (p_game_id, v_target_user_id, p_player_account_id, 'confirmed', v_next_position);
  
  -- Verificar se ficou completo
  IF v_confirmed_count + 1 >= v_max_players THEN
    UPDATE open_games SET status = 'full' WHERE id = p_game_id;
  END IF;
  
  RETURN json_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION add_player_to_open_game(UUID, UUID) IS 'Permite que qualquer jogador confirmado ou o dono do clube adicione um jogador a um jogo aberto.';
GRANT EXECUTE ON FUNCTION add_player_to_open_game(UUID, UUID) TO authenticated;

-- 5. Atualizar RLS de open_game_players para permitir que confirmados vejam pedidos pendentes
-- (a política de SELECT já existe com USING(true), está OK)

-- 6. Permitir que o dono do clube também faça UPDATE nos open_game_players
DROP POLICY IF EXISTS "Club owners can manage open game players" ON public.open_game_players;
CREATE POLICY "Club owners can manage open game players"
  ON public.open_game_players FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM open_games og
      JOIN clubs c ON c.id = og.club_id
      WHERE og.id = game_id AND c.owner_id = auth.uid()
    )
  );

-- Permitir que o dono do clube insira jogadores
DROP POLICY IF EXISTS "Club owners can insert open game players" ON public.open_game_players;
CREATE POLICY "Club owners can insert open game players"
  ON public.open_game_players FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM open_games og
      JOIN clubs c ON c.id = og.club_id
      WHERE og.id = game_id AND c.owner_id = auth.uid()
    )
  );
