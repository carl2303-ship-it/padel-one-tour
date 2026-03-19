-- Add combined_player_categories to leagues table
-- This allows defining combined category filters (e.g., "M5-M6": ["M5", "M6"])
-- It is purely a display/filter feature and does NOT modify any existing standings or results.

ALTER TABLE leagues
ADD COLUMN IF NOT EXISTS combined_player_categories JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN leagues.combined_player_categories IS 'Combined player category filters, e.g. {"M5-M6": ["M5", "M6"]}. Used for filtering standings display only.';
