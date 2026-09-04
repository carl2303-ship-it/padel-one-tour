-- Bulk set seeds for players/teams in one round-trip (avoids N parallel PATCHes + timeouts).

CREATE OR REPLACE FUNCTION public.set_tournament_seeds(
  p_tournament_id uuid,
  p_player_updates jsonb DEFAULT '[]'::jsonb,
  p_team_updates jsonb DEFAULT '[]'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT (
    is_tournament_owner(p_tournament_id)
    OR EXISTS (
      SELECT 1
      FROM tournaments t
      JOIN clubs c ON c.id = t.club_id
      WHERE t.id = p_tournament_id
        AND c.owner_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_player_updates IS NOT NULL
     AND jsonb_typeof(p_player_updates) = 'array'
     AND jsonb_array_length(p_player_updates) > 0 THEN
    UPDATE players p
    SET seed = u.seed
    FROM jsonb_to_recordset(p_player_updates) AS u(id uuid, seed integer)
    WHERE p.id = u.id
      AND p.tournament_id = p_tournament_id
      AND p.seed IS DISTINCT FROM u.seed;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_updated := v_updated + v_count;
  END IF;

  IF p_team_updates IS NOT NULL
     AND jsonb_typeof(p_team_updates) = 'array'
     AND jsonb_array_length(p_team_updates) > 0 THEN
    UPDATE teams t
    SET seed = u.seed
    FROM jsonb_to_recordset(p_team_updates) AS u(id uuid, seed integer)
    WHERE t.id = u.id
      AND t.tournament_id = p_tournament_id
      AND t.seed IS DISTINCT FROM u.seed;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_updated := v_updated + v_count;
  END IF;

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_tournament_seeds(uuid, jsonb, jsonb) TO authenticated;
