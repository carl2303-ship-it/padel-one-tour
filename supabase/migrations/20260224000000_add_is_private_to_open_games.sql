-- Add is_private column to open_games table
-- Private games are only visible to the creator and added players
ALTER TABLE open_games ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT false;

-- Update the add_player_to_open_game function to also allow adding to private games
-- (Private games have is_private=true but status='open' until all slots are filled)
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
  
  -- Allow adding players to 'open' games (both public and private)
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
  
  -- Inserir jogador como confirmado (adicionado directamente por jogador confirmado)
  INSERT INTO open_game_players (game_id, user_id, player_account_id, status, position)
  VALUES (p_game_id, v_target_user_id, p_player_account_id, 'confirmed', v_next_position);
  
  -- Se jogo ficou completo, marcar como full
  IF v_confirmed_count + 1 >= v_max_players THEN
    UPDATE open_games SET status = 'full' WHERE id = p_game_id;
  END IF;
  
  RETURN json_build_object('success', true);
END;
$$;
