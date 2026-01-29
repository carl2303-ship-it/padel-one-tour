/*
  # Add qualified teams per group setting

  1. Changes
    - Add `qualified_teams_per_group` column to tournaments table
      - Determines how many teams advance from each group (1, 2, or 3)
      - Default is 2 (standard format with semifinals)
      - 1 = only winners advance (goes to finals directly)
      - 2 = top 2 advance (goes to semifinals)
      - 3 = top 3 advance (goes to quarterfinals if 4 groups)
    
  2. Notes
    - This affects bracket generation after group stage
    - With 4 groups and 2 qualified = 8 teams = quarterfinals
    - With 4 groups and 1 qualified = 4 teams = semifinals
    - With 3 groups and 2 qualified = 6 teams = special bracket format
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'qualified_teams_per_group'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN qualified_teams_per_group integer DEFAULT 2 CHECK (qualified_teams_per_group >= 1 AND qualified_teams_per_group <= 3);
  END IF;
END $$;