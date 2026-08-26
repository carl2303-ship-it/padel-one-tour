-- Add swiss_teams format + swiss_rounds configuration

ALTER TABLE tournaments
  DROP CONSTRAINT IF EXISTS tournaments_format_check;

ALTER TABLE tournaments
  ADD CONSTRAINT tournaments_format_check
  CHECK (format IN (
    'single_elimination',
    'round_robin',
    'groups_knockout',
    'individual_groups_knockout',
    'super_teams',
    'crossed_playoffs',
    'crossed_playoffs_teams',
    'mixed_gender',
    'mixed_american',
    'ladder',
    'swiss_teams'
  ));

ALTER TABLE tournament_categories
  DROP CONSTRAINT IF EXISTS tournament_categories_format_check;

ALTER TABLE tournament_categories
  ADD CONSTRAINT tournament_categories_format_check
  CHECK (format IN (
    'single_elimination',
    'round_robin',
    'groups_knockout',
    'individual_groups_knockout',
    'super_teams',
    'crossed_playoffs',
    'crossed_playoffs_teams',
    'mixed_gender',
    'mixed_american',
    'ladder',
    'swiss_teams'
  ));

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS swiss_rounds integer DEFAULT 5
  CHECK (swiss_rounds IS NULL OR (swiss_rounds >= 3 AND swiss_rounds <= 9));

ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS swiss_rounds integer DEFAULT 5
  CHECK (swiss_rounds IS NULL OR (swiss_rounds >= 3 AND swiss_rounds <= 9));
