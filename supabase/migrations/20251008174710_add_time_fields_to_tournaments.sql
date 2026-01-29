/*
  # Add time fields to tournaments

  1. Changes
    - Add `start_time` column to tournaments table (format: HH:MM)
    - Add `end_time` column to tournaments table (format: HH:MM)
    - Default start time to 09:00
    - Default end time to 21:00
  
  2. Notes
    - These times define the daily operating hours for the tournament
    - The scheduler will use these to schedule matches within the time window
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'start_time'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN start_time text DEFAULT '09:00' NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'end_time'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN end_time text DEFAULT '21:00' NOT NULL;
  END IF;
END $$;
