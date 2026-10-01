-- Fix tournament_categories SELECT timeouts (PostgREST 500).
-- Policies that EXISTS into tournaments/players re-enter tournaments RLS,
-- which evaluates is_player_enrolled_in_tournament (expensive ILIKE scans)
-- and times out. Use SECURITY DEFINER helpers instead.

CREATE OR REPLACE FUNCTION public.is_tournament_active_or_completed(p_tournament_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tournaments t
    WHERE t.id = p_tournament_id
      AND t.status = ANY (ARRAY['active'::text, 'completed'::text])
  );
$$;

CREATE OR REPLACE FUNCTION public.is_club_owner_of_tournament(p_tournament_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tournaments t
    JOIN clubs c ON c.id = t.club_id
    WHERE t.id = p_tournament_id
      AND c.owner_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_club_staff_of_tournament(p_tournament_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tournaments t
    JOIN clubs c ON c.id = t.club_id
    JOIN club_staff cs ON cs.club_owner_id = c.owner_id
    WHERE t.id = p_tournament_id
      AND cs.user_id = auth.uid()
      AND cs.is_active = true
      AND (
        cs.perm_bar = true
        OR cs.perm_bookings = true
        OR cs.role = ANY (ARRAY['admin'::text, 'kitchen'::text, 'bar_staff'::text, 'receptionist'::text])
      )
  );
$$;

-- SELECT policies: no direct joins into RLS-protected tournaments/players
DROP POLICY IF EXISTS "Authenticated users can view categories in public tournaments" ON public.tournament_categories;
CREATE POLICY "Authenticated users can view categories in public tournaments"
  ON public.tournament_categories
  FOR SELECT
  TO authenticated
  USING (is_tournament_public(tournament_id));

DROP POLICY IF EXISTS "Enrolled players can view tournament categories" ON public.tournament_categories;
CREATE POLICY "Enrolled players can view tournament categories"
  ON public.tournament_categories
  FOR SELECT
  TO authenticated
  USING (is_player_enrolled_in_tournament(tournament_id));

DROP POLICY IF EXISTS "Users can view categories in their tournaments" ON public.tournament_categories;
CREATE POLICY "Users can view categories in their tournaments"
  ON public.tournament_categories
  FOR SELECT
  TO authenticated
  USING (is_tournament_owner(tournament_id));

DROP POLICY IF EXISTS "Club owners can view linked tournament categories" ON public.tournament_categories;
CREATE POLICY "Club owners can view linked tournament categories"
  ON public.tournament_categories
  FOR SELECT
  TO authenticated
  USING (is_club_owner_of_tournament(tournament_id));

DROP POLICY IF EXISTS "Staff can view club linked tournament categories" ON public.tournament_categories;
CREATE POLICY "Staff can view club linked tournament categories"
  ON public.tournament_categories
  FOR SELECT
  TO authenticated
  USING (is_club_staff_of_tournament(tournament_id));

-- Anon policies: same pattern (avoid tournaments RLS re-entry)
DROP POLICY IF EXISTS "Anon can view categories for public tournaments" ON public.tournament_categories;
CREATE POLICY "Anon can view categories for public tournaments"
  ON public.tournament_categories
  FOR SELECT
  TO anon
  USING (is_tournament_public(tournament_id));

DROP POLICY IF EXISTS "Anonymous users can view categories in public tournaments" ON public.tournament_categories;
CREATE POLICY "Anonymous users can view categories in public tournaments"
  ON public.tournament_categories
  FOR SELECT
  TO anon
  USING (is_tournament_public(tournament_id));

DROP POLICY IF EXISTS "Anon can view categories in active tournaments for live" ON public.tournament_categories;
CREATE POLICY "Anon can view categories in active tournaments for live"
  ON public.tournament_categories
  FOR SELECT
  TO anon
  USING (is_tournament_active_or_completed(tournament_id));

-- Write policies: use owner helper (still SECURITY DEFINER)
DROP POLICY IF EXISTS "Users can create categories in their tournaments" ON public.tournament_categories;
CREATE POLICY "Users can create categories in their tournaments"
  ON public.tournament_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (is_tournament_owner(tournament_id));

DROP POLICY IF EXISTS "Users can update categories in their tournaments" ON public.tournament_categories;
CREATE POLICY "Users can update categories in their tournaments"
  ON public.tournament_categories
  FOR UPDATE
  TO authenticated
  USING (is_tournament_owner(tournament_id))
  WITH CHECK (is_tournament_owner(tournament_id));

DROP POLICY IF EXISTS "Users can delete categories in their tournaments" ON public.tournament_categories;
CREATE POLICY "Users can delete categories in their tournaments"
  ON public.tournament_categories
  FOR DELETE
  TO authenticated
  USING (is_tournament_owner(tournament_id));
