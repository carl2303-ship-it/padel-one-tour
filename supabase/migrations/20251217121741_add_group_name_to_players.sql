/*
  # Add group_name field to players table

  1. Changes
    - Add `group_name` column to `players` table for individual tournament group assignments
    - This allows players to be assigned to groups (A, B, C, etc.) in individual_groups_knockout format

  2. Notes
    - Column is nullable since not all players participate in group-based tournaments
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'players' AND column_name = 'group_name'
  ) THEN
    ALTER TABLE players ADD COLUMN group_name text;
  END IF;
END $$;