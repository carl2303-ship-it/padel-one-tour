/*
  # Fix Tournament Categories Format Constraint

  1. Changes
    - Updates the tournament_categories table format check constraint to include 'individual_groups_knockout' format
    - Ensures categories can use the new individual groups knockout format

  2. Security
    - No RLS changes needed
*/

-- Drop the old constraint
ALTER TABLE tournament_categories 
DROP CONSTRAINT IF EXISTS tournament_categories_format_check;

-- Add the new constraint with the additional format
ALTER TABLE tournament_categories 
ADD CONSTRAINT tournament_categories_format_check 
CHECK (format IN ('single_elimination', 'round_robin', 'groups_knockout', 'individual_groups_knockout'));
