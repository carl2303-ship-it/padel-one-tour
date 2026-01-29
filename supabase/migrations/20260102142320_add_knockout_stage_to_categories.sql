/*
  # Add knockout_stage column to tournament_categories

  1. Changes
    - Add `knockout_stage` column to `tournament_categories` table
    - This allows each category to have its own knockout stage format (quarterfinals, semifinals, final)
    - Default value is 'quarterfinals' for backward compatibility

  2. Purpose
    - Different categories may have different numbers of teams/groups
    - Each category needs its own knockout format based on participants
    - More flexibility in tournament organization
*/

ALTER TABLE tournament_categories
ADD COLUMN IF NOT EXISTS knockout_stage text DEFAULT 'quarterfinals'
CHECK (knockout_stage = ANY (ARRAY['round_of_16'::text, 'quarterfinals'::text, 'semifinals'::text, 'final'::text]));

COMMENT ON COLUMN tournament_categories.knockout_stage IS 'Knockout stage format for this category (round_of_16, quarterfinals, semifinals, final)';