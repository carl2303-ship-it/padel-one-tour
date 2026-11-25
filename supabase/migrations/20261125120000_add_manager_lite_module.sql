-- Mirror of Manager migration: manager_lite module + get_client_modules flag.
-- Apply on shared Padel1 DB (rqiwnxcexsccguruiteq). Idempotent.

INSERT INTO platform_modules (
  code,
  name,
  description,
  price_monthly,
  price_annual,
  target_types,
  requires_modules,
  player_app_mode,
  landing_features,
  sort_order,
  is_active
) VALUES (
  'manager_lite',
  'Manager Lite (Organizador)',
  'Backoffice de gestão para organizador independente: jogadores, membros/planos, métricas, sponsors e conta (sem reservas/academia/bar)',
  0,
  0,
  ARRAY['organizer', 'club'],
  '{}',
  'lite',
  ARRAY[
    'CRM de jogadores e níveis',
    'Membros e planos',
    'Métricas e sponsors',
    'Conta Stripe / password',
    'Sem reservas nem academia'
  ],
  3,
  true
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  target_types = EXCLUDED.target_types,
  requires_modules = EXCLUDED.requires_modules,
  player_app_mode = EXCLUDED.player_app_mode,
  landing_features = EXCLUDED.landing_features,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

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
  v_has_manager_lite boolean;
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
  v_has_manager_lite := 'manager_lite' = ANY(v_modules);
  v_has_tournaments := 'tournaments' = ANY(v_modules);

  IF v_has_manager THEN
    v_player_mode := 'full';
  ELSE
    v_player_mode := 'lite';
  END IF;

  RETURN jsonb_build_object(
    'modules', to_jsonb(v_modules),
    'player_mode', v_player_mode,
    'has_manager', v_has_manager,
    'has_manager_lite', v_has_manager_lite,
    'has_tournaments', v_has_tournaments,
    'has_bar', 'bar' = ANY(v_modules),
    'has_ai_full', 'ai_full' = ANY(v_modules),
    'has_ai_light', 'ai_light' = ANY(v_modules)
  );
END;
$$;

INSERT INTO client_modules (entity_type, entity_id, module_code, enabled, notes)
VALUES (
  'organizer',
  '2f3df003-1ab6-4a14-b756-08800d95419a'::uuid,
  'manager_lite',
  true,
  'Fase 1 MVP Manager lite — Sports Events / Carlos'
)
ON CONFLICT (entity_type, entity_id, module_code) DO UPDATE SET
  enabled = true,
  notes = EXCLUDED.notes,
  enabled_at = COALESCE(client_modules.enabled_at, now());
