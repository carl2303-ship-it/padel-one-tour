-- Bulk-update player final_position in one statement to avoid N parallel PATCHes
-- (which were causing statement timeouts when Standings opened).

CREATE OR REPLACE FUNCTION public.set_players_final_positions(
  p_tournament_id uuid,
  p_updates jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
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

  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array' OR jsonb_array_length(p_updates) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE players p
  SET final_position = u.final_position
  FROM jsonb_to_recordset(p_updates) AS u(id uuid, final_position integer)
  WHERE p.id = u.id
    AND p.tournament_id = p_tournament_id
    AND p.final_position IS DISTINCT FROM u.final_position;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_players_final_positions(uuid, jsonb) TO authenticated;
