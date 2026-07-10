-- Platform Modules System: à la carte module catalog + per-client entitlements

-- 1. Module catalog (pricing + metadata)
CREATE TABLE IF NOT EXISTS platform_modules (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text,
  price_monthly numeric(10,2),
  price_annual numeric(10,2),
  target_types text[] NOT NULL,
  requires_modules text[] DEFAULT '{}',
  player_app_mode text CHECK (player_app_mode IN ('lite', 'full') OR player_app_mode IS NULL),
  landing_features text[] DEFAULT '{}',
  sort_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE platform_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read active modules" ON platform_modules;
CREATE POLICY "Anyone can read active modules"
  ON platform_modules FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Anon can read active modules" ON platform_modules;
CREATE POLICY "Anon can read active modules"
  ON platform_modules FOR SELECT TO anon
  USING (is_active = true);

DROP POLICY IF EXISTS "Super admins can manage modules" ON platform_modules;
CREATE POLICY "Super admins can manage modules"
  ON platform_modules FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- 2. Per-client module entitlements
CREATE TABLE IF NOT EXISTS client_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('club', 'organizer')),
  entity_id uuid NOT NULL,
  module_code text NOT NULL REFERENCES platform_modules(code) ON DELETE CASCADE,
  enabled boolean DEFAULT false,
  enabled_at timestamptz,
  expires_at timestamptz,
  enabled_by uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(entity_type, entity_id, module_code)
);

