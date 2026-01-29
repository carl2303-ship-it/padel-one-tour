/*
  # Add rounds field to tournament categories

  1. Changes
    - Add `rounds` column to `tournament_categories` table
      - Type: integer
      - Default: 7 (reasonable default for American format)
      - Nullable: allows existing categories to work
    
  2. Notes
    - This field controls how many rounds/matches each player plays in American format
    - Only used when format = 'american'
*/

ALTER TABLE tournament_categories 
ADD COLUMN IF NOT EXISTS rounds integer DEFAULT 7;

COMMENT ON COLUMN tournament_categories.rounds IS 'Number of rounds for American format tournaments (matches per player)';
