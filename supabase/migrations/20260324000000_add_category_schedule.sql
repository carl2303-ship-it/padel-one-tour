/*
  # Add Per-Category Schedule Configuration

  1. Changes
    - Add `category_schedule` column to tournament_categories table (JSONB)
      - Stores an array of schedule entries per category
      - Each entry has: date, start_time, end_time
      - Example: [
          {"date": "2026-04-05", "start_time": "09:00", "end_time": "13:00"},
          {"date": "2026-04-06", "start_time": "14:00", "end_time": "18:00"}
        ]
    - Add `match_duration_minutes` column to tournament_categories table (INTEGER)
      - Allows each category to have its own match duration
      - Falls back to tournament-level match_duration_minutes if null

  2. Purpose
    - Allow each category in a tournament to have its own schedule
    - Example: M1 plays Saturday 09:00-13:00, M2 plays Saturday 14:00-18:00
    - Each category's schedule integrates into the main tournament schedule
    - If category_schedule is null or empty, falls back to tournament-level schedule

  3. Security
    - No RLS changes needed (inherits from tournament_categories policies)
*/

-- Add category_schedule column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournament_categories' AND column_name = 'category_schedule'
  ) THEN
    ALTER TABLE tournament_categories ADD COLUMN category_schedule jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Add match_duration_minutes column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournament_categories' AND column_name = 'match_duration_minutes'
  ) THEN
    ALTER TABLE tournament_categories ADD COLUMN match_duration_minutes integer DEFAULT NULL;
  END IF;
END $$;
