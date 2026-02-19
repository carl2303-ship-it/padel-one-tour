-- =====================================================
-- OPEN GAME RESULTS + CONFIRMATION + REWARDS SYSTEM
-- =====================================================

-- =====================================================
-- PART 1: Open Game Results
-- =====================================================

-- 1.1 Tabela de resultados de jogos abertos
CREATE TABLE IF NOT EXISTS public.open_game_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.open_games(id) ON DELETE CASCADE,
  submitted_by_user_id UUID NOT NULL,  -- auth user_id de quem submeteu
  submitted_by_player_account_id UUID REFERENCES public.player_accounts(id),
  
  -- Equipa 1: posições 1,2  |  Equipa 2: posições 3,4
  team1_score_set1 INT DEFAULT 0,
  team2_score_set1 INT DEFAULT 0,
  team1_score_set2 INT DEFAULT 0,
  team2_score_set2 INT DEFAULT 0,
  team1_score_set3 INT DEFAULT 0,
  team2_score_set3 INT DEFAULT 0,
  
  -- Qual equipa submeteu (1 ou 2)
  submitted_by_team INT NOT NULL CHECK (submitted_by_team IN (1, 2)),
  
  -- Status do resultado
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'disputed')),
  
  -- Quem confirmou (jogador da outra equipa)
  confirmed_by_user_id UUID,
  confirmed_by_player_account_id UUID REFERENCES public.player_accounts(id),
  confirmed_at TIMESTAMPTZ,
  
  -- Se o rating já foi processado
  rating_processed BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Apenas um resultado por jogo
  UNIQUE(game_id)
);

-- 1.2 RLS para open_game_results
ALTER TABLE public.open_game_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view game results" ON public.open_game_results;
CREATE POLICY "Anyone can view game results" ON public.open_game_results
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Game players can submit results" ON public.open_game_results;
CREATE POLICY "Game players can submit results" ON public.open_game_results
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = submitted_by_user_id);

DROP POLICY IF EXISTS "Game players can update results" ON public.open_game_results;
CREATE POLICY "Game players can update results" ON public.open_game_results
  FOR UPDATE TO authenticated USING (
    auth.uid() = submitted_by_user_id 
    OR EXISTS (
      SELECT 1 FROM public.open_game_players
      WHERE game_id = open_game_results.game_id AND user_id = auth.uid() AND status = 'confirmed'
    )
  );

-- 1.3 RPC: Submeter resultado de um jogo aberto
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
  
  -- Buscar player_account_id
  SELECT id INTO v_player_account_id FROM player_accounts WHERE user_id = v_user_id;
  
  -- Verificar que o jogo existe e está 'full' ou 'completed'
  SELECT status INTO v_game_status FROM open_games WHERE id = p_game_id;
  
  IF v_game_status IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Jogo não encontrado');
  END IF;
  
  IF v_game_status NOT IN ('full', 'open', 'completed') THEN
    RETURN json_build_object('success', false, 'error', 'O jogo não permite submissão de resultados');
  END IF;
  
  -- Verificar que é jogador confirmado
  SELECT position INTO v_player_position
  FROM open_game_players
  WHERE game_id = p_game_id AND user_id = v_user_id AND status = 'confirmed';
  
  IF v_player_position IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Não és jogador confirmado neste jogo');
  END IF;
  
  -- Determinar equipa (posição 1,2 = equipa 1; posição 3,4 = equipa 2)
  v_submitted_by_team := CASE WHEN v_player_position <= 2 THEN 1 ELSE 2 END;
  
  -- Verificar se já existe resultado
  SELECT id INTO v_existing_result_id FROM open_game_results WHERE game_id = p_game_id;
  
  IF v_existing_result_id IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'Já existe um resultado para este jogo. A equipa adversária pode confirmar ou disputar.');
  END IF;
  
  -- Inserir resultado
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
  
  -- Atualizar status do jogo para 'completed'
  UPDATE open_games SET status = 'completed' WHERE id = p_game_id;
  
  RETURN json_build_object(
    'success', true,
    'submitted_by_team', v_submitted_by_team,
    'awaiting_confirmation_from_team', CASE WHEN v_submitted_by_team = 1 THEN 2 ELSE 1 END
  );
END;
$$;

COMMENT ON FUNCTION submit_open_game_result IS 'Submete resultado de um jogo aberto. A equipa adversária deve confirmar.';
GRANT EXECUTE ON FUNCTION submit_open_game_result TO authenticated;

