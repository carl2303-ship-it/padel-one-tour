-- Platform Packs: bundled pricing (replaces à la carte on landing)

CREATE TABLE IF NOT EXISTS platform_packs (
  code text PRIMARY KEY,
  name text NOT NULL,
  tagline text,
  description text,
  price_monthly numeric(10,2) NOT NULL,
  price_annual numeric(10,2) NOT NULL,
  compare_price_monthly numeric(10,2),
  compare_price_annual numeric(10,2),
  module_codes text[] NOT NULL DEFAULT '{}',
  landing_features text[] DEFAULT '{}',
  is_popular boolean DEFAULT false,
  sort_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE platform_packs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read active packs" ON platform_packs;
CREATE POLICY "Anyone can read active packs"
  ON platform_packs FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Anon can read active packs" ON platform_packs;
CREATE POLICY "Anon can read active packs"
  ON platform_packs FOR SELECT TO anon
  USING (is_active = true);

DROP POLICY IF EXISTS "Super admins can manage packs" ON platform_packs;
CREATE POLICY "Super admins can manage packs"
  ON platform_packs FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Deactivate legacy club bundles (Bronze/Silver/Gold)
UPDATE platform_plans SET is_active = false WHERE target_type = 'club';

-- Seed the 2 packs
INSERT INTO platform_packs (
  code, name, tagline, description,
  price_monthly, price_annual, compare_price_monthly, compare_price_annual,
  module_codes, landing_features, is_popular, sort_order
) VALUES
  (
    'light',
    'Pack Light',
    'Mantém a tua app de reservas actual',
    'O plano perfeito para os clubes que querem ficar com a sua aplicação actual de Gestão de Reservas!',
    89.00, 990.00, 129.00, 1548.00,
    ARRAY['tournaments', 'ai_light', 'bar'],
    ARRAY[
      'Módulo 1 — Tour + App Player Light',
      'Módulo 3 — Agente IA Light (FAQ, preços e alertas)',
      'Módulo 4 — Gestão de Bar com QR Code',
      'Ideal para clubes com software de reservas existente'
    ],
    false,
    1
  ),
  (
    'total',
    'Pack Padel One Total',
    'Independência digital completa',
    'A solução definitiva de independência digital. Substitui por completo qualquer software concorrente e automatiza a receção a 100% via Inteligência Artificial.',
    149.00, 1590.00, 219.00, 2199.00,
    ARRAY['tournaments', 'manager', 'bar', 'ai_full', 'ai_light'],
    ARRAY[
      'TODOS OS MÓDULOS (Tour, Manager, Bar, IA)',
      'Módulo 2 — Manager + App Player completa',
      'Módulo 4 — Gestão de Bar com QR Code',
      'Agente IA Completo — reserva automática de campos',
      'Substitui qualquer software concorrente'
    ],
    true,
    2
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  tagline = EXCLUDED.tagline,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  price_annual = EXCLUDED.price_annual,
  compare_price_monthly = EXCLUDED.compare_price_monthly,
  compare_price_annual = EXCLUDED.compare_price_annual,
  module_codes = EXCLUDED.module_codes,
  landing_features = EXCLUDED.landing_features,
  is_popular = EXCLUDED.is_popular,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

-- Public RPC for landing page
CREATE OR REPLACE FUNCTION public.get_active_packs_public()
RETURNS TABLE (
  code text,
  name text,
  tagline text,
  description text,
  price_monthly numeric,
  price_annual numeric,
  compare_price_monthly numeric,
  compare_price_annual numeric,
  module_codes text[],
  landing_features text[],
  is_popular boolean,
  sort_order int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pp.code,
    pp.name,
    pp.tagline,
    pp.description,
    pp.price_monthly,
    pp.price_annual,
    pp.compare_price_monthly,
    pp.compare_price_annual,
    pp.module_codes,
    pp.landing_features,
    pp.is_popular,
    pp.sort_order
  FROM platform_packs pp
  WHERE pp.is_active = true
  ORDER BY pp.sort_order;
$$;

-- Apply a pack to a client (HQ admin)
CREATE OR REPLACE FUNCTION public.apply_client_pack(
  p_entity_type text,
  p_entity_id uuid,
  p_pack_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pack_modules text[];
  v_mod text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT module_codes INTO v_pack_modules
  FROM platform_packs
  WHERE code = p_pack_code AND is_active = true;

  IF v_pack_modules IS NULL THEN
    RAISE EXCEPTION 'Pack % not found', p_pack_code;
  END IF;

  -- Disable modules not in pack
  UPDATE client_modules
  SET enabled = false
  WHERE entity_type = p_entity_type
    AND entity_id = p_entity_id
    AND NOT (module_code = ANY(v_pack_modules));

  -- Enable pack modules in dependency order
  FOREACH v_mod IN ARRAY v_pack_modules LOOP
    PERFORM public.set_client_module(p_entity_type, p_entity_id, v_mod, true, NULL, 'Pack: ' || p_pack_code);
  END LOOP;

  RETURN jsonb_build_object(
    'pack', p_pack_code,
    'modules', public.get_client_modules(p_entity_type, p_entity_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_packs_public() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.apply_client_pack(text, uuid, text) TO authenticated;
