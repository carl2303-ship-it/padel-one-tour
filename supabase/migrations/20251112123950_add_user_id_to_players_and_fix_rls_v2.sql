/*
  # Add user ownership to players and fix RLS

  ## Changes
  
  1. Schema Changes
    - Add `user_id` column to `players` table
    - Backfill existing players by associating them with tournament owners
    - Delete orphaned players (not associated with any team/tournament)
    - Set NOT NULL constraint with default to current user
    - Add foreign key to auth.users
  
  2. Security Changes
    - Drop existing overly permissive RLS policies on players
    - Create restrictive policies that enforce user ownership:
      - Users can only SELECT their own players
      - Users can only INSERT players with their own user_id
      - Users can only UPDATE their own players
      - Users can only DELETE their own players
  
  ## Important Notes
  
  - Existing players are associated with the owner of their tournament
  - Orphaned players (not in any team) are deleted
  - Players are now private to each user
  - No user can see or modify another user's players
*/

-- Add user_id column to players table (nullable first)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'players' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE players ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Backfill user_id for existing players based on their tournament ownership
UPDATE players p
SET user_id = tour.user_id
FROM teams t
JOIN tournaments tour ON t.tournament_id = tour.id
WHERE (p.id = t.player1_id OR p.id = t.player2_id)
  AND p.user_id IS NULL
  AND tour.user_id IS NOT NULL;

-- Delete orphaned players (not associated with any team)
DELETE FROM players 
WHERE user_id IS NULL;

-- Now set NOT NULL constraint and default
ALTER TABLE players ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE players ALTER COLUMN user_id SET DEFAULT auth.uid();

-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can view players" ON players;
DROP POLICY IF EXISTS "Authenticated users can create players" ON players;
DROP POLICY IF EXISTS "Authenticated users can update players" ON players;
DROP POLICY IF EXISTS "Authenticated users can delete players" ON players;

-- Create restrictive RLS policies based on user ownership
CREATE POLICY "Users can view own players"
  ON players FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own players"
  ON players FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own players"
  ON players FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own players"
  ON players FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create index for better performance on user_id lookups
CREATE INDEX IF NOT EXISTS idx_players_user_id ON players(user_id);