-- 1.4 RPC: Confirmar resultado de um jogo aberto
CREATE OR REPLACE FUNCTION confirm_open_game_result(
  p_game_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_player_account_id UUID;
  v_result RECORD;
  v_player_position INT;
  v_confirmer_team INT;
BEGIN
  v_user_id := auth.uid();
  
  -- Buscar player_account_id
  SELECT id INTO v_player_account_id FROM player_accounts WHERE user_id = v_user_id;
  
  -- Buscar resultado pendente
  SELECT * INTO v_result FROM open_game_results WHERE game_id = p_game_id AND status = 'pending';
  
  IF v_result.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Nenhum resultado pendente para este jogo');
  END IF;
  
  -- Verificar que é jogador confirmado
  SELECT position INTO v_player_position
  FROM open_game_players
  WHERE game_id = p_game_id AND user_id = v_user_id AND status = 'confirmed';
  
  IF v_player_position IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Não és jogador confirmado neste jogo');
  END IF;
  
  -- Determinar equipa do confirmador
  v_confirmer_team := CASE WHEN v_player_position <= 2 THEN 1 ELSE 2 END;
  
  -- A confirmação tem de vir da equipa oposta
  IF v_confirmer_team = v_result.submitted_by_team THEN
    RETURN json_build_object('success', false, 'error', 'A confirmação tem de ser feita por um jogador da equipa adversária');
  END IF;
  
  -- Confirmar resultado
  UPDATE open_game_results SET
    status = 'confirmed',
    confirmed_by_user_id = v_user_id,
    confirmed_by_player_account_id = v_player_account_id,
    confirmed_at = now(),
    updated_at = now()
  WHERE id = v_result.id;
  
  RETURN json_build_object('success', true, 'message', 'Resultado confirmado! Os níveis serão atualizados.');
END;
$$;

COMMENT ON FUNCTION confirm_open_game_result IS 'Confirma resultado de um jogo aberto. Apenas jogadores da equipa adversária podem confirmar.';
GRANT EXECUTE ON FUNCTION confirm_open_game_result TO authenticated;

-- 1.5 RPC: Disputar resultado (se a outra equipa não concorda)
CREATE OR REPLACE FUNCTION dispute_open_game_result(
  p_game_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_result RECORD;
  v_player_position INT;
  v_confirmer_team INT;
BEGIN
  v_user_id := auth.uid();
  
  -- Buscar resultado pendente
  SELECT * INTO v_result FROM open_game_results WHERE game_id = p_game_id AND status = 'pending';
  
  IF v_result.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Nenhum resultado pendente para disputar');
  END IF;
  
  -- Verificar que é jogador confirmado
  SELECT position INTO v_player_position
  FROM open_game_players
  WHERE game_id = p_game_id AND user_id = v_user_id AND status = 'confirmed';
  
  IF v_player_position IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Não és jogador confirmado neste jogo');
  END IF;
  
  -- A disputa tem de vir da equipa oposta
  v_confirmer_team := CASE WHEN v_player_position <= 2 THEN 1 ELSE 2 END;
  IF v_confirmer_team = v_result.submitted_by_team THEN
    RETURN json_build_object('success', false, 'error', 'Apenas a equipa adversária pode disputar o resultado');
  END IF;
  
  -- Marcar como disputado — resultado é APAGADO para poder ser resubmetido
  DELETE FROM open_game_results WHERE id = v_result.id;
  
  -- Reabrir o jogo para nova submissão
  UPDATE open_games SET status = 'full' WHERE id = p_game_id;
  
  RETURN json_build_object('success', true, 'message', 'Resultado disputado. Qualquer jogador pode submeter novo resultado.');
END;
$$;

COMMENT ON FUNCTION dispute_open_game_result IS 'Disputa resultado de um jogo aberto. Remove o resultado para nova submissão.';
GRANT EXECUTE ON FUNCTION dispute_open_game_result TO authenticated;


-- =====================================================
-- PART 2: Rewards System
-- =====================================================

-- 2.1 Tabela de regras de rewards (configuradas pelo clube)
CREATE TABLE IF NOT EXISTS public.reward_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'create_game',       -- Criar jogo aberto
    'join_game',         -- Entrar num jogo aberto
    'submit_result',     -- Submeter resultado
    'confirm_result',    -- Confirmar resultado
    'tournament_played', -- Participar num torneio
    'bar_spend',         -- Gastar no bar (por cada X€)
    'first_game',        -- Primeiro jogo (bónus)
    'streak_3',          -- 3 jogos seguidos
    'streak_7',          -- 7 jogos seguidos
    'custom'             -- Regra personalizada
  )),
  points INT NOT NULL DEFAULT 10,
  description TEXT,
  spend_threshold NUMERIC DEFAULT 10.0,  -- Para bar_spend: pontos por cada X€
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(club_id, action_type)
);

-- 2.2 Tabela de pontos reward dos jogadores
CREATE TABLE IF NOT EXISTS public.player_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_account_id UUID NOT NULL REFERENCES public.player_accounts(id) ON DELETE CASCADE,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  total_points INT NOT NULL DEFAULT 0,
  tier TEXT DEFAULT 'silver' CHECK (tier IN ('silver', 'gold', 'platinum', 'diamond')),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(player_account_id, club_id)
);

-- 2.3 Tabela de transações de reward (log)
CREATE TABLE IF NOT EXISTS public.reward_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_account_id UUID NOT NULL REFERENCES public.player_accounts(id) ON DELETE CASCADE,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  points INT NOT NULL,
  description TEXT,
  reference_id UUID,  -- game_id, tournament_id, etc.
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2.4 RLS para as tabelas de rewards
ALTER TABLE public.reward_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_transactions ENABLE ROW LEVEL SECURITY;

