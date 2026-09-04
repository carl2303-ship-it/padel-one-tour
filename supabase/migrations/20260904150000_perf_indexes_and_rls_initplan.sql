-- Performance fix for slow "open tournament" page loads.
--
-- Root causes found:
-- 1) Missing indexes on hot filter/join columns used by every tournament
--    fetch (players.tournament_id, tournament_categories.tournament_id,
--    matches.category_id, teams.category_id, players.category_id),
--    forcing sequential scans on every query + every RLS subquery.
-- 2) Several RLS policies call auth.uid()/auth.jwt() directly instead of
--    (select auth.uid()), which Postgres re-evaluates per row instead of
--    caching once per statement (Supabase "auth_rls_initplan" advisory).
-- 3) The phone-based match-visibility policy joins players/player_accounts
--    on normalize_phone(phone_number) with no supporting index.
--
-- This migration only adds indexes and rewrites policy text to be
-- semantically IDENTICAL (same roles/cmd/logic), just cheaper to evaluate.
-- No access rules are changed.

-- ── 1) Missing indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_players_tournament_id ON public.players (tournament_id);
CREATE INDEX IF NOT EXISTS idx_players_category_id ON public.players (category_id);
CREATE INDEX IF NOT EXISTS idx_tournament_categories_tournament_id ON public.tournament_categories (tournament_id);
CREATE INDEX IF NOT EXISTS idx_matches_category_id ON public.matches (category_id);
CREATE INDEX IF NOT EXISTS idx_teams_category_id ON public.teams (category_id);

-- Supports the phone-enrollment RLS policy on matches (normalize_phone is IMMUTABLE).
CREATE INDEX IF NOT EXISTS idx_players_phone_normalized
  ON public.players (normalize_phone(phone_number))
  WHERE phone_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_player_accounts_phone_normalized
  ON public.player_accounts (normalize_phone(phone_number))
  WHERE phone_number IS NOT NULL;

-- ── 2) Wrap auth.uid() in (select ...) so it's computed once per query ───

-- tournaments
DROP POLICY IF EXISTS "Users can delete own tournaments" ON public.tournaments;
CREATE POLICY "Users can delete own tournaments" ON public.tournaments
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can create own tournaments" ON public.tournaments;
CREATE POLICY "Users can create own tournaments" ON public.tournaments
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own tournaments" ON public.tournaments;
CREATE POLICY "Users can update own tournaments" ON public.tournaments
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Organizers can view own tournaments" ON public.tournaments;
CREATE POLICY "Organizers can view own tournaments" ON public.tournaments
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can view tournaments" ON public.tournaments;
CREATE POLICY "Authenticated users can view tournaments" ON public.tournaments
  FOR SELECT TO authenticated
  USING (
    (user_id = (SELECT auth.uid()))
    OR (allow_public_registration = true)
    OR ((club_id IS NULL) AND ((visibility IS NULL) OR (visibility = 'public'::text)))
  );

DROP POLICY IF EXISTS "Club owners can view linked tournaments" ON public.tournaments;
CREATE POLICY "Club owners can view linked tournaments" ON public.tournaments
  FOR SELECT TO authenticated
  USING (
    (club_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM clubs
      WHERE clubs.id = tournaments.club_id
        AND clubs.owner_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Staff can view club linked tournaments" ON public.tournaments;
CREATE POLICY "Staff can view club linked tournaments" ON public.tournaments
  FOR SELECT TO authenticated
  USING (
    (club_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM club_staff cs
      JOIN clubs c ON (c.owner_id = cs.club_owner_id AND c.id = tournaments.club_id)
      WHERE cs.user_id = (SELECT auth.uid())
        AND cs.is_active = true
        AND (cs.perm_bar = true OR cs.perm_bookings = true
             OR cs.role = ANY (ARRAY['admin','kitchen','bar_staff','receptionist']))
    )
  );

-- teams
DROP POLICY IF EXISTS "Users can delete teams in their tournaments" ON public.teams;
CREATE POLICY "Users can delete teams in their tournaments" ON public.teams
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tournaments
    WHERE tournaments.id = teams.tournament_id
      AND tournaments.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Users can create teams in their tournaments" ON public.teams;
CREATE POLICY "Users can create teams in their tournaments" ON public.teams
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM tournaments
    WHERE tournaments.id = teams.tournament_id
      AND tournaments.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Auth players can create teams in free public tournaments" ON public.teams;
CREATE POLICY "Auth players can create teams in free public tournaments" ON public.teams
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = teams.tournament_id
        AND tournaments.user_id = (SELECT auth.uid())
    )
    OR is_free_public_tournament(tournament_id, category_id)
  );

