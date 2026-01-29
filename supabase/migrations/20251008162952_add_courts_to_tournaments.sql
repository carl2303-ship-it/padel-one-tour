/*
  # Add courts field to tournaments

  1. Changes
    - Add `number_of_courts` column to tournaments table
    - Default to 1 court if not specified
  
  2. Notes
    - This field will be used to automatically schedule matches
    - The scheduling algorithm will distribute matches across available courts
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'number_of_courts'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN number_of_courts integer DEFAULT 1 NOT NULL;
  END IF;
END $$;
