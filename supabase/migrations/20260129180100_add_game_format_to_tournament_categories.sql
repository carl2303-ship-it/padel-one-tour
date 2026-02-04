-- Adicionar coluna game_format à tabela tournament_categories
-- Usada para Super Teams e outras categorias: 1 set ou melhor de 3 sets

ALTER TABLE tournament_categories
ADD COLUMN IF NOT EXISTS game_format text DEFAULT '1set'
CHECK (game_format IN ('1set', '3sets'));

COMMENT ON COLUMN tournament_categories.game_format IS 'Formato dos jogos: 1set (1 set) ou 3sets (melhor de 3 sets)';
