/*
  # Add Individual Groups Knockout Format

  1. Changes
    - Updates the tournaments table format check constraint to include the new 'individual_groups_knockout' format
    - This format combines individual round-robin groups with knockout stages where teams are formed randomly

  2. Security
    - No RLS changes needed
*/

-- Drop the old constraint
ALTER TABLE tournaments 
DROP CONSTRAINT IF EXISTS tournaments_format_check;

-- Add the new constraint with the additional format
ALTER TABLE tournaments 
ADD CONSTRAINT tournaments_format_check 
CHECK (format IN ('single_elimination', 'round_robin', 'groups_knockout', 'individual_groups_knockout'));
