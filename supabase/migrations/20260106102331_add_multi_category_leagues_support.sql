/*
  # Add Multi-Category Support to Leagues

  1. Changes to `leagues` table
    - Add `categories` column (text array) for leagues with multiple categories (e.g., ['M3', 'M4', 'M5'])
    - Default to empty array for backwards compatibility with single-category leagues

  2. Changes to `tournament_leagues` table
    - Add `league_category` column to specify which category this tournament counts towards
    - When a tournament has multiple categories, the strongest (lowest number) applies

  3. Changes to `league_standings` table
    - Add `category` column to separate standings by category within a league
    - Nullable for backwards compatibility with existing single-category leagues

  4. Important Notes
    - Existing leagues without categories continue to work as before (single standings table)
    - New multi-category leagues show separate standings per category
    - Category strength order: M3 > M4 > M5 (lower number = stronger)
*/

-- Add categories array to leagues
ALTER TABLE leagues 
ADD COLUMN IF NOT EXISTS categories text[] DEFAULT '{}';

-- Add league_category to tournament_leagues junction table
ALTER TABLE tournament_leagues
ADD COLUMN IF NOT EXISTS league_category text;

-- Add category to league_standings
ALTER TABLE league_standings
ADD COLUMN IF NOT EXISTS category text;

-- Create index for faster category-based queries
CREATE INDEX IF NOT EXISTS idx_league_standings_category 
ON league_standings(league_id, category);

-- Create helper function to determine strongest category from tournament categories
CREATE OR REPLACE FUNCTION get_strongest_category(tournament_categories text[])
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  category text;
  strongest text := NULL;
  strongest_num int := 999;
  cat_num int;
BEGIN
  IF tournament_categories IS NULL OR array_length(tournament_categories, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  FOREACH category IN ARRAY tournament_categories
  LOOP
    -- Extract numeric part (M3 -> 3, M4 -> 4, etc.)
    cat_num := NULLIF(regexp_replace(category, '[^0-9]', '', 'g'), '')::int;
    IF cat_num IS NOT NULL AND cat_num < strongest_num THEN
      strongest_num := cat_num;
      strongest := category;
    END IF;
  END LOOP;

  RETURN strongest;
END;
$$;