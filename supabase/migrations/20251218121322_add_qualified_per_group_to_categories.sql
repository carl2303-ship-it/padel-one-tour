/*
  # Add qualified_per_group to tournament_categories

  1. Changes
    - Add `qualified_per_group` column to `tournament_categories` table
      - Type: integer
      - Default: 2
      - Range: 1-4 (to allow flexibility)
      - Used to determine how many participants advance from each group
    
  2. Notes
    - This field is essential for groups+knockout formats (groups_knockout, individual_groups_knockout)
    - The value should be calculated based on:
      * Number of groups in the category
      * Desired knockout stage (final=2 total, semifinals=4 total, quarterfinals=8 total, round16=16 total)
    - Formula: qualified_per_group = total_needed_for_knockout / number_of_groups
*/

ALTER TABLE tournament_categories 
ADD COLUMN IF NOT EXISTS qualified_per_group integer DEFAULT 2 CHECK (qualified_per_group >= 1 AND qualified_per_group <= 8);

COMMENT ON COLUMN tournament_categories.qualified_per_group IS 'Number of participants to qualify from each group for knockout stage';
