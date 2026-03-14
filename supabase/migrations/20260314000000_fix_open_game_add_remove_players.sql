-- Fix add_player_to_open_game function:
-- 1. Allow adding when game status is 'full' but there are actually fewer than max_players (edge case after remove)
-- 2. Use first available position (1-4) instead of MAX + 1
-- 3. Allow game creator to add players (not just confirmed players or club owner)

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
  v_is_authorized BOOLEAN;
  v_target_user_id UUID;
  v_already_in_game BOOLEAN;
  v_next_position INT;
  v_confirmed_count INT;
  v_max_players INT;
  v_game_status TEXT;
  v_creator_user_id UUID;
BEGIN
  v_caller_user_id := auth.uid();
  
  -- Verificar que o jogo existe
  SELECT status, max_players, creator_user_id 
  INTO v_game_status, v_max_players, v_creator_user_id
  FROM open_games WHERE id = p_game_id;
  
  IF v_game_status IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Jogo não encontrado');
  END IF;
  
  -- Permitir adicionar se o jogo está 'open' OU se está 'full' mas na verdade tem menos jogadores que o máximo
  IF v_game_status NOT IN ('open', 'full') THEN
    RETURN json_build_object('success', false, 'error', 'O jogo não está aberto');
  END IF;
  
  -- Contar jogadores confirmados ANTES de verificar permissões
  SELECT COUNT(*) INTO v_confirmed_count
  FROM open_game_players WHERE game_id = p_game_id AND status = 'confirmed';
  
  -- Se o jogo está 'full' mas na verdade tem vagas, reabrir
  IF v_game_status = 'full' AND v_confirmed_count < v_max_players THEN
    UPDATE open_games SET status = 'open' WHERE id = p_game_id;
  END IF;
  
  -- Verificar que quem chama é: jogador confirmado OU criador do jogo OU dono do clube
  v_is_authorized := false;
  
  -- É o criador do jogo?
  IF v_creator_user_id = v_caller_user_id THEN
    v_is_authorized := true;
  END IF;
  
  -- É jogador confirmado?
  IF NOT v_is_authorized THEN
    SELECT EXISTS(
      SELECT 1 FROM open_game_players
      WHERE game_id = p_game_id AND user_id = v_caller_user_id AND status = 'confirmed'
    ) INTO v_is_authorized;
  END IF;
  
  -- É dono do clube?
  IF NOT v_is_authorized THEN
    PERFORM 1 FROM open_games og
    JOIN clubs c ON c.id = og.club_id
    WHERE og.id = p_game_id AND c.owner_id = v_caller_user_id;
    
    IF FOUND THEN
      v_is_authorized := true;
    END IF;
  END IF;
  
  IF NOT v_is_authorized THEN
    RETURN json_build_object('success', false, 'error', 'Apenas jogadores confirmados, o criador ou o clube podem adicionar jogadores');
  END IF;
  
  -- Obter user_id do jogador a adicionar (pode ser NULL se o jogador ainda não fez login)
  SELECT user_id INTO v_target_user_id
  FROM player_accounts WHERE id = p_player_account_id;
  
  -- Verificar se já está no jogo
  SELECT EXISTS(
    SELECT 1 FROM open_game_players
    WHERE game_id = p_game_id AND player_account_id = p_player_account_id
  ) INTO v_already_in_game;
  
  IF v_already_in_game THEN
    RETURN json_build_object('success', false, 'error', 'Jogador já está no jogo');
  END IF;
  
  -- Verificar vagas (usar a contagem já feita)
  IF v_confirmed_count >= v_max_players THEN
    RETURN json_build_object('success', false, 'error', 'O jogo já está completo');
  END IF;
  
  -- Atribuir a primeira posição disponível (1-4) em vez de MAX + 1
  v_next_position := NULL;
  FOR i IN 1..v_max_players LOOP
    IF NOT EXISTS (
      SELECT 1 FROM open_game_players 
      WHERE game_id = p_game_id AND position = i AND status = 'confirmed'
    ) THEN
      v_next_position := i;
      EXIT;
    END IF;
  END LOOP;
  
  -- Fallback se nenhuma posição 1-4 está disponível (não deveria acontecer)
  IF v_next_position IS NULL THEN
    SELECT COALESCE(MAX(position), 0) + 1 INTO v_next_position
    FROM open_game_players WHERE game_id = p_game_id AND status = 'confirmed';
  END IF;
  
  -- Inserir jogador (user_id pode ser NULL - será atualizado quando o jogador fizer login)
  INSERT INTO open_game_players (game_id, user_id, player_account_id, status, position)
  VALUES (p_game_id, v_target_user_id, p_player_account_id, 'confirmed', v_next_position);
  
  -- Verificar se ficou completo
  IF v_confirmed_count + 1 >= v_max_players THEN
    UPDATE open_games SET status = 'full' WHERE id = p_game_id;
  END IF;
  
  RETURN json_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION add_player_to_open_game(UUID, UUID) IS 'Permite que o criador, jogadores confirmados ou o dono do clube adicionem um jogador a um jogo aberto. Encontra a primeira posição disponível (1-4).';
