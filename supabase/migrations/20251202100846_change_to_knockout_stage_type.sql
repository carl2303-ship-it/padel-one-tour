/*
  # Change from qualified teams per group to knockout stage type

  1. Changes
    - Replace `qualified_teams_per_group` with `knockout_stage` column
    - Values: 'round_of_16' (16 teams), 'quarterfinals' (8 teams), 'semifinals' (4 teams)
    - Default is 'quarterfinals' (8 teams)
    
  2. Notes
    - System will automatically select:
      - Top 2 from each group (guaranteed)
      - Best 3rd place teams if needed to reach target number
    - No byes - always fills the bracket completely
    
  3. Examples
    - 4 groups → 8 qualified (top 2 each) → Quarterfinals
    - 4 groups + 8 best 3rd → 16 teams → Round of 16
    - 4 groups → 4 qualified (top 1 each) → Semifinals
*/

DO $$
BEGIN
  -- Add new column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'knockout_stage'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN knockout_stage text DEFAULT 'quarterfinals' CHECK (knockout_stage IN ('round_of_16', 'quarterfinals', 'semifinals'));
  END IF;
  
  -- We keep qualified_teams_per_group for backward compatibility but it won't be used in new logic
END $$;