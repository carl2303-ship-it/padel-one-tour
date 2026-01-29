/*
  # Add Players Table and Individual Rankings System

  1. New Tables
    - `players`
      - `id` (uuid, primary key)
      - `name` (text, required) - Player's display name
      - `email` (text, optional) - For linking to user accounts
      - `user_id` (uuid, optional) - Link to auth.users
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
  2. Changes to Existing Tables
    - Add `player1_id` and `player2_id` to `teams` table to link team members to players
    - These will reference the new `players` table
  
  3. Security
    - Enable RLS on `players` table
    - Add policies for authenticated users to manage players
    - Players are public readable (for tournament viewing)
  
  4. Notes
    - Players are identified uniquely by name (case-insensitive)
    - When a team finishes in a position, both players get individual points
    - This allows tracking players across different teams and tournaments
    - Handles existing duplicate player names by keeping the oldest one
*/

-- Create players table if it doesn't exist
CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Clean up duplicate players (keep the oldest one for each name)
DO $$
DECLARE
  duplicate_name text;
  keeper_id uuid;
BEGIN
  -- For each duplicate name, keep the oldest record
  FOR duplicate_name IN
    SELECT LOWER(name)
    FROM players
    GROUP BY LOWER(name)
    HAVING COUNT(*) > 1
  LOOP
    -- Get the ID of the oldest player with this name
    SELECT id INTO keeper_id
    FROM players
    WHERE LOWER(name) = duplicate_name
    ORDER BY created_at ASC
    LIMIT 1;

    -- Delete all other players with this name
    DELETE FROM players
    WHERE LOWER(name) = duplicate_name
    AND id != keeper_id;
  END LOOP;
END $$;

-- Create unique index on lowercase name to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS players_name_lower_idx ON players (LOWER(name));

-- Add indexes
CREATE INDEX IF NOT EXISTS players_user_id_idx ON players(user_id);
CREATE INDEX IF NOT EXISTS players_email_idx ON players(email);

-- Enable RLS
ALTER TABLE players ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Players are viewable by everyone" ON players;
DROP POLICY IF EXISTS "Authenticated users can create players" ON players;
DROP POLICY IF EXISTS "Users can update own player profile" ON players;

-- Players are readable by everyone (for viewing tournaments)
CREATE POLICY "Players are viewable by everyone"
  ON players FOR SELECT
  TO public
  USING (true);

-- Authenticated users can insert players
CREATE POLICY "Authenticated users can create players"
  ON players FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Users can update their own player profile
CREATE POLICY "Users can update own player profile"
  ON players FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add player references to teams table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'teams' AND column_name = 'player1_id'
  ) THEN
    ALTER TABLE teams ADD COLUMN player1_id uuid REFERENCES players(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'teams' AND column_name = 'player2_id'
  ) THEN
    ALTER TABLE teams ADD COLUMN player2_id uuid REFERENCES players(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create indexes on team player references
CREATE INDEX IF NOT EXISTS teams_player1_id_idx ON teams(player1_id);
CREATE INDEX IF NOT EXISTS teams_player2_id_idx ON teams(player2_id);

-- Function to get or create a player by name
CREATE OR REPLACE FUNCTION get_or_create_player(player_name text, player_email text DEFAULT NULL, owner_user_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  player_id uuid;
BEGIN
  -- Try to find existing player (case-insensitive)
  SELECT id INTO player_id
  FROM players
  WHERE LOWER(name) = LOWER(player_name)
  LIMIT 1;

  -- If not found, create new player
  IF player_id IS NULL THEN
    INSERT INTO players (name, email, user_id)
    VALUES (player_name, player_email, owner_user_id)
    RETURNING id INTO player_id;
  END IF;

  RETURN player_id;
END;
$$;
