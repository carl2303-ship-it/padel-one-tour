/*
  # Add Per-Day Schedule Configuration

  1. Changes
    - Add `daily_schedules` column to tournaments table (JSONB)
      - Stores an array of daily schedule configurations
      - Each entry has: date, start_time, end_time
      - Example: [
          {"date": "2025-12-15", "start_time": "19:00", "end_time": "23:59"},
          {"date": "2025-12-16", "start_time": "09:00", "end_time": "23:00"},
          {"date": "2025-12-17", "start_time": "09:00", "end_time": "18:00"}
        ]
    - Keep existing daily_start_time and daily_end_time as fallback defaults

  2. Purpose
    - Allow tournaments to have different schedules for each day
    - Example: Friday 19:00-24:00, Saturday 09:00-23:00, Sunday 09:00-18:00
    - If daily_schedules is null or empty, fall back to daily_start_time/daily_end_time

  3. Security
    - No RLS changes needed
*/

-- Add daily_schedules column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'daily_schedules'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN daily_schedules jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;