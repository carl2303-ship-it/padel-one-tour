-- Lineup secrecy: organizers see content only from T-30 (same as everyone).
-- Captains can always see/edit their own lineup until T-30.
-- Status RPC exposes only submitted yes/no (no player IDs) for Tour calendar pills.

-- ---------------------------------------------------------------------------
-- SELECT: remove owner bypass before T-30
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "cl_lineups_select" ON club_league_lineups;
CREATE POLICY "cl_lineups_select" ON club_league_lineups FOR SELECT USING (
  public.club_league_lineup_is_visible(confrontation_id)
  OR public.is_club_league_team_captain(team_id)
);

-- UPDATE: organizer only after reveal (T-30); captain until T-30
DROP POLICY IF EXISTS "cl_lineups_update" ON club_league_lineups;
CREATE POLICY "cl_lineups_update" ON club_league_lineups FOR UPDATE TO authenticated USING (
  (
    public.is_club_league_team_captain(team_id)
    AND (
      SELECT c.scheduled_time IS NULL
          OR now() < (c.scheduled_time - INTERVAL '30 minutes')
      FROM club_league_confrontations c WHERE c.id = confrontation_id
    )
  )
  OR (
    public.is_club_league_tournament_owner(
      (SELECT tournament_id FROM club_league_confrontations WHERE id = confrontation_id)
    )
    AND public.club_league_lineup_is_visible(confrontation_id)
  )
);

-- ---------------------------------------------------------------------------
-- Status metadata (no duo/player columns) for calendar pills
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_club_league_lineup_status(p_tournament_id UUID)
RETURNS TABLE (
  confrontation_id UUID,
  team_id UUID,
  submitted BOOLEAN,
  submitted_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.confrontation_id,
    l.team_id,
    TRUE AS submitted,
    l.submitted_at
  FROM club_league_lineups l
  JOIN club_league_confrontations c ON c.id = l.confrontation_id
  WHERE c.tournament_id = p_tournament_id
    AND (
      public.is_club_league_tournament_owner(p_tournament_id)
      OR public.club_league_lineup_is_visible(l.confrontation_id)
      OR public.is_club_league_team_captain(l.team_id)
      OR EXISTS (
        SELECT 1
        FROM club_league_players p
        JOIN player_accounts pa ON pa.id = p.player_account_id
        WHERE p.team_id IN (c.home_team_id, c.away_team_id)
          AND pa.user_id = auth.uid()
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_club_league_lineup_status(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Submit RPC: only captains before T-30; organizer override only after T-30
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
  v_revealed BOOLEAN;
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
  v_revealed := (
    v_conf.scheduled_time IS NULL
    OR now() >= (v_conf.scheduled_time - INTERVAL '30 minutes')
  );

  -- Before T-30: only the team captain may submit/edit
  IF NOT v_revealed THEN
    IF NOT v_is_captain THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  ELSE
    -- After T-30: captain locked unless organizer override; organizer may override
    IF v_is_captain AND NOT (v_is_owner AND p_organizer_override) THEN
      RAISE EXCEPTION 'lineup_locked';
    END IF;
    IF NOT v_is_captain AND NOT (v_is_owner AND p_organizer_override) THEN
      RAISE EXCEPTION 'not_authorized';
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
