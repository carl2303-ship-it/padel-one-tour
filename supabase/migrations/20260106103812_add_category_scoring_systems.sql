/*
  # Add Category-Specific Scoring Systems

  1. Changes to `leagues` table
    - Add `category_scoring_systems` column (JSONB) for per-category scoring
    - Structure: {"M3": {"1": 30, "2": 25, ...}, "M4": {"1": 25, "2": 20, ...}}

  2. Logic
    - When league has categories, each category can have different point values
    - Stronger categories (lower number like M3) give more points
    - All players compete in a single unified ranking
    - The scoring system used depends on the tournament's category

  3. Backwards Compatibility
    - Existing `scoring_system` field remains for leagues without categories
    - When `category_scoring_systems` is not set, falls back to `scoring_system`
*/

-- Add category_scoring_systems to leagues
ALTER TABLE leagues 
ADD COLUMN IF NOT EXISTS category_scoring_systems jsonb DEFAULT '{}'::jsonb;

-- Remove category column from league_standings (we want unified rankings)
-- Keep it but we won't use it for filtering
-- ALTER TABLE league_standings DROP COLUMN IF EXISTS category;