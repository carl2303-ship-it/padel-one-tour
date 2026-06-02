/*
  # Merge mixed_gender and crossed_playoffs into individual_groups_knockout

  These formats are functionally identical to individual_groups_knockout
  with multiple categories. This migration converts existing tournaments
  and updates the format CHECK constraint.

  - mixed_gender: was groups separated by gender + mixed finals
  - crossed_playoffs: was groups per category + crossed knockout rounds

  Both are now handled by individual_groups_knockout with configurable
  knockout_stage per category.
*/

-- Convert existing tournaments
UPDATE tournaments
SET format = 'individual_groups_knockout'
WHERE format IN ('mixed_gender', 'crossed_playoffs');

-- Update CHECK constraint to remove old formats
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_format_check;
ALTER TABLE tournaments
ADD CONSTRAINT tournaments_format_check
CHECK (format IN (
  'single_elimination', 'round_robin', 'groups_knockout',
  'individual_groups_knockout', 'super_teams', 'crossed_playoffs_teams',
  'mixed_american', 'ladder'
));
