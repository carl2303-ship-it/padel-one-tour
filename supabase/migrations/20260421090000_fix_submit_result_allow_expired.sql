-- Fix: Allow result submission for expired games
-- When a game's scheduled time passes, the status changes to 'expired',
-- but players should still be able to submit results for these games.

CREATE OR REPLACE FUNCTION submit_open_game_result(
  p_game_id UUID,
  p_t1_set1 INT, p_t2_set1 INT,
  p_t1_set2 INT, p_t2_set2 INT,
  p_t1_set3 INT DEFAULT 0, p_t2_set3 INT DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_player_account_id UUID;
  v_game_status TEXT;
  v_is_player BOOLEAN;
  v_player_position INT;
  v_submitted_by_team INT;
  v_existing_result_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  SELECT id INTO v_player_account_id FROM player_accounts WHERE user_id = v_user_id;
  
  SELECT status INTO v_game_status FROM open_games WHERE id = p_game_id;
  
  IF v_game_status IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Jogo não encontrado');
  END IF;
  
  IF v_game_status NOT IN ('full', 'open', 'completed', 'expired') THEN
    RETURN json_build_object('success', false, 'error', 'O jogo não permite submissão de resultados');
  END IF;
  
  SELECT position INTO v_player_position
  FROM open_game_players
  WHERE game_id = p_game_id AND user_id = v_user_id AND status = 'confirmed';
  
  IF v_player_position IS NULL THEN
    SELECT position INTO v_player_position
    FROM open_game_players
    WHERE game_id = p_game_id AND player_account_id = v_player_account_id AND status = 'confirmed';
  END IF;
  
  IF v_player_position IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Não és jogador confirmado neste jogo');
  END IF;
  
  v_submitted_by_team := CASE WHEN v_player_position <= 2 THEN 1 ELSE 2 END;
  
  SELECT id INTO v_existing_result_id FROM open_game_results WHERE game_id = p_game_id;
  
  IF v_existing_result_id IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'Já existe um resultado para este jogo. A equipa adversária pode confirmar ou disputar.');
  END IF;
  
  INSERT INTO open_game_results (
    game_id, submitted_by_user_id, submitted_by_player_account_id,
    team1_score_set1, team2_score_set1,
    team1_score_set2, team2_score_set2,
    team1_score_set3, team2_score_set3,
    submitted_by_team, status
  ) VALUES (
    p_game_id, v_user_id, v_player_account_id,
    p_t1_set1, p_t2_set1,
    p_t1_set2, p_t2_set2,
    p_t1_set3, p_t2_set3,
    v_submitted_by_team, 'pending'
  );
  
  UPDATE open_games SET status = 'completed' WHERE id = p_game_id;
  
  RETURN json_build_object(
    'success', true,
    'submitted_by_team', v_submitted_by_team,
    'awaiting_confirmation_from_team', CASE WHEN v_submitted_by_team = 1 THEN 2 ELSE 1 END
  );
END;
$$;
