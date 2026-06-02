/*
  Tournament Sponsors & Prize Distribution

  1. New Tables
    - tournament_sponsors: sponsors associated with organizers/tournaments
    - sponsor_prizes: prizes/vouchers awarded to players

  2. Security
    - RLS enabled on both tables
    - Only the organizer (organizer_id = auth.uid()) can CRUD their sponsors/prizes
    - Public read for awarded prizes (for transparency)
*/

-- tournament_sponsors
CREATE TABLE IF NOT EXISTS tournament_sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tournament_id uuid REFERENCES tournaments(id) ON DELETE SET NULL,
  name text NOT NULL,
  logo_url text,
  contribution_type text NOT NULL DEFAULT 'money' CHECK (contribution_type IN ('money', 'voucher', 'both')),
  money_amount numeric,
  voucher_description text,
  voucher_quantity integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tournament_sponsors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organizer_sponsors_select" ON tournament_sponsors
  FOR SELECT USING (organizer_id = auth.uid());

CREATE POLICY "organizer_sponsors_insert" ON tournament_sponsors
  FOR INSERT WITH CHECK (organizer_id = auth.uid());

CREATE POLICY "organizer_sponsors_update" ON tournament_sponsors
  FOR UPDATE USING (organizer_id = auth.uid());

CREATE POLICY "organizer_sponsors_delete" ON tournament_sponsors
  FOR DELETE USING (organizer_id = auth.uid());

-- sponsor_prizes
CREATE TABLE IF NOT EXISTS sponsor_prizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id uuid NOT NULL REFERENCES tournament_sponsors(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_phone text,
  player_name text NOT NULL,
  prize_type text NOT NULL DEFAULT 'voucher' CHECK (prize_type IN ('money', 'voucher')),
  prize_description text NOT NULL,
  prize_value numeric,
  position integer,
  distribution_method text NOT NULL DEFAULT 'manual' CHECK (distribution_method IN ('manual', 'auto_position')),
  awarded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sponsor_prizes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organizer_prizes_select" ON sponsor_prizes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tournament_sponsors ts
      WHERE ts.id = sponsor_prizes.sponsor_id
      AND ts.organizer_id = auth.uid()
    )
  );

CREATE POLICY "organizer_prizes_insert" ON sponsor_prizes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM tournament_sponsors ts
      WHERE ts.id = sponsor_prizes.sponsor_id
      AND ts.organizer_id = auth.uid()
    )
  );

CREATE POLICY "organizer_prizes_update" ON sponsor_prizes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM tournament_sponsors ts
      WHERE ts.id = sponsor_prizes.sponsor_id
      AND ts.organizer_id = auth.uid()
    )
  );

CREATE POLICY "organizer_prizes_delete" ON sponsor_prizes
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM tournament_sponsors ts
      WHERE ts.id = sponsor_prizes.sponsor_id
      AND ts.organizer_id = auth.uid()
    )
  );

CREATE INDEX idx_tournament_sponsors_organizer ON tournament_sponsors(organizer_id);
CREATE INDEX idx_tournament_sponsors_tournament ON tournament_sponsors(tournament_id);
CREATE INDEX idx_sponsor_prizes_sponsor ON sponsor_prizes(sponsor_id);
CREATE INDEX idx_sponsor_prizes_tournament ON sponsor_prizes(tournament_id);