-- reward_rules: qualquer autenticado pode ver, apenas dono do clube pode modificar
DROP POLICY IF EXISTS "Anyone can view reward rules" ON public.reward_rules;
CREATE POLICY "Anyone can view reward rules" ON public.reward_rules
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Club owner can manage reward rules" ON public.reward_rules;
CREATE POLICY "Club owner can manage reward rules" ON public.reward_rules
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM clubs WHERE id = club_id AND owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM clubs WHERE id = club_id AND owner_id = auth.uid())
  );

-- player_rewards: qualquer autenticado pode ver, apenas sistema (SECURITY DEFINER) modifica
DROP POLICY IF EXISTS "Anyone can view player rewards" ON public.player_rewards;
CREATE POLICY "Anyone can view player rewards" ON public.player_rewards
  FOR SELECT TO authenticated USING (true);

-- reward_transactions: jogador pode ver as suas
DROP POLICY IF EXISTS "Players can view their own transactions" ON public.reward_transactions;
CREATE POLICY "Players can view their own transactions" ON public.reward_transactions
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM player_accounts WHERE id = player_account_id AND user_id = auth.uid())
    OR
    EXISTS (SELECT 1 FROM clubs WHERE id = club_id AND owner_id = auth.uid())
  );

-- 2.5 RPC: Atribuir pontos de reward
CREATE OR REPLACE FUNCTION award_reward_points(
  p_player_account_id UUID,
  p_club_id UUID,
  p_action_type TEXT,
  p_reference_id UUID DEFAULT NULL,
  p_custom_description TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule RECORD;
  v_points INT;
  v_new_total INT;
  v_tier TEXT;
BEGIN
  -- Buscar regra de reward para esta ação neste clube
  SELECT * INTO v_rule FROM reward_rules 
  WHERE club_id = p_club_id AND action_type = p_action_type AND is_active = TRUE;
  
  IF v_rule.id IS NULL THEN
    -- Sem regra configurada, sem pontos
    RETURN json_build_object('success', false, 'error', 'Sem regra de reward configurada para esta ação');
  END IF;
  
  v_points := v_rule.points;
  
  -- Verificar duplicação (mesma referência)
  IF p_reference_id IS NOT NULL THEN
    PERFORM 1 FROM reward_transactions
    WHERE player_account_id = p_player_account_id
      AND club_id = p_club_id
      AND action_type = p_action_type
      AND reference_id = p_reference_id;
    IF FOUND THEN
      RETURN json_build_object('success', false, 'error', 'Pontos já atribuídos para esta ação');
    END IF;
  END IF;
  
  -- Inserir transação
  INSERT INTO reward_transactions (player_account_id, club_id, action_type, points, description, reference_id)
  VALUES (p_player_account_id, p_club_id, p_action_type, v_points, COALESCE(p_custom_description, v_rule.description), p_reference_id);
  
  -- Atualizar ou inserir total de pontos
  INSERT INTO player_rewards (player_account_id, club_id, total_points)
  VALUES (p_player_account_id, p_club_id, v_points)
  ON CONFLICT (player_account_id, club_id)
  DO UPDATE SET total_points = player_rewards.total_points + v_points, updated_at = now();
  
  -- Calcular novo total e tier
  SELECT total_points INTO v_new_total FROM player_rewards
  WHERE player_account_id = p_player_account_id AND club_id = p_club_id;
  
  -- Atualizar tier
  v_tier := CASE
    WHEN v_new_total >= 1000 THEN 'diamond'
    WHEN v_new_total >= 500 THEN 'platinum'
    WHEN v_new_total >= 200 THEN 'gold'
    ELSE 'silver'
  END;
  
  UPDATE player_rewards SET tier = v_tier
  WHERE player_account_id = p_player_account_id AND club_id = p_club_id;
  
  RETURN json_build_object(
    'success', true,
    'points_earned', v_points,
    'new_total', v_new_total,
    'tier', v_tier
  );
END;
$$;

COMMENT ON FUNCTION award_reward_points IS 'Atribui pontos de reward a um jogador. Verifica regras do clube e evita duplicados.';
GRANT EXECUTE ON FUNCTION award_reward_points TO authenticated;

-- 2.6 Inserir regras de reward padrão para todos os clubes existentes
INSERT INTO reward_rules (club_id, action_type, points, description)
SELECT c.id, rule.action_type, rule.points, rule.description
FROM clubs c
CROSS JOIN (VALUES
  ('create_game', 15, 'Criou um jogo aberto'),
  ('join_game', 10, 'Entrou num jogo aberto'),
  ('submit_result', 5, 'Submeteu resultado'),
  ('confirm_result', 5, 'Confirmou resultado'),
  ('tournament_played', 20, 'Participou num torneio'),
  ('bar_spend', 5, 'Consumo no bar (por cada 10€)'),
  ('first_game', 25, 'Primeiro jogo na plataforma')
) AS rule(action_type, points, description)
ON CONFLICT (club_id, action_type) DO NOTHING;

-- 2.7 Adicionar coluna reward_points à player_accounts para acesso rápido (total global)
ALTER TABLE public.player_accounts ADD COLUMN IF NOT EXISTS total_reward_points INT DEFAULT 0;
