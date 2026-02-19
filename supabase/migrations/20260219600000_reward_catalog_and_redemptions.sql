-- =====================================================
-- REWARD CATALOG + REDEMPTIONS
-- Permite clubes criar recompensas e jogadores resgatá-las
-- =====================================================

-- 1. Catálogo de recompensas (configurado pelo clube)
CREATE TABLE IF NOT EXISTS public.reward_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  cost_points INT NOT NULL DEFAULT 50,
  category TEXT DEFAULT 'other' CHECK (category IN (
    'drink',       -- Bebida grátis
    'food',        -- Comida/snack
    'court',       -- Hora de campo grátis / desconto
    'merchandise', -- T-shirt, toalha, etc.
    'lesson',      -- Aula grátis
    'discount',    -- Desconto percentual
    'experience',  -- Experiência especial
    'other'        -- Outros
  )),
  stock INT,            -- NULL = ilimitado, ou quantidade disponível
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Resgates de recompensas
CREATE TABLE IF NOT EXISTS public.reward_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_item_id UUID NOT NULL REFERENCES public.reward_catalog(id) ON DELETE CASCADE,
  player_account_id UUID NOT NULL REFERENCES public.player_accounts(id) ON DELETE CASCADE,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  points_spent INT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'used', 'cancelled')),
  redeemed_at TIMESTAMPTZ DEFAULT now(),
  approved_at TIMESTAMPTZ,
  approved_by UUID,  -- staff/owner user_id que aprovou
  used_at TIMESTAMPTZ,
  notes TEXT
);

-- 3. RLS para reward_catalog
ALTER TABLE public.reward_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active catalog items" ON public.reward_catalog;
CREATE POLICY "Anyone can view active catalog items" ON public.reward_catalog
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Club owner can manage catalog" ON public.reward_catalog;
CREATE POLICY "Club owner can manage catalog" ON public.reward_catalog
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM clubs WHERE id = club_id AND owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM clubs WHERE id = club_id AND owner_id = auth.uid())
  );

-- 4. RLS para reward_redemptions
ALTER TABLE public.reward_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Players can view their own redemptions" ON public.reward_redemptions;
CREATE POLICY "Players can view their own redemptions" ON public.reward_redemptions
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM player_accounts WHERE id = player_account_id AND user_id = auth.uid())
    OR
    EXISTS (SELECT 1 FROM clubs WHERE id = club_id AND owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "Players can insert redemptions" ON public.reward_redemptions;
CREATE POLICY "Players can insert redemptions" ON public.reward_redemptions
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM player_accounts WHERE id = player_account_id AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Club owner can update redemptions" ON public.reward_redemptions;
CREATE POLICY "Club owner can update redemptions" ON public.reward_redemptions
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM clubs WHERE id = club_id AND owner_id = auth.uid())
  );

-- 5. RPC: Resgatar recompensa (verifica pontos, desconta, reduz stock)
CREATE OR REPLACE FUNCTION redeem_reward(
  p_catalog_item_id UUID,
  p_player_account_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_current_points INT;
  v_club_id UUID;
  v_redemption_id UUID;
BEGIN
  -- Buscar item do catálogo
  SELECT * INTO v_item FROM reward_catalog WHERE id = p_catalog_item_id AND is_active = TRUE;
  
  IF v_item.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Recompensa não encontrada ou inativa');
  END IF;
  
  v_club_id := v_item.club_id;
  
  -- Verificar stock
  IF v_item.stock IS NOT NULL AND v_item.stock <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Esta recompensa está esgotada');
  END IF;
  
  -- Verificar pontos do jogador NESTE CLUBE
  SELECT total_points INTO v_current_points
  FROM player_rewards
  WHERE player_account_id = p_player_account_id AND club_id = v_club_id;
  
  IF v_current_points IS NULL OR v_current_points < v_item.cost_points THEN
    RETURN json_build_object('success', false, 'error', 
      'Pontos insuficientes. Tens ' || COALESCE(v_current_points, 0) || ' pontos, precisas de ' || v_item.cost_points);
  END IF;
  
  -- Descontar pontos
  UPDATE player_rewards
  SET total_points = total_points - v_item.cost_points, updated_at = now()
  WHERE player_account_id = p_player_account_id AND club_id = v_club_id;
  
  -- Recalcular tier
  UPDATE player_rewards
  SET tier = CASE
    WHEN total_points >= 1000 THEN 'diamond'
    WHEN total_points >= 500 THEN 'platinum'
    WHEN total_points >= 200 THEN 'gold'
    ELSE 'silver'
  END
  WHERE player_account_id = p_player_account_id AND club_id = v_club_id;
  
  -- Reduzir stock se limitado
  IF v_item.stock IS NOT NULL THEN
    UPDATE reward_catalog SET stock = stock - 1, updated_at = now() WHERE id = p_catalog_item_id;
  END IF;
  
  -- Criar registo de resgate
  INSERT INTO reward_redemptions (catalog_item_id, player_account_id, club_id, points_spent, status)
  VALUES (p_catalog_item_id, p_player_account_id, v_club_id, v_item.cost_points, 'pending')
  RETURNING id INTO v_redemption_id;
  
  -- Registar transação negativa no log
  INSERT INTO reward_transactions (player_account_id, club_id, action_type, points, description, reference_id)
  VALUES (p_player_account_id, v_club_id, 'redeem', -v_item.cost_points, 'Resgatou: ' || v_item.title, v_redemption_id);
  
  RETURN json_build_object(
    'success', true,
    'redemption_id', v_redemption_id,
    'points_spent', v_item.cost_points,
    'remaining_points', v_current_points - v_item.cost_points,
    'item_title', v_item.title
  );
END;
$$;

COMMENT ON FUNCTION redeem_reward IS 'Resgata uma recompensa do catálogo. Verifica pontos, desconta, reduz stock e regista resgate.';
GRANT EXECUTE ON FUNCTION redeem_reward TO authenticated;

-- 6. Inserir itens de catálogo padrão para todos os clubes existentes
INSERT INTO reward_catalog (club_id, title, description, cost_points, category, sort_order)
SELECT c.id, item.title, item.description, item.cost_points, item.category, item.sort_order
FROM clubs c
CROSS JOIN (VALUES
  ('Café grátis', 'Um café ao balcão', 50, 'drink', 1),
  ('Cerveja artesanal', 'Uma cerveja artesanal à escolha', 100, 'drink', 2),
  ('Hora de campo grátis', 'Uma hora de campo grátis (sujeito a disponibilidade)', 500, 'court', 3),
  ('T-shirt Padel One', 'T-shirt oficial do clube', 300, 'merchandise', 4),
  ('Aula particular', 'Uma aula particular de 1h com treinador', 400, 'lesson', 5),
  ('10% desconto no bar', 'Desconto de 10% na próxima compra no bar', 150, 'discount', 6)
) AS item(title, description, cost_points, category, sort_order)
ON CONFLICT DO NOTHING;
