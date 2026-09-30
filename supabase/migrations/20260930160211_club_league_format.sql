-- Liga de Clubes: format club_league + tables + lineup RPC + game_format 2sets_stb

-- ---------------------------------------------------------------------------
-- Format check constraints
-- ---------------------------------------------------------------------------
ALTER TABLE tournaments
  DROP CONSTRAINT IF EXISTS tournaments_format_check;

ALTER TABLE tournaments
  ADD CONSTRAINT tournaments_format_check
  CHECK (format IN (
    'single_elimination',
    'round_robin',
    'groups_knockout',
    'individual_groups_knockout',
    'super_teams',
    'crossed_playoffs',
    'crossed_playoffs_teams',
    'mixed_gender',
    'mixed_american',
    'ladder',
    'swiss_teams',
    'club_league'
  ));

ALTER TABLE tournament_categories
  DROP CONSTRAINT IF EXISTS tournament_categories_format_check;

ALTER TABLE tournament_categories
  ADD CONSTRAINT tournament_categories_format_check
  CHECK (format IN (
    'single_elimination',
    'round_robin',
    'groups_knockout',
    'individual_groups_knockout',
    'super_teams',
    'crossed_playoffs',
    'crossed_playoffs_teams',
    'mixed_gender',
    'mixed_american',
    'ladder',
    'swiss_teams',
    'club_league'
  ));

-- game_format: best of 2 sets + super tie-break
ALTER TABLE tournament_categories
  DROP CONSTRAINT IF EXISTS tournament_categories_game_format_check;

ALTER TABLE tournament_categories
  ADD CONSTRAINT tournament_categories_game_format_check
  CHECK (game_format IS NULL OR game_format IN ('1set', '3sets', '2sets_stb'));

COMMENT ON COLUMN tournament_categories.game_format IS
  'Formato dos jogos: 1set, 3sets (melhor de 3), 2sets_stb (melhor de 2 + super TB)';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS club_league_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id UUID REFERENCES tournament_categories(id) ON DELETE SET NULL,
  club_id UUID REFERENCES clubs(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  captain_player_id UUID,
  registration_order INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS club_league_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES club_league_teams(id) ON DELETE CASCADE,
  player_account_id UUID REFERENCES player_accounts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone_number TEXT,
  fpp_points NUMERIC(8,2) NOT NULL DEFAULT 0,
  is_captain BOOLEAN DEFAULT FALSE,
  player_order INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE club_league_teams
  DROP CONSTRAINT IF EXISTS club_league_teams_captain_fk;

ALTER TABLE club_league_teams
  ADD CONSTRAINT club_league_teams_captain_fk
  FOREIGN KEY (captain_player_id) REFERENCES club_league_players(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS club_league_matchdays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id UUID REFERENCES tournament_categories(id) ON DELETE SET NULL,
  matchday_number INTEGER NOT NULL,
  matchday_date DATE,
  label TEXT,
  leg TEXT NOT NULL DEFAULT 'home' CHECK (leg IN ('home', 'away')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tournament_id, category_id, matchday_number)
);

CREATE TABLE IF NOT EXISTS club_league_confrontations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id UUID REFERENCES tournament_categories(id) ON DELETE SET NULL,
  matchday_id UUID REFERENCES club_league_matchdays(id) ON DELETE CASCADE,
  home_team_id UUID REFERENCES club_league_teams(id) ON DELETE SET NULL,
  away_team_id UUID REFERENCES club_league_teams(id) ON DELETE SET NULL,
  scheduled_time TIMESTAMPTZ,
  venue TEXT,
  court_name TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  winner_team_id UUID REFERENCES club_league_teams(id) ON DELETE SET NULL,
  home_duos_won INTEGER NOT NULL DEFAULT 0,
  away_duos_won INTEGER NOT NULL DEFAULT 0,
  home_sets_won INTEGER NOT NULL DEFAULT 0,
  away_sets_won INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS club_league_lineups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confrontation_id UUID NOT NULL REFERENCES club_league_confrontations(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES club_league_teams(id) ON DELETE CASCADE,
  duo1_player1_id UUID REFERENCES club_league_players(id) ON DELETE SET NULL,
  duo1_player2_id UUID REFERENCES club_league_players(id) ON DELETE SET NULL,
  duo2_player1_id UUID REFERENCES club_league_players(id) ON DELETE SET NULL,
  duo2_player2_id UUID REFERENCES club_league_players(id) ON DELETE SET NULL,
  duo3_player1_id UUID REFERENCES club_league_players(id) ON DELETE SET NULL,
  duo3_player2_id UUID REFERENCES club_league_players(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (confrontation_id, team_id)
);

CREATE TABLE IF NOT EXISTS club_league_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confrontation_id UUID NOT NULL REFERENCES club_league_confrontations(id) ON DELETE CASCADE,
  game_type TEXT NOT NULL CHECK (game_type IN ('duo1', 'duo2', 'duo3')),
  game_order INTEGER NOT NULL DEFAULT 1,
  home_set1 INTEGER,
  away_set1 INTEGER,
  home_set2 INTEGER,
  away_set2 INTEGER,
  home_stb INTEGER,
  away_stb INTEGER,
  winner_team_id UUID REFERENCES club_league_teams(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (confrontation_id, game_type)
);

CREATE TABLE IF NOT EXISTS club_league_standings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id UUID REFERENCES tournament_categories(id) ON DELETE SET NULL,
  team_id UUID NOT NULL REFERENCES club_league_teams(id) ON DELETE CASCADE,
  played INTEGER NOT NULL DEFAULT 0,
  won INTEGER NOT NULL DEFAULT 0,
  lost INTEGER NOT NULL DEFAULT 0,
  sets_won INTEGER NOT NULL DEFAULT 0,
  sets_lost INTEGER NOT NULL DEFAULT 0,
  sets_diff INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  position INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tournament_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_cl_teams_tournament ON club_league_teams(tournament_id);
CREATE INDEX IF NOT EXISTS idx_cl_teams_category ON club_league_teams(category_id);
CREATE INDEX IF NOT EXISTS idx_cl_players_team ON club_league_players(team_id);
CREATE INDEX IF NOT EXISTS idx_cl_matchdays_tournament ON club_league_matchdays(tournament_id);
CREATE INDEX IF NOT EXISTS idx_cl_confrontations_tournament ON club_league_confrontations(tournament_id);
CREATE INDEX IF NOT EXISTS idx_cl_confrontations_matchday ON club_league_confrontations(matchday_id);
CREATE INDEX IF NOT EXISTS idx_cl_lineups_confrontation ON club_league_lineups(confrontation_id);
CREATE INDEX IF NOT EXISTS idx_cl_games_confrontation ON club_league_games(confrontation_id);
CREATE INDEX IF NOT EXISTS idx_cl_standings_tournament ON club_league_standings(tournament_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_club_league_tournament_owner(p_tournament_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tournaments t
    WHERE t.id = p_tournament_id
      AND t.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_club_league_team_captain(p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM club_league_players p
    JOIN player_accounts pa ON pa.id = p.player_account_id
    WHERE p.team_id = p_team_id
      AND p.is_captain = TRUE
      AND pa.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.club_league_lineup_is_visible(p_confrontation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM club_league_confrontations c
    WHERE c.id = p_confrontation_id
      AND (
        c.scheduled_time IS NULL
        OR now() >= (c.scheduled_time - INTERVAL '30 minutes')
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE club_league_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_league_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_league_matchdays ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_league_confrontations ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_league_lineups ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_league_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_league_standings ENABLE ROW LEVEL SECURITY;

-- Public read (except lineups — restricted)
CREATE POLICY "cl_teams_select" ON club_league_teams FOR SELECT USING (true);
CREATE POLICY "cl_players_select" ON club_league_players FOR SELECT USING (true);
CREATE POLICY "cl_matchdays_select" ON club_league_matchdays FOR SELECT USING (true);
CREATE POLICY "cl_confrontations_select" ON club_league_confrontations FOR SELECT USING (true);
CREATE POLICY "cl_games_select" ON club_league_games FOR SELECT USING (true);
CREATE POLICY "cl_standings_select" ON club_league_standings FOR SELECT USING (true);

CREATE POLICY "cl_lineups_select" ON club_league_lineups FOR SELECT USING (
  public.club_league_lineup_is_visible(confrontation_id)
  OR public.is_club_league_tournament_owner(
       (SELECT tournament_id FROM club_league_confrontations WHERE id = confrontation_id)
     )
  OR public.is_club_league_team_captain(team_id)
);

-- Writes: authenticated; organizer policies for delete
CREATE POLICY "cl_teams_insert" ON club_league_teams FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cl_teams_update" ON club_league_teams FOR UPDATE TO authenticated USING (true);
CREATE POLICY "cl_teams_delete" ON club_league_teams FOR DELETE TO authenticated
  USING (public.is_club_league_tournament_owner(tournament_id));

CREATE POLICY "cl_players_insert" ON club_league_players FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cl_players_update" ON club_league_players FOR UPDATE TO authenticated USING (true);
CREATE POLICY "cl_players_delete" ON club_league_players FOR DELETE TO authenticated
  USING (
    public.is_club_league_tournament_owner(
      (SELECT tournament_id FROM club_league_teams WHERE id = team_id)
    )
  );

CREATE POLICY "cl_matchdays_insert" ON club_league_matchdays FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cl_matchdays_update" ON club_league_matchdays FOR UPDATE TO authenticated USING (true);
CREATE POLICY "cl_matchdays_delete" ON club_league_matchdays FOR DELETE TO authenticated
  USING (public.is_club_league_tournament_owner(tournament_id));

CREATE POLICY "cl_confrontations_insert" ON club_league_confrontations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cl_confrontations_update" ON club_league_confrontations FOR UPDATE TO authenticated USING (true);
CREATE POLICY "cl_confrontations_delete" ON club_league_confrontations FOR DELETE TO authenticated
  USING (public.is_club_league_tournament_owner(tournament_id));

CREATE POLICY "cl_lineups_insert" ON club_league_lineups FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cl_lineups_update" ON club_league_lineups FOR UPDATE TO authenticated USING (
  public.is_club_league_tournament_owner(
    (SELECT tournament_id FROM club_league_confrontations WHERE id = confrontation_id)
  )
  OR (
    public.is_club_league_team_captain(team_id)
    AND (
      SELECT c.scheduled_time IS NULL
          OR now() < (c.scheduled_time - INTERVAL '30 minutes')
      FROM club_league_confrontations c WHERE c.id = confrontation_id
    )
  )
);
CREATE POLICY "cl_lineups_delete" ON club_league_lineups FOR DELETE TO authenticated
  USING (
    public.is_club_league_tournament_owner(
      (SELECT tournament_id FROM club_league_confrontations WHERE id = confrontation_id)
    )
  );

CREATE POLICY "cl_games_insert" ON club_league_games FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cl_games_update" ON club_league_games FOR UPDATE TO authenticated USING (true);
CREATE POLICY "cl_games_delete" ON club_league_games FOR DELETE TO authenticated
  USING (
    public.is_club_league_tournament_owner(
      (SELECT tournament_id FROM club_league_confrontations WHERE id = confrontation_id)
    )
  );

CREATE POLICY "cl_standings_insert" ON club_league_standings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cl_standings_update" ON club_league_standings FOR UPDATE TO authenticated USING (true);
CREATE POLICY "cl_standings_delete" ON club_league_standings FOR DELETE TO authenticated
  USING (public.is_club_league_tournament_owner(tournament_id));

-- ---------------------------------------------------------------------------
-- RPC: submit lineup with FPP validation + embargo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_club_league_lineup(
  p_confrontation_id UUID,
  p_team_id UUID,
  p_duo1_p1 UUID,
  p_duo1_p2 UUID,
  p_duo2_p1 UUID,
  p_duo2_p2 UUID,
  p_duo3_p1 UUID,
  p_duo3_p2 UUID,
  p_organizer_override BOOLEAN DEFAULT FALSE
)
RETURNS club_league_lineups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conf club_league_confrontations%ROWTYPE;
  v_is_owner BOOLEAN;
  v_is_captain BOOLEAN;
  v_ids UUID[];
  v_fpp1 NUMERIC;
  v_fpp2 NUMERIC;
  v_fpp3 NUMERIC;
  v_row club_league_lineups%ROWTYPE;
BEGIN
  SELECT * INTO v_conf FROM club_league_confrontations WHERE id = p_confrontation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confrontation_not_found';
  END IF;

  IF v_conf.home_team_id IS DISTINCT FROM p_team_id
     AND v_conf.away_team_id IS DISTINCT FROM p_team_id THEN
    RAISE EXCEPTION 'team_not_in_confrontation';
  END IF;

  v_is_owner := public.is_club_league_tournament_owner(v_conf.tournament_id);
  v_is_captain := public.is_club_league_team_captain(p_team_id);

  IF NOT v_is_owner AND NOT v_is_captain THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF NOT (v_is_owner AND p_organizer_override) THEN
    IF v_conf.scheduled_time IS NOT NULL
       AND now() >= (v_conf.scheduled_time - INTERVAL '30 minutes') THEN
      RAISE EXCEPTION 'lineup_locked';
    END IF;
  END IF;

  v_ids := ARRAY[p_duo1_p1, p_duo1_p2, p_duo2_p1, p_duo2_p2, p_duo3_p1, p_duo3_p2];
  IF array_length(v_ids, 1) IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'need_six_players';
  END IF;
  IF (SELECT COUNT(DISTINCT x) FROM unnest(v_ids) AS x) <> 6 THEN
    RAISE EXCEPTION 'players_must_be_unique';
  END IF;

  IF (
    SELECT COUNT(*) FROM club_league_players
    WHERE team_id = p_team_id AND id = ANY (v_ids)
  ) <> 6 THEN
    RAISE EXCEPTION 'players_not_in_roster';
  END IF;

  SELECT COALESCE(SUM(fpp_points), 0) INTO v_fpp1
  FROM club_league_players WHERE id IN (p_duo1_p1, p_duo1_p2);
  SELECT COALESCE(SUM(fpp_points), 0) INTO v_fpp2
  FROM club_league_players WHERE id IN (p_duo2_p1, p_duo2_p2);
  SELECT COALESCE(SUM(fpp_points), 0) INTO v_fpp3
  FROM club_league_players WHERE id IN (p_duo3_p1, p_duo3_p2);

  IF NOT (v_fpp1 > v_fpp2 AND v_fpp2 > v_fpp3) THEN
    RAISE EXCEPTION 'fpp_order_invalid';
  END IF;

  INSERT INTO club_league_lineups (
    confrontation_id, team_id,
    duo1_player1_id, duo1_player2_id,
    duo2_player1_id, duo2_player2_id,
    duo3_player1_id, duo3_player2_id,
    submitted_at, locked_at, updated_at
  ) VALUES (
    p_confrontation_id, p_team_id,
    p_duo1_p1, p_duo1_p2,
    p_duo2_p1, p_duo2_p2,
    p_duo3_p1, p_duo3_p2,
    now(),
    CASE
      WHEN v_conf.scheduled_time IS NOT NULL
        THEN v_conf.scheduled_time - INTERVAL '30 minutes'
      ELSE NULL
    END,
    now()
  )
  ON CONFLICT (confrontation_id, team_id) DO UPDATE SET
    duo1_player1_id = EXCLUDED.duo1_player1_id,
    duo1_player2_id = EXCLUDED.duo1_player2_id,
    duo2_player1_id = EXCLUDED.duo2_player1_id,
    duo2_player2_id = EXCLUDED.duo2_player2_id,
    duo3_player1_id = EXCLUDED.duo3_player1_id,
    duo3_player2_id = EXCLUDED.duo3_player2_id,
    submitted_at = now(),
    locked_at = EXCLUDED.locked_at,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_club_league_lineup(
  UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, BOOLEAN
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_club_league_tournament_owner(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_club_league_team_captain(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.club_league_lineup_is_visible(UUID) TO authenticated, anon;
