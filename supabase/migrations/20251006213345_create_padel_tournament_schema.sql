/*
  # Padel Tournament Management Schema

  ## Overview
  Complete schema for managing padel tournaments including players, teams, matches, and results.

  ## 1. New Tables
  
  ### `tournaments`
  - `id` (uuid, primary key) - Unique tournament identifier
  - `name` (text) - Tournament name
  - `description` (text) - Tournament description
  - `start_date` (date) - Tournament start date
  - `end_date` (date) - Tournament end date
  - `status` (text) - Tournament status: 'draft', 'active', 'completed', 'cancelled'
  - `format` (text) - Tournament format: 'single_elimination', 'round_robin', 'groups_knockout'
  - `max_teams` (integer) - Maximum number of teams allowed
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Record update timestamp

  ### `players`
  - `id` (uuid, primary key) - Unique player identifier
  - `name` (text) - Player full name
  - `email` (text) - Player email address
  - `phone` (text) - Player phone number
  - `skill_level` (text) - Player skill level: 'beginner', 'intermediate', 'advanced', 'professional'
  - `created_at` (timestamptz) - Record creation timestamp

  ### `teams`
  - `id` (uuid, primary key) - Unique team identifier
  - `tournament_id` (uuid, foreign key) - Reference to tournament
  - `name` (text) - Team name
  - `player1_id` (uuid, foreign key) - First player reference
  - `player2_id` (uuid, foreign key) - Second player reference
  - `seed` (integer) - Team seeding position
  - `created_at` (timestamptz) - Record creation timestamp

  ### `matches`
  - `id` (uuid, primary key) - Unique match identifier
  - `tournament_id` (uuid, foreign key) - Reference to tournament
  - `team1_id` (uuid, foreign key) - First team reference
  - `team2_id` (uuid, foreign key) - Second team reference
  - `round` (text) - Match round: 'group_stage', 'round_of_16', 'quarter_final', 'semi_final', 'final'
  - `match_number` (integer) - Match sequence number
  - `scheduled_time` (timestamptz) - Scheduled match time
  - `court` (text) - Court identifier
  - `status` (text) - Match status: 'scheduled', 'in_progress', 'completed', 'cancelled'
  - `team1_score_set1` (integer) - Team 1 score for set 1
  - `team2_score_set1` (integer) - Team 2 score for set 1
  - `team1_score_set2` (integer) - Team 1 score for set 2
  - `team2_score_set2` (integer) - Team 2 score for set 2
  - `team1_score_set3` (integer) - Team 1 score for set 3
  - `team2_score_set3` (integer) - Team 2 score for set 3
  - `winner_id` (uuid, foreign key) - Winning team reference
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Record update timestamp

  ## 2. Security
  
  ### Row Level Security (RLS)
  - Enable RLS on all tables
  - Public read access for all tournament data
  - Authenticated users can create and manage tournaments
  - Authenticated users can create players and teams
  - Authenticated users can update match results

  ### Important Notes
  - All data is publicly readable to allow spectators and participants to view tournament information
  - Write operations require authentication
  - Future enhancement: Add user ownership and roles for fine-grained control
*/

-- Create tournaments table
CREATE TABLE IF NOT EXISTS tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
  format text NOT NULL DEFAULT 'single_elimination' CHECK (format IN ('single_elimination', 'round_robin', 'groups_knockout')),
  max_teams integer DEFAULT 16 CHECK (max_teams > 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create players table
CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  phone text,
  skill_level text DEFAULT 'intermediate' CHECK (skill_level IN ('beginner', 'intermediate', 'advanced', 'professional')),
  created_at timestamptz DEFAULT now()
);

-- Create teams table
CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name text NOT NULL,
  player1_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player2_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  seed integer,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT different_players CHECK (player1_id != player2_id)
);

-- Create matches table
CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team1_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  team2_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  round text NOT NULL DEFAULT 'group_stage',
  match_number integer NOT NULL,
  scheduled_time timestamptz,
  court text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  team1_score_set1 integer DEFAULT 0,
  team2_score_set1 integer DEFAULT 0,
  team1_score_set2 integer DEFAULT 0,
  team2_score_set2 integer DEFAULT 0,
  team1_score_set3 integer DEFAULT 0,
  team2_score_set3 integer DEFAULT 0,
  winner_id uuid REFERENCES teams(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tournaments
CREATE POLICY "Anyone can view tournaments"
  ON tournaments FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Authenticated users can create tournaments"
  ON tournaments FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update tournaments"
  ON tournaments FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete tournaments"
  ON tournaments FOR DELETE
  TO authenticated
  USING (true);

-- RLS Policies for players
CREATE POLICY "Anyone can view players"
  ON players FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Authenticated users can create players"
  ON players FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update players"
  ON players FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete players"
  ON players FOR DELETE
  TO authenticated
  USING (true);

-- RLS Policies for teams
CREATE POLICY "Anyone can view teams"
  ON teams FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Authenticated users can create teams"
  ON teams FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update teams"
  ON teams FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete teams"
  ON teams FOR DELETE
  TO authenticated
  USING (true);

-- RLS Policies for matches
CREATE POLICY "Anyone can view matches"
  ON matches FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Authenticated users can create matches"
  ON matches FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update matches"
  ON matches FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete matches"
  ON matches FOR DELETE
  TO authenticated
  USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_teams_tournament ON teams(tournament_id);
CREATE INDEX IF NOT EXISTS idx_teams_players ON teams(player1_id, player2_id);
CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_matches_teams ON matches(team1_id, team2_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);