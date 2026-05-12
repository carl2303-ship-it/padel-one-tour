-- Escada: uma linha ladder_tournaments por categoria (níveis / categorias separadas no mesmo torneio)

ALTER TABLE ladder_tournaments
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES tournament_categories(id) ON DELETE CASCADE;

UPDATE ladder_tournaments lt
SET category_id = sub.id
FROM (
  SELECT DISTINCT ON (tournament_id) tournament_id, id
  FROM tournament_categories
  ORDER BY tournament_id, created_at ASC NULLS LAST, name ASC
) sub
WHERE lt.tournament_id = sub.tournament_id
  AND lt.category_id IS NULL;

DELETE FROM ladder_tournaments WHERE category_id IS NULL;

ALTER TABLE ladder_tournaments ALTER COLUMN category_id SET NOT NULL;

ALTER TABLE ladder_tournaments DROP CONSTRAINT IF EXISTS ladder_tournaments_pkey;

ALTER TABLE ladder_tournaments ADD PRIMARY KEY (tournament_id, category_id);

CREATE INDEX IF NOT EXISTS idx_ladder_tournaments_category_id ON ladder_tournaments(category_id);
