-- Align player_accounts.player_category with numeric level when gender is known.
-- Uses get_category_number_for_level() (same bands as auto_set_player_category trigger).
-- Does NOT invent M/F when gender cannot be inferred.

UPDATE player_accounts pa
SET
  player_category = d.prefix || get_category_number_for_level(pa.level::numeric)::text,
  updated_at = now()
FROM (
  SELECT
    id,
    CASE
      WHEN player_category ~* '^[MF][1-6]$' THEN upper(left(player_category, 1))
      WHEN lower(coalesce(gender, '')) IN ('male', 'm', 'masculino') THEN 'M'
      WHEN lower(coalesce(gender, '')) IN ('female', 'f', 'feminino') THEN 'F'
      ELSE NULL
    END AS prefix
  FROM player_accounts
  WHERE level IS NOT NULL
) d
WHERE pa.id = d.id
  AND d.prefix IS NOT NULL
  AND pa.player_category IS DISTINCT FROM (d.prefix || get_category_number_for_level(pa.level::numeric)::text);

-- Enrich prefix from organizer_players when still missing, then align
WITH hints AS (
  SELECT DISTINCT ON (pa.id)
    pa.id,
    CASE
      WHEN op.player_category ~* '^[MF]' THEN upper(left(op.player_category, 1))
      ELSE NULL
    END AS prefix
  FROM player_accounts pa
  JOIN organizer_players op
    ON regexp_replace(coalesce(op.phone_number,''), '[^0-9]', '', 'g')
     = regexp_replace(coalesce(pa.phone_number,''), '[^0-9]', '', 'g')
  WHERE pa.level IS NOT NULL
    AND (pa.player_category IS NULL OR pa.player_category !~* '^[MF][1-6]$')
    AND op.player_category ~* '^[MF]'
  ORDER BY pa.id, op.updated_at DESC NULLS LAST
)
UPDATE player_accounts pa
SET
  player_category = h.prefix || get_category_number_for_level(pa.level::numeric)::text,
  updated_at = now()
FROM hints h
WHERE pa.id = h.id
  AND h.prefix IS NOT NULL
  AND pa.player_category IS DISTINCT FROM (h.prefix || get_category_number_for_level(pa.level::numeric)::text);
