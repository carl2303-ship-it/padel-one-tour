/*
  # Allow invited players to view invite-only tournaments

  Players with a pending/accepted tournament_invite must be able to read
  the tournament row (name, dates, image, etc.) plus its categories,
  enrolled players/teams and matches so the detail page works.

  We also create a SECURITY DEFINER helper RPC so the Player app can
  reliably fetch invites+tournament info in a single call, bypassing RLS.
*/

-- 1) tournaments — invited players can read the tournament row
DROP POLICY IF EXISTS "Invited players can view tournament" ON tournaments;
CREATE POLICY "Invited players can view tournament"
  ON tournaments FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT ti.tournament_id
      FROM tournament_invites ti
      JOIN player_accounts pa ON pa.id = ti.player_account_id
      WHERE pa.user_id = auth.uid()
        AND ti.status IN ('pending', 'accepted')
    )
  );

-- 2) tournament_categories — invited players can read categories
DROP POLICY IF EXISTS "Invited players can view tournament categories" ON tournament_categories;
CREATE POLICY "Invited players can view tournament categories"
  ON tournament_categories FOR SELECT
  TO authenticated
  USING (
    tournament_id IN (
      SELECT ti.tournament_id
      FROM tournament_invites ti
      JOIN player_accounts pa ON pa.id = ti.player_account_id
      WHERE pa.user_id = auth.uid()
        AND ti.status IN ('pending', 'accepted')
    )
  );

-- 3) players — invited players can view enrolled players
DROP POLICY IF EXISTS "Invited players can view tournament players" ON players;
CREATE POLICY "Invited players can view tournament players"
  ON players FOR SELECT
  TO authenticated
  USING (
    tournament_id IN (
      SELECT ti.tournament_id
      FROM tournament_invites ti
      JOIN player_accounts pa ON pa.id = ti.player_account_id
      WHERE pa.user_id = auth.uid()
        AND ti.status IN ('pending', 'accepted')
    )
  );

-- 4) teams — invited players can view enrolled teams
DROP POLICY IF EXISTS "Invited players can view tournament teams" ON teams;
CREATE POLICY "Invited players can view tournament teams"
  ON teams FOR SELECT
  TO authenticated
  USING (
    tournament_id IN (
      SELECT ti.tournament_id
      FROM tournament_invites ti
      JOIN player_accounts pa ON pa.id = ti.player_account_id
      WHERE pa.user_id = auth.uid()
        AND ti.status IN ('pending', 'accepted')
    )
  );

-- 5) matches — invited players can view matches
DROP POLICY IF EXISTS "Invited players can view tournament matches" ON matches;
CREATE POLICY "Invited players can view tournament matches"
  ON matches FOR SELECT
  TO authenticated
  USING (
    tournament_id IN (
      SELECT ti.tournament_id
      FROM tournament_invites ti
      JOIN player_accounts pa ON pa.id = ti.player_account_id
      WHERE pa.user_id = auth.uid()
        AND ti.status IN ('pending', 'accepted')
    )
  );

-- 6) SECURITY DEFINER RPC: fetch invites with tournament details
--    Bypasses RLS completely so even anon sessions get full data.
CREATE OR REPLACE FUNCTION public.get_my_tournament_invites(
  p_player_account_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_result jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      ti.tournament_id,
      ti.status,
      t.name   AS tournament_name,
      t.start_date AS tournament_start_date,
      t.image_url  AS tournament_image_url
    FROM tournament_invites ti
    LEFT JOIN tournaments t ON t.id = ti.tournament_id
    WHERE ti.player_account_id = p_player_account_id
      AND ti.status IN ('pending', 'accepted')
    ORDER BY t.start_date ASC NULLS LAST
  ) r;

  RETURN v_result;
END;
$body$;

GRANT EXECUTE ON FUNCTION public.get_my_tournament_invites(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_tournament_invites(uuid) TO anon;

-- 7) SECURITY DEFINER RPC: fetch single tournament row for an invited player
CREATE OR REPLACE FUNCTION public.get_tournament_for_invited_player(
  p_player_account_id uuid,
  p_tournament_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_has_invite boolean;
  v_result jsonb;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM tournament_invites
    WHERE player_account_id = p_player_account_id
      AND tournament_id = p_tournament_id
      AND status IN ('pending', 'accepted')
  ) INTO v_has_invite;

  IF NOT v_has_invite THEN
    RETURN jsonb_build_object('error', 'no_invite');
  END IF;

  SELECT row_to_json(t)::jsonb INTO v_result
  FROM (
    SELECT id, name, description, start_date, end_date, status,
           format, image_url, number_of_courts, match_duration_minutes,
           daily_start_time, daily_end_time, club_id, round_robin_type
    FROM tournaments
    WHERE id = p_tournament_id
  ) t;

  RETURN coalesce(v_result, jsonb_build_object('error', 'not_found'));
END;
$body$;

GRANT EXECUTE ON FUNCTION public.get_tournament_for_invited_player(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tournament_for_invited_player(uuid, uuid) TO anon;
