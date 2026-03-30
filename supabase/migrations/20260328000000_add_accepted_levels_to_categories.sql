ALTER TABLE tournament_categories
ADD COLUMN IF NOT EXISTS accepted_levels text[] DEFAULT NULL;

COMMENT ON COLUMN tournament_categories.accepted_levels IS 'Player categories allowed to register (e.g. {M4,M5}). NULL means no restriction.';
