/*
  # Add player3 and player4 columns to matches table

  1. Changes
    - Add `player3_individual_id` column to `matches` table
    - Add `player4_individual_id` column to `matches` table
    - Add foreign key constraints to `individual_players` table
  
  2. Purpose
    - Support American format (4 players per match: 2v2)
    - player1 + player2 vs player3 + player4
*/

-- Add player3_individual_id column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'matches' AND column_name = 'player3_individual_id'
  ) THEN
    ALTER TABLE matches ADD COLUMN player3_individual_id uuid REFERENCES individual_players(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add player4_individual_id column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'matches' AND column_name = 'player4_individual_id'
  ) THEN
    ALTER TABLE matches ADD COLUMN player4_individual_id uuid REFERENCES individual_players(id) ON DELETE SET NULL;
  END IF;
END $$;