CREATE INDEX IF NOT EXISTS idx_client_modules_entity ON client_modules(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_client_modules_enabled ON client_modules(entity_type, entity_id, enabled) WHERE enabled = true;

ALTER TABLE client_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can manage client modules" ON client_modules;
CREATE POLICY "Super admins can manage client modules"
  ON client_modules FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Club owners can read their modules" ON client_modules;
CREATE POLICY "Club owners can read their modules"
  ON client_modules FOR SELECT TO authenticated
  USING (
    entity_type = 'club'
    AND EXISTS (
      SELECT 1 FROM clubs c
      WHERE c.id = client_modules.entity_id
        AND c.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Organizers can read their modules" ON client_modules;
CREATE POLICY "Organizers can read their modules"
  ON client_modules FOR SELECT TO authenticated
  USING (
    entity_type = 'organizer'
    AND entity_id = auth.uid()
  );

-- 3. Seed the 5 modules
INSERT INTO platform_modules (code, name, description, price_monthly, price_annual, target_types, requires_modules, player_app_mode, landing_features, sort_order) VALUES
  (
    'tournaments',
    'Torneios',
    'Criação e gestão de torneios com tour.padel1.app + app jogador lite (sem reservas, jogos ou clubes)',
    19.99, 199.99,
    ARRAY['club', 'organizer'],
    '{}',
    'lite',
    ARRAY[
      'Gestão completa de torneios',
      'Americanos, grupos, eliminatórias',
      'Ligas multi-torneio',
      'Inscrições online com pagamento',
      'App jogador lite para participantes'
    ],
    1
  ),
  (
    'manager',
    'Gestão de Clube & Academia',
    'manager.padel1.app para gerir clube e academia + app jogador completa',
    49.99, 499.99,
    ARRAY['club'],
    '{}',
    'full',
    ARRAY[
      'Gestão de campos e reservas',
      'Academia e aulas',
      'Membros e planos de sócio',
      'Staff e permissões',
      'App jogador completa (padel1.app)'
    ],
    2
  ),
  (
    'bar',
    'Bar & Restaurante QR',
    'Gestão de bar/restaurante com menu QR Code para clientes',
    14.99, 149.99,
    ARRAY['club'],
    '{}',
    NULL,
    ARRAY[
      'Gestão de menu e pedidos',
      'Contas e consumos',
      'Menu público com QR Code',
      'Relatórios de bar',
      'Integração com recompensas'
    ],
    3
  ),
  (
    'ai_full',
    'Agente IA Completo',
    'Reservas automáticas via WhatsApp, Instagram, Facebook e website (requer módulo Manager)',
    29.99, 299.99,
    ARRAY['club'],
    ARRAY['manager'],
    NULL,
    ARRAY[
      'Reservas automáticas 24/7',
      'WhatsApp, Instagram, Facebook',
      'Chat no website',
      'Consulta de disponibilidade',
      'Confirmação automática'
    ],
    4
  ),
  (
    'ai_light',
    'Agente IA Light',
    'Respostas automáticas a FAQ e preços. Alerta admin em pedidos de reserva',
    9.99, 99.99,
    ARRAY['club', 'organizer'],
    '{}',
    NULL,
    ARRAY[
      'Respostas automáticas FAQ',
      'Informação de preços',
      'WhatsApp, Instagram, Facebook',
      'Chat no website',
      'Alerta admin para reservas'
    ],
    5
  )
ON CONFLICT (code) DO NOTHING;

-- 4. Helper: check if a module is active for an entity
CREATE OR REPLACE FUNCTION public.has_module(
  p_entity_type text,
  p_entity_id uuid,
  p_module_code text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM client_modules cm
    WHERE cm.entity_type = p_entity_type
      AND cm.entity_id = p_entity_id
      AND cm.module_code = p_module_code
      AND cm.enabled = true
      AND (cm.expires_at IS NULL OR cm.expires_at > now())
  );
END;
$$;

-- 5. Get all active modules for an entity + derived player mode
CREATE OR REPLACE FUNCTION public.get_client_modules(
  p_entity_type text,
  p_entity_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modules text[];
  v_player_mode text;
  v_has_manager boolean;
  v_has_tournaments boolean;
BEGIN
  SELECT array_agg(cm.module_code ORDER BY pm.sort_order)
  INTO v_modules
  FROM client_modules cm
  JOIN platform_modules pm ON pm.code = cm.module_code
  WHERE cm.entity_type = p_entity_type
    AND cm.entity_id = p_entity_id
    AND cm.enabled = true
    AND (cm.expires_at IS NULL OR cm.expires_at > now())
    AND pm.is_active = true;

  v_modules := COALESCE(v_modules, ARRAY[]::text[]);
  v_has_manager := 'manager' = ANY(v_modules);
  v_has_tournaments := 'tournaments' = ANY(v_modules);

  IF v_has_manager THEN
    v_player_mode := 'full';
  ELSIF v_has_tournaments THEN
    v_player_mode := 'lite';
  ELSE
    v_player_mode := 'full';
  END IF;

  RETURN jsonb_build_object(
    'modules', to_jsonb(v_modules),
    'player_mode', v_player_mode,
    'has_manager', v_has_manager,
    'has_tournaments', v_has_tournaments,
    'has_bar', 'bar' = ANY(v_modules),
    'has_ai_full', 'ai_full' = ANY(v_modules),
    'has_ai_light', 'ai_light' = ANY(v_modules)
  );
END;
$$;

-- 6. Public catalog for landing page
CREATE OR REPLACE FUNCTION public.get_active_modules_public()
RETURNS TABLE (
  code text,
  name text,
  description text,
  price_monthly numeric,
  price_annual numeric,
  target_types text[],
  requires_modules text[],
  player_app_mode text,
  landing_features text[],
  sort_order int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pm.code,
    pm.name,
    pm.description,
    pm.price_monthly,
    pm.price_annual,
    pm.target_types,
    pm.requires_modules,
    pm.player_app_mode,
    pm.landing_features,
    pm.sort_order
  FROM platform_modules pm
  WHERE pm.is_active = true
  ORDER BY pm.sort_order;
$$;

-- 7. Toggle module for a client (HQ admin)
CREATE OR REPLACE FUNCTION public.set_client_module(
  p_entity_type text,
  p_entity_id uuid,
  p_module_code text,
  p_enabled boolean,
  p_expires_at timestamptz DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requires text[];
  v_req text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT requires_modules INTO v_requires
  FROM platform_modules
  WHERE code = p_module_code;

  IF p_enabled AND v_requires IS NOT NULL THEN
    FOREACH v_req IN ARRAY v_requires LOOP
      IF NOT public.has_module(p_entity_type, p_entity_id, v_req) THEN
        RAISE EXCEPTION 'Module % requires % to be active first', p_module_code, v_req;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO client_modules (entity_type, entity_id, module_code, enabled, enabled_at, expires_at, enabled_by, notes)
  VALUES (
    p_entity_type,
    p_entity_id,
    p_module_code,
    p_enabled,
    CASE WHEN p_enabled THEN now() ELSE NULL END,
    p_expires_at,
    auth.uid(),
    p_notes
  )
  ON CONFLICT (entity_type, entity_id, module_code) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    enabled_at = CASE WHEN EXCLUDED.enabled THEN now() ELSE client_modules.enabled_at END,
    expires_at = EXCLUDED.expires_at,
    enabled_by = auth.uid(),
    notes = COALESCE(EXCLUDED.notes, client_modules.notes);

  -- Sync tour_license_active for backward compat
  IF p_entity_type = 'club' AND p_module_code = 'tournaments' THEN
    UPDATE clubs SET tour_license_active = p_enabled WHERE id = p_entity_id;
  END IF;

  RETURN public.get_client_modules(p_entity_type, p_entity_id);
END;
$$;

-- 8. Bulk enable all modules for a client (rollout helper)
CREATE OR REPLACE FUNCTION public.bulk_enable_all_modules(
  p_entity_type text,
  p_entity_id uuid,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mod record;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  FOR v_mod IN
    SELECT code FROM platform_modules
    WHERE is_active = true
      AND p_entity_type = ANY(target_types)
    ORDER BY sort_order
  LOOP
    PERFORM public.set_client_module(p_entity_type, p_entity_id, v_mod.code, true, p_expires_at, 'Bulk enable');
  END LOOP;

  RETURN public.get_client_modules(p_entity_type, p_entity_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_module(text, uuid, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_client_modules(text, uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_modules_public() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_client_module(text, uuid, text, boolean, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_enable_all_modules(text, uuid, timestamptz) TO authenticated;
