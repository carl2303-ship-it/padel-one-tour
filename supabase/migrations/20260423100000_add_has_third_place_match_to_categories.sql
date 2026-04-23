-- Add has_third_place_match column to tournament_categories
ALTER TABLE tournament_categories
ADD COLUMN IF NOT EXISTS has_third_place_match boolean DEFAULT true;
