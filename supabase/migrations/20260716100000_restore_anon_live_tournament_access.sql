/*
  # Restore anonymous live tournament view access

  Live TV links (/tournament/:id/live) must work for any active or completed
  tournament without requiring allow_public_registration = true.
  Registration links still require allow_public_registration via existing policies.
*/

-- tournaments: live display
DROP POLICY IF EXISTS "Anon can view active tournaments for live" ON tournaments;
CREATE POLICY "Anon can view active tournaments for live"
  ON tournaments FOR SELECT
  TO anon
  USING (status IN ('active', 'completed'));

-- matches
DROP POLICY IF EXISTS "Anon can view matches in active tournaments for live" ON matches;
CREATE POLICY "Anon can view matches in active tournaments for live"
  ON matches FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = matches.tournament_id
        AND t.status IN ('active', 'completed')
    )
  );

-- teams
DROP POLICY IF EXISTS "Anon can view teams in active tournaments for live" ON teams;
CREATE POLICY "Anon can view teams in active tournaments for live"
  ON teams FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = teams.tournament_id
        AND t.status IN ('active', 'completed')
    )
  );

-- players
DROP POLICY IF EXISTS "Anon can view players in active tournaments for live" ON players;
CREATE POLICY "Anon can view players in active tournaments for live"
  ON players FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = players.tournament_id
        AND t.status IN ('active', 'completed')
    )
  );

-- categories
DROP POLICY IF EXISTS "Anon can view categories in active tournaments for live" ON tournament_categories;
CREATE POLICY "Anon can view categories in active tournaments for live"
  ON tournament_categories FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = tournament_categories.tournament_id
        AND t.status IN ('active', 'completed')
    )
  );

-- Public registration page: anon can read tournament by id when registration is open
DROP POLICY IF EXISTS "Anon can view registration tournaments by id" ON tournaments;
CREATE POLICY "Anon can view registration tournaments by id"
  ON tournaments FOR SELECT
  TO anon
  USING (
    allow_public_registration = true
    AND status = 'active'
  );

-- RPC for reliable public tournament fetch (registration + live)
CREATE OR REPLACE FUNCTION public.get_public_tournament(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
BEGIN
  SELECT row_to_json(t)::jsonb INTO v_row
  FROM (
    SELECT id, name, description, start_date, end_date, status, format,
           image_url, number_of_courts, match_duration_minutes,
           daily_start_time, daily_end_time, club_id, round_robin_type,
           allow_public_registration, registration_fee, member_price,
           non_member_price, has_dinner_option, visibility
    FROM tournaments
    WHERE id = p_tournament_id
      AND (
        status IN ('active', 'completed')
        OR (allow_public_registration = true AND status = 'active')
      )
  ) t;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_tournament(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tournament(uuid) TO anon, authenticated;
