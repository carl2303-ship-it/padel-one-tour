ALTER TABLE tournament_categories
ADD COLUMN IF NOT EXISTS accepted_levels text[] DEFAULT NULL;

ALTER TABLE tournament_categories
ADD COLUMN IF NOT EXISTS min_level numeric DEFAULT NULL;

ALTER TABLE tournament_categories
ADD COLUMN IF NOT EXISTS max_level numeric DEFAULT NULL;

COMMENT ON COLUMN tournament_categories.accepted_levels IS 'Player categories allowed to register (e.g. {M4,M5}). NULL means no restriction.';
COMMENT ON COLUMN tournament_categories.min_level IS 'Minimum numeric level (0.5-7.0) required. NULL means no restriction.';
COMMENT ON COLUMN tournament_categories.max_level IS 'Maximum numeric level (0.5-7.0) required. NULL means no restriction.';
