-- Torneio Escada (ladder): estado separado sem alterar lógica dos outros formatos

ALTER TABLE tournaments
  DROP CONSTRAINT IF EXISTS tournaments_format_check;

ALTER TABLE tournaments
  ADD CONSTRAINT tournaments_format_check
  CHECK (format IN (
    'single_elimination', 'round_robin', 'groups_knockout',
    'individual_groups_knockout', 'super_teams', 'crossed_playoffs', 'crossed_playoffs_teams', 'mixed_gender',
    'mixed_american', 'ladder'
  ));

ALTER TABLE tournament_categories
  DROP CONSTRAINT IF EXISTS tournament_categories_format_check;

ALTER TABLE tournament_categories
  ADD CONSTRAINT tournament_categories_format_check
  CHECK (format IN (
    'single_elimination', 'round_robin', 'groups_knockout',
    'individual_groups_knockout', 'super_teams', 'crossed_playoffs', 'crossed_playoffs_teams', 'mixed_gender',
    'mixed_american', 'ladder'
  ));

CREATE TABLE IF NOT EXISTS ladder_tournaments (
  tournament_id uuid PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
  challenge_limit integer NOT NULL DEFAULT 5
    CHECK (challenge_limit >= 1 AND challenge_limit <= 50),
  challenge_window_days integer NOT NULL DEFAULT 7
    CHECK (challenge_window_days >= 1 AND challenge_window_days <= 90),
  positions jsonb NOT NULL DEFAULT '[]'::jsonb,
  pending_challenges jsonb NOT NULL DEFAULT '[]'::jsonb,
  ladder_status text NOT NULL DEFAULT 'setup'
    CHECK (ladder_status IN ('setup', 'active', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ladder_tournaments_ladder_status
  ON ladder_tournaments(ladder_status);

ALTER TABLE ladder_tournaments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view ladder tournaments"
  ON ladder_tournaments FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Authenticated users can insert ladder tournaments"
  ON ladder_tournaments FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update ladder tournaments"
  ON ladder_tournaments FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_ladder_tournaments_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ladder_tournaments_updated_at ON ladder_tournaments;
CREATE TRIGGER trg_ladder_tournaments_updated_at
  BEFORE UPDATE ON ladder_tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_ladder_tournaments_updated_at();
