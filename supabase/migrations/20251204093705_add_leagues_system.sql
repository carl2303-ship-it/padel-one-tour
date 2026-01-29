/*
  # Add Leagues System

  1. New Tables
    - `leagues`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `name` (text) - league name
      - `description` (text) - league description
      - `start_date` (date) - league start date
      - `end_date` (date) - league end date
      - `scoring_system` (jsonb) - points by position {1: 100, 2: 80, 3: 60, ...}
      - `status` (text) - active/completed/draft
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `league_standings`
      - `id` (uuid, primary key)
      - `league_id` (uuid, references leagues)
      - `entity_type` (text) - 'team' or 'individual'
      - `entity_id` (uuid) - references teams.id or individual_players.id
      - `entity_name` (text) - cached name for performance
      - `total_points` (integer) - accumulated points
      - `tournaments_played` (integer) - number of tournaments completed
      - `best_position` (integer) - best finishing position
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Changes
    - Add `league_id` to tournaments table
    - Add `final_position` to teams table
    - Add `final_position` to individual_players table

  3. Security
    - Enable RLS on all tables
    - Users can only manage their own leagues
    - Public can view active leagues if owner allows
*/

-- Create leagues table
CREATE TABLE IF NOT EXISTS leagues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  name text NOT NULL,
  description text DEFAULT '',
  start_date date NOT NULL,
  end_date date,
  scoring_system jsonb DEFAULT '{"1": 100, "2": 80, "3": 60, "4": 50, "5": 40, "6": 35, "7": 30, "8": 25}'::jsonb,
  status text DEFAULT 'active' CHECK (status IN ('draft', 'active', 'completed')),
  allow_public_view boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create league_standings table
CREATE TABLE IF NOT EXISTS league_standings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('team', 'individual')),
  entity_id uuid NOT NULL,
  entity_name text NOT NULL,
  total_points integer DEFAULT 0,
  tournaments_played integer DEFAULT 0,
  best_position integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(league_id, entity_type, entity_id)
);

-- Add league_id to tournaments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'league_id'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN league_id uuid REFERENCES leagues(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add final_position to teams
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'teams' AND column_name = 'final_position'
  ) THEN
    ALTER TABLE teams ADD COLUMN final_position integer;
  END IF;
END $$;

-- Add final_position to individual_players
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'individual_players' AND column_name = 'final_position'
  ) THEN
    ALTER TABLE individual_players ADD COLUMN final_position integer;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_standings ENABLE ROW LEVEL SECURITY;

-- Policies for leagues
CREATE POLICY "Users can view own leagues"
  ON leagues FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view public leagues"
  ON leagues FOR SELECT
  TO authenticated
  USING (allow_public_view = true);

CREATE POLICY "Users can insert own leagues"
  ON leagues FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own leagues"
  ON leagues FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own leagues"
  ON leagues FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Policies for league_standings
CREATE POLICY "Users can view standings of own leagues"
  ON league_standings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_standings.league_id
      AND leagues.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view standings of public leagues"
  ON league_standings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_standings.league_id
      AND leagues.allow_public_view = true
    )
  );

CREATE POLICY "Users can insert standings for own leagues"
  ON league_standings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_standings.league_id
      AND leagues.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update standings for own leagues"
  ON league_standings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_standings.league_id
      AND leagues.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_standings.league_id
      AND leagues.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete standings for own leagues"
  ON league_standings FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_standings.league_id
      AND leagues.user_id = auth.uid()
    )
  );

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_leagues_user_id ON leagues(user_id);
CREATE INDEX IF NOT EXISTS idx_league_standings_league_id ON league_standings(league_id);
CREATE INDEX IF NOT EXISTS idx_league_standings_entity ON league_standings(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_league_id ON tournaments(league_id);
