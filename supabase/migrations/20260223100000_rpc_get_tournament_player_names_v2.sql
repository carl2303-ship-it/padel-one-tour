-- v2: Devolver também group_name e final_position para suportar torneios individuais
DROP FUNCTION IF EXISTS get_tournament_player_names(uuid);
CREATE OR REPLACE FUNCTION get_tournament_player_names(tournament_uuid uuid)
RETURNS TABLE(player_id uuid, player_name text, group_name text, final_position int)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT 
    p.id,
    COALESCE(pa.name, p.name)::text as name,
    p.group_name::text,
    p.final_position::int
  FROM players p
  LEFT JOIN player_accounts pa ON pa.id = p.player_account_id
  WHERE p.tournament_id = tournament_uuid;
$$;

GRANT EXECUTE ON FUNCTION get_tournament_player_names(uuid) TO authenticated;
