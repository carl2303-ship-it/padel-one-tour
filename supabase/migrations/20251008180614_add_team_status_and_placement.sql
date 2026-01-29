/*
  # Add team status and tournament placement tracking

  1. Changes
    - Add `status` column to teams table (active, eliminated)
    - Add `placement` column to teams table for final tournament position
    - Default status to 'active'
  
  2. Notes
    - Status tracks whether team is still in the tournament
    - Placement records final standing (1st, 2nd, 3rd, etc.)
    - When a team loses in single elimination, status becomes 'eliminated'
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'teams' AND column_name = 'status'
  ) THEN
    ALTER TABLE teams ADD COLUMN status text DEFAULT 'active' NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'teams' AND column_name = 'placement'
  ) THEN
    ALTER TABLE teams ADD COLUMN placement integer;
  END IF;
END $$;
