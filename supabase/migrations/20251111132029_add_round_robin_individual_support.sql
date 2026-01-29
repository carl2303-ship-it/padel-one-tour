/*
  # Add Round Robin Individual Support

  1. Changes
    - Add `round_robin_type` column to tournaments table (values: 'teams', 'individual')
    - Add `end_time` column to tournaments table for tournament end time
    - Add `individual_players` table for individual player registrations
    - Update RLS policies for individual_players table
    
  2. Security
    - Enable RLS on `individual_players` table
    - Add policies for authenticated users to manage their registrations
*/

-- Add round_robin_type to tournaments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'round_robin_type'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN round_robin_type text DEFAULT 'teams' CHECK (round_robin_type IN ('teams', 'individual'));
  END IF;
END $$;

-- Add end_time to tournaments if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'end_time'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN end_time time;
  END IF;
END $$;

-- Create individual_players table for round-robin individual
CREATE TABLE IF NOT EXISTS individual_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid REFERENCES tournaments(id) ON DELETE CASCADE NOT NULL,
  category_id uuid REFERENCES tournament_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE individual_players ENABLE ROW LEVEL SECURITY;

-- Policies for individual_players
CREATE POLICY "Users can view individual players in their tournaments"
  ON individual_players FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = individual_players.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert individual players in their tournaments"
  ON individual_players FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = individual_players.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update individual players in their tournaments"
  ON individual_players FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = individual_players.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = individual_players.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete individual players in their tournaments"
  ON individual_players FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = individual_players.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

-- Add player1_individual_id and player2_individual_id to matches for individual round robin
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'matches' AND column_name = 'player1_individual_id'
  ) THEN
    ALTER TABLE matches ADD COLUMN player1_individual_id uuid REFERENCES individual_players(id) ON DELETE SET NULL;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'matches' AND column_name = 'player2_individual_id'
  ) THEN
    ALTER TABLE matches ADD COLUMN player2_individual_id uuid REFERENCES individual_players(id) ON DELETE SET NULL;
  END IF;
END $$;