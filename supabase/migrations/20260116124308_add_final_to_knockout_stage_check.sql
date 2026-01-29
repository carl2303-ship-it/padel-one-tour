/*
  # Add 'final' option to knockout_stage constraint

  1. Changes
    - Drop existing check constraint on knockout_stage
    - Add new check constraint that includes 'final' option
*/

ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_knockout_stage_check;

ALTER TABLE tournaments ADD CONSTRAINT tournaments_knockout_stage_check 
  CHECK (knockout_stage = ANY (ARRAY['final'::text, 'round_of_16'::text, 'quarterfinals'::text, 'semifinals'::text]));