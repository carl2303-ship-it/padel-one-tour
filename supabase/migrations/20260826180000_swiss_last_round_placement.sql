-- Add placement mode: 1v2/3v4 pairing (rematches OK) that still counts in standings

ALTER TABLE tournaments
  DROP CONSTRAINT IF EXISTS tournaments_swiss_last_round_mode_check;

ALTER TABLE tournaments
  ADD CONSTRAINT tournaments_swiss_last_round_mode_check
  CHECK (swiss_last_round_mode IS NULL OR swiss_last_round_mode IN ('finals', 'swiss', 'placement'));

ALTER TABLE tournament_categories
  DROP CONSTRAINT IF EXISTS tournament_categories_swiss_last_round_mode_check;

ALTER TABLE tournament_categories
  ADD CONSTRAINT tournament_categories_swiss_last_round_mode_check
  CHECK (swiss_last_round_mode IS NULL OR swiss_last_round_mode IN ('finals', 'swiss', 'placement'));

COMMENT ON COLUMN tournaments.swiss_last_round_mode IS
  'finals = 1v2/3v4 ranking only (no standings); placement = 1v2/3v4 rematches OK and counts in standings; swiss = normal Swiss anti-rematch counting in standings';