DROP POLICY IF EXISTS "Authenticated players can create teams in public tournaments" ON public.teams;
CREATE POLICY "Authenticated players can create teams in public tournaments" ON public.teams
  FOR INSERT TO authenticated
  WITH CHECK (
    tournament_allows_direct_registration(tournament_id, category_id) = true
    OR EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = teams.tournament_id
        AND tournaments.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update teams in their tournaments" ON public.teams;
CREATE POLICY "Users can update teams in their tournaments" ON public.teams
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tournaments
    WHERE tournaments.id = teams.tournament_id
      AND tournaments.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM tournaments
    WHERE tournaments.id = teams.tournament_id
      AND tournaments.user_id = (SELECT auth.uid())
  ));

-- matches
DROP POLICY IF EXISTS "Users can delete matches in their tournaments" ON public.matches;
CREATE POLICY "Users can delete matches in their tournaments" ON public.matches
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tournaments
    WHERE tournaments.id = matches.tournament_id
      AND tournaments.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Users can create matches in their tournaments" ON public.matches;
CREATE POLICY "Users can create matches in their tournaments" ON public.matches
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM tournaments
    WHERE tournaments.id = matches.tournament_id
      AND tournaments.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Users can view matches in their tournaments" ON public.matches;
CREATE POLICY "Users can view matches in their tournaments" ON public.matches
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tournaments
    WHERE tournaments.id = matches.tournament_id
      AND tournaments.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Users can update matches in their tournaments" ON public.matches;
CREATE POLICY "Users can update matches in their tournaments" ON public.matches
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tournaments
    WHERE tournaments.id = matches.tournament_id
      AND tournaments.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM tournaments
    WHERE tournaments.id = matches.tournament_id
      AND tournaments.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Players can view matches in tournaments they are enrolled in" ON public.matches;
CREATE POLICY "Players can view matches in tournaments they are enrolled in" ON public.matches
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM players p
      WHERE p.tournament_id = matches.tournament_id AND p.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM teams t JOIN players p1 ON t.player1_id = p1.id
      WHERE t.tournament_id = matches.tournament_id AND p1.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM teams t JOIN players p2 ON t.player2_id = p2.id
      WHERE t.tournament_id = matches.tournament_id AND p2.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Players can view matches via phone enrollment" ON public.matches;
CREATE POLICY "Players can view matches via phone enrollment" ON public.matches
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM player_accounts pa
      JOIN players p ON normalize_phone(p.phone_number) = normalize_phone(pa.phone_number)
      WHERE pa.user_id = (SELECT auth.uid()) AND p.tournament_id = matches.tournament_id
    )
    OR EXISTS (
      SELECT 1 FROM player_accounts pa
      JOIN players p ON normalize_phone(p.phone_number) = normalize_phone(pa.phone_number)
      JOIN teams t ON (t.player1_id = p.id OR t.player2_id = p.id)
      WHERE pa.user_id = (SELECT auth.uid()) AND t.tournament_id = matches.tournament_id
    )
  );

-- players
DROP POLICY IF EXISTS "Users can delete players for their tournaments" ON public.players;
CREATE POLICY "Users can delete players for their tournaments" ON public.players
  FOR DELETE TO authenticated
  USING ((user_id = (SELECT auth.uid())) OR tournament_owned_by_user(tournament_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Auth can insert players" ON public.players;
CREATE POLICY "Auth can insert players" ON public.players
  FOR INSERT TO authenticated
  WITH CHECK (
    (tournament_id IS NULL)
    OR tournament_owned_by_user(tournament_id, (SELECT auth.uid()))
    OR (
      (tournament_allows_direct_registration(tournament_id, category_id) = true)
      AND ((user_id IS NULL) OR (user_id = (SELECT auth.uid())))
    )
  );

DROP POLICY IF EXISTS "Club owners can view linked tournament players" ON public.players;
CREATE POLICY "Club owners can view linked tournament players" ON public.players
  FOR SELECT TO authenticated
  USING (
    (tournament_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM tournaments t JOIN clubs c ON c.id = t.club_id
      WHERE t.id = players.tournament_id AND c.owner_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Organizers view own tournament players" ON public.players;
CREATE POLICY "Organizers view own tournament players" ON public.players
  FOR SELECT TO authenticated
  USING (
    ((tournament_id IS NOT NULL) AND is_tournament_owner(tournament_id))
    OR ((tournament_id IS NULL) AND (user_id = (SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "Staff can view club linked tournament players" ON public.players;
CREATE POLICY "Staff can view club linked tournament players" ON public.players
  FOR SELECT TO authenticated
  USING (
    (tournament_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM tournaments t
      JOIN clubs c ON c.id = t.club_id
      JOIN club_staff cs ON cs.club_owner_id = c.owner_id
      WHERE t.id = players.tournament_id
        AND cs.user_id = (SELECT auth.uid())
        AND cs.is_active = true
        AND (cs.perm_bar = true OR cs.perm_bookings = true
             OR cs.role = ANY (ARRAY['admin','kitchen','bar_staff','receptionist']))
    )
  );

DROP POLICY IF EXISTS "Club owners can update linked tournament players" ON public.players;
CREATE POLICY "Club owners can update linked tournament players" ON public.players
  FOR UPDATE TO authenticated
  USING (
    (tournament_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM tournaments t JOIN clubs c ON c.id = t.club_id
      WHERE t.id = players.tournament_id AND c.owner_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    (tournament_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM tournaments t JOIN clubs c ON c.id = t.club_id
      WHERE t.id = players.tournament_id AND c.owner_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Staff can update club linked tournament players" ON public.players;
CREATE POLICY "Staff can update club linked tournament players" ON public.players
  FOR UPDATE TO authenticated
  USING (
    (tournament_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM tournaments t
      JOIN clubs c ON c.id = t.club_id
      JOIN club_staff cs ON cs.club_owner_id = c.owner_id
      WHERE t.id = players.tournament_id
        AND cs.user_id = (SELECT auth.uid())
        AND cs.is_active = true
        AND (cs.perm_bar = true OR cs.perm_bookings = true
             OR cs.role = ANY (ARRAY['admin','kitchen','bar_staff','receptionist']))
    )
  )
  WITH CHECK (
    (tournament_id IS NOT NULL) AND EXISTS (
      SELECT 1 FROM tournaments t
      JOIN clubs c ON c.id = t.club_id
      JOIN club_staff cs ON cs.club_owner_id = c.owner_id
      WHERE t.id = players.tournament_id
        AND cs.user_id = (SELECT auth.uid())
        AND cs.is_active = true
        AND (cs.perm_bar = true OR cs.perm_bookings = true
             OR cs.role = ANY (ARRAY['admin','kitchen','bar_staff','receptionist']))
    )
  );

DROP POLICY IF EXISTS "Users can update players for their tournaments" ON public.players;
CREATE POLICY "Users can update players for their tournaments" ON public.players
  FOR UPDATE TO authenticated
  USING ((user_id = (SELECT auth.uid())) OR is_tournament_owner(tournament_id))
  WITH CHECK ((user_id = (SELECT auth.uid())) OR is_tournament_owner(tournament_id));

-- tournament_categories (remaining unwrapped ones)
DROP POLICY IF EXISTS "Users can delete categories in their tournaments" ON public.tournament_categories;
CREATE POLICY "Users can delete categories in their tournaments" ON public.tournament_categories
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tournaments
    WHERE tournaments.id = tournament_categories.tournament_id
      AND tournaments.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Users can create categories in their tournaments" ON public.tournament_categories;
CREATE POLICY "Users can create categories in their tournaments" ON public.tournament_categories
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM tournaments
    WHERE tournaments.id = tournament_categories.tournament_id
      AND tournaments.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Users can update categories in their tournaments" ON public.tournament_categories;
CREATE POLICY "Users can update categories in their tournaments" ON public.tournament_categories
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tournaments
    WHERE tournaments.id = tournament_categories.tournament_id
      AND tournaments.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM tournaments
    WHERE tournaments.id = tournament_categories.tournament_id
      AND tournaments.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Club owners can view linked tournament categories" ON public.tournament_categories;
CREATE POLICY "Club owners can view linked tournament categories" ON public.tournament_categories
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tournaments t JOIN clubs c ON c.id = t.club_id
    WHERE t.id = tournament_categories.tournament_id AND c.owner_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Staff can view club linked tournament categories" ON public.tournament_categories;
CREATE POLICY "Staff can view club linked tournament categories" ON public.tournament_categories
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tournaments t
    JOIN clubs c ON c.id = t.club_id
    JOIN club_staff cs ON cs.club_owner_id = c.owner_id
    WHERE t.id = tournament_categories.tournament_id
      AND cs.user_id = (SELECT auth.uid())
      AND cs.is_active = true
      AND (cs.perm_bar = true OR cs.perm_bookings = true
           OR cs.role = ANY (ARRAY['admin','kitchen','bar_staff','receptionist']))
  ));
