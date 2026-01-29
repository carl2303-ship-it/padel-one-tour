/*
  # Add Daily Schedule Times to Tournaments

  1. Changes
    - Add `daily_start_time` column to tournaments table (format: HH:MM)
      - This defines what time each day starts (e.g., 09:00)
    - Add `daily_end_time` column to tournaments table (format: HH:MM)
      - This defines what time each day ends (e.g., 21:00)
    - Keep existing `start_time` and `end_time` for backwards compatibility
      - `start_time` will be renamed to clarify it's the tournament start time
      - `end_time` will be renamed to clarify it's the tournament end time

  2. Purpose
    - Allow tournaments spanning multiple days to have consistent daily schedules
    - Example: Tournament runs Dec 15-17, each day from 09:00 to 21:00
      - start_date: 2025-12-15
      - end_date: 2025-12-17
      - daily_start_time: 09:00 (matches start at 9am each day)
      - daily_end_time: 21:00 (matches end by 9pm each day)

  3. Security
    - No RLS changes needed
*/

-- Add daily_start_time column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'daily_start_time'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN daily_start_time text DEFAULT '09:00' NOT NULL;
  END IF;
END $$;

-- Add daily_end_time column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'daily_end_time'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN daily_end_time text DEFAULT '21:00' NOT NULL;
  END IF;
END $$;

-- Copy existing start_time and end_time values to daily fields for existing tournaments
UPDATE tournaments
SET daily_start_time = start_time,
    daily_end_time = end_time
WHERE daily_start_time = '09:00' AND daily_end_time = '21:00';