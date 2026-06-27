-- Rankings por nível: geral (toda a app Player) ou filtrado por clube (ex.: APC)

CREATE OR REPLACE FUNCTION get_player_level_rankings(p_club_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  name TEXT,
  avatar_url TEXT,
  level NUMERIC,
  gender TEXT,
  player_category TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    pa.id,
    pa.user_id,
    pa.name,
    pa.avatar_url,
    pa.level,
    pa.gender,
    pa.player_category
  FROM player_accounts pa
  WHERE pa.level IS NOT NULL
    AND pa.name IS NOT NULL
    AND TRIM(pa.name) <> ''
    AND pa.name NOT ILIKE 'test%'
    AND pa.name !~* '^PF[0-9]'
    AND (
      p_club_id IS NULL
      OR pa.favorite_club_id = p_club_id
      OR EXISTS (
        SELECT 1
        FROM player_clubs pc
        WHERE pc.player_account_id = pa.id
          AND pc.club_id = p_club_id
      )
    )
  ORDER BY pa.level DESC NULLS LAST, pa.name ASC;
$$;

COMMENT ON FUNCTION get_player_level_rankings IS
  'Lista jogadores ordenados por nível. p_club_id NULL = ranking geral; com UUID = ranking do clube.';

GRANT EXECUTE ON FUNCTION get_player_level_rankings(UUID) TO authenticated;
