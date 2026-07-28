-- Default player mode lite when club has no manager module
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
  ELSE
    v_player_mode := 'lite';
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
