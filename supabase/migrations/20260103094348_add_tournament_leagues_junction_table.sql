/*
  # Add Tournament-Leagues Junction Table

  1. New Tables
    - `tournament_leagues`
      - `id` (uuid, primary key)
      - `tournament_id` (uuid, references tournaments)
      - `league_id` (uuid, references leagues)
      - `created_at` (timestamptz)

  2. Purpose
    - Allows a tournament to be associated with multiple leagues
    - Example: A tournament can count for both "Annual Club League" and "Category A League"

  3. Security
    - Enable RLS
    - Users can manage associations for their own tournaments/leagues
*/

-- Create tournament_leagues junction table
CREATE TABLE IF NOT EXISTS tournament_leagues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid REFERENCES tournaments(id) ON DELETE CASCADE NOT NULL,
  league_id uuid REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(tournament_id, league_id)
);

-- Enable RLS
ALTER TABLE tournament_leagues ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view tournament-league associations for their own leagues
CREATE POLICY "Users can view own tournament_leagues"
  ON tournament_leagues FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = tournament_leagues.league_id
      AND leagues.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = tournament_leagues.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

-- Policy: Users can insert associations for their own tournaments
CREATE POLICY "Users can insert tournament_leagues for own tournaments"
  ON tournament_leagues FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = tournament_leagues.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

-- Policy: Users can delete associations for their own tournaments
CREATE POLICY "Users can delete tournament_leagues for own tournaments"
  ON tournament_leagues FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = tournament_leagues.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tournament_leagues_tournament_id ON tournament_leagues(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_leagues_league_id ON tournament_leagues(league_id);

-- Migrate existing league_id data to the new junction table
INSERT INTO tournament_leagues (tournament_id, league_id)
SELECT id, league_id FROM tournaments
WHERE league_id IS NOT NULL
ON CONFLICT (tournament_id, league_id) DO NOTHING;
