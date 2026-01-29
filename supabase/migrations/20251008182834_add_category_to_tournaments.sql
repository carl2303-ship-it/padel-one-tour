/*
  # Add category field to tournaments

  1. Changes
    - Add `category` column to tournaments table
    - Category options: F1-F6 (Female categories) and M1-M6 (Male categories)
  
  2. Notes
    - Allows tournaments to be organized by skill/age categories
    - Can be updated after tournament creation
    - Optional field (can be null for tournaments without categories)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'category'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN category text;
  END IF;
END $$;
