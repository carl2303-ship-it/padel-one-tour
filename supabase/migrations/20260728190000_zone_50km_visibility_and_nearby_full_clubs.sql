-- Zona 50 km, visibility players_only, nearby Full clubs

-- 1) Default radius 50 km
ALTER TABLE tournaments
  ALTER COLUMN visibility_radius_km SET DEFAULT 50;

UPDATE tournaments
SET visibility_radius_km = 50
WHERE visibility_radius_km IS NULL OR visibility_radius_km = 25;

-- 2) Allow visibility = players_only (contact list only)
DO $$
BEGIN
  ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_visibility_check;
  ALTER TABLE tournaments ADD CONSTRAINT tournaments_visibility_check
    CHECK (visibility IN ('public', 'players_only', 'invite_only'));
END;
$$;

-- 3) Nearby public tournaments only (zone discovery)
CREATE OR REPLACE FUNCTION get_nearby_tournaments(p_lat numeric, p_lng numeric)
RETURNS SETOF tournaments
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.* FROM tournaments t
  WHERE t.venue_lat IS NOT NULL
    AND t.venue_lng IS NOT NULL
    AND t.club_id IS NULL
    AND t.status IN ('draft', 'active', 'in_progress')
    AND t.end_date >= CURRENT_DATE
    AND t.visibility = 'public'
    AND (
      6371 * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(p_lat)) * cos(radians(t.venue_lat))
          * cos(radians(t.venue_lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(t.venue_lat))
        ))
      )
    ) <= COALESCE(t.visibility_radius_km, 50)
$$;

-- 4) Contact tournaments: public + players_only (not invite_only)
CREATE OR REPLACE FUNCTION get_tournaments_for_contact(p_phone text)
RETURNS SETOF tournaments
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT t.* FROM tournaments t
  JOIN organizer_players op ON op.organizer_id = t.user_id
  WHERE op.phone_number = p_phone
    AND t.status IN ('draft', 'active', 'in_progress')
    AND t.end_date >= CURRENT_DATE
    AND t.club_id IS NULL
    AND t.visibility IS DISTINCT FROM 'invite_only'
$$;

-- 5) Nearby Full clubs (manager module enabled) within radius (default 50 km)
CREATE OR REPLACE FUNCTION get_nearby_full_clubs(
  p_lat numeric,
  p_lng numeric,
  p_radius_km numeric DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  name text,
  city text,
  country text,
  address text,
  logo_url text,
  latitude double precision,
  longitude double precision,
  distance_km numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.name,
    c.city,
    c.country,
    c.address,
    c.logo_url,
    c.latitude,
    c.longitude,
    ROUND((
      6371 * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(p_lat)) * cos(radians(c.latitude))
          * cos(radians(c.longitude) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(c.latitude))
        ))
      )
    )::numeric, 1) AS distance_km
  FROM clubs c
  WHERE c.latitude IS NOT NULL
    AND c.longitude IS NOT NULL
    AND COALESCE(c.is_active, true) = true
    AND EXISTS (
      SELECT 1
      FROM client_modules cm
      WHERE cm.entity_type = 'club'
        AND cm.entity_id = c.id
        AND cm.module_code = 'manager'
        AND cm.enabled = true
        AND (cm.expires_at IS NULL OR cm.expires_at > now())
    )
    AND (
      6371 * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(p_lat)) * cos(radians(c.latitude))
          * cos(radians(c.longitude) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(c.latitude))
        ))
      )
    ) <= COALESCE(p_radius_km, 50)
  ORDER BY distance_km ASC
$$;

GRANT EXECUTE ON FUNCTION get_nearby_tournaments(numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION get_nearby_tournaments(numeric, numeric) TO anon;
GRANT EXECUTE ON FUNCTION get_tournaments_for_contact(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_tournaments_for_contact(text) TO anon;
GRANT EXECUTE ON FUNCTION get_nearby_full_clubs(numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION get_nearby_full_clubs(numeric, numeric, numeric) TO anon;

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
