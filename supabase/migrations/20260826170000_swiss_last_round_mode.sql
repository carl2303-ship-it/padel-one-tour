-- Swiss last round: placement finals (ranking only) vs normal Swiss (counts in standings)

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS swiss_last_round_mode text DEFAULT 'finals';

ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS swiss_last_round_mode text DEFAULT 'finals';

ALTER TABLE tournaments
  DROP CONSTRAINT IF EXISTS tournaments_swiss_last_round_mode_check;

ALTER TABLE tournaments
  ADD CONSTRAINT tournaments_swiss_last_round_mode_check
  CHECK (swiss_last_round_mode IS NULL OR swiss_last_round_mode IN ('finals', 'swiss'));

ALTER TABLE tournament_categories
  DROP CONSTRAINT IF EXISTS tournament_categories_swiss_last_round_mode_check;

ALTER TABLE tournament_categories
  ADD CONSTRAINT tournament_categories_swiss_last_round_mode_check
  CHECK (swiss_last_round_mode IS NULL OR swiss_last_round_mode IN ('finals', 'swiss'));

COMMENT ON COLUMN tournaments.swiss_last_round_mode IS
  'finals = last round is placement (1v2, 3v4…), rematches allowed, does not count in Swiss standings; swiss = normal Swiss round with anti-rematch, counts in standings';
