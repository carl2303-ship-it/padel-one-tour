-- RPC para devolver nomes dos jogadores de um torneio, bypassa RLS
-- Resolve o problema do Player App não conseguir ler a tabela players por causa de RLS
CREATE OR REPLACE FUNCTION get_tournament_player_names(tournament_uuid uuid)
RETURNS TABLE(player_id uuid, player_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.id, COALESCE(pa.name, p.name) as name
  FROM players p
  LEFT JOIN player_accounts pa ON pa.id = p.player_account_id
  WHERE p.tournament_id = tournament_uuid;
$$;

-- Permissão para utilizadores autenticados
GRANT EXECUTE ON FUNCTION get_tournament_player_names(uuid) TO authenticated;
