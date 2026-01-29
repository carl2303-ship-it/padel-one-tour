/*
  # Add match duration field to tournaments

  1. Changes
    - Add `match_duration_minutes` column to tournaments table
    - Default value is 90 minutes (1.5 hours typical padel match)
    - Allows tournament organizers to specify expected match length
  
  2. Notes
    - Used by scheduler to calculate match times
    - Can be updated after tournament creation
    - Helps optimize court usage and scheduling
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'match_duration_minutes'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN match_duration_minutes integer DEFAULT 90;
  END IF;
END $$;
