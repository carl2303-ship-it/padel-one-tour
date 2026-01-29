/*
  # Add number_of_groups field to tournaments

  1. Changes
    - Add `number_of_groups` column to specify how many groups to create
    - Default value is 4 groups
    
  2. Notes
    - This allows users to decide exactly how many groups they want
    - Works with groups_knockout format
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'number_of_groups'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN number_of_groups INTEGER DEFAULT 4;
  END IF;
END $$;

COMMENT ON COLUMN tournaments.number_of_groups IS 'Number of groups to create for groups_knockout format';
