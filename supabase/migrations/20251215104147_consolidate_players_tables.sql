/*
  # Consolidate individual_players into players table

  1. Changes to players table
    - Add `tournament_id` column (nullable, references tournaments)
    - Add `category_id` column (nullable, references tournament_categories)
    - Add `payment_status` column (nullable)
    - Add `payment_transaction_id` column (nullable, references payment_transactions)
    - Add `final_position` column (nullable)

  2. Data Migration
    - Migrate all data from `individual_players` to `players`
    - Update all foreign keys in `matches` table to point to new player records
    - Update `payment_transactions.player_id` to point to new player records

  3. Cleanup
    - Drop all foreign key constraints related to `individual_players`
    - Drop `individual_players` table

  4. Security
    - Update RLS policies on players table to handle tournament-based access
*/

-- Step 1: Add new columns to players table
ALTER TABLE players
ADD COLUMN IF NOT EXISTS tournament_id uuid REFERENCES tournaments(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES tournament_categories(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'exempt')),
ADD COLUMN IF NOT EXISTS payment_transaction_id uuid REFERENCES payment_transactions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS final_position integer;

-- Step 2: Migrate data from individual_players to players
-- Create a temporary mapping table to track old IDs to new IDs
CREATE TEMP TABLE individual_player_mapping AS
SELECT 
  ip.id as old_id,
  gen_random_uuid() as new_id,
  ip.tournament_id,
  ip.category_id,
  ip.name,
  ip.email,
  ip.phone,
  ip.payment_status,
  ip.payment_transaction_id,
  ip.final_position
FROM individual_players ip;

-- Insert migrated players into players table
INSERT INTO players (id, name, email, phone_number, tournament_id, category_id, payment_status, payment_transaction_id, final_position, created_at)
SELECT 
  new_id,
  name,
  email,
  phone as phone_number,
  tournament_id,
  category_id,
  payment_status,
  payment_transaction_id,
  final_position,
  now()
FROM individual_player_mapping;

-- Step 3: Update foreign keys in matches table
-- First, drop the old foreign key constraints
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_player1_individual_id_fkey;
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_player2_individual_id_fkey;
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_player3_individual_id_fkey;
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_player4_individual_id_fkey;

-- Update the matches table to point to new player IDs
UPDATE matches m
SET player1_individual_id = (SELECT new_id FROM individual_player_mapping WHERE old_id = m.player1_individual_id)
WHERE player1_individual_id IS NOT NULL;

UPDATE matches m
SET player2_individual_id = (SELECT new_id FROM individual_player_mapping WHERE old_id = m.player2_individual_id)
WHERE player2_individual_id IS NOT NULL;

UPDATE matches m
SET player3_individual_id = (SELECT new_id FROM individual_player_mapping WHERE old_id = m.player3_individual_id)
WHERE player3_individual_id IS NOT NULL;

UPDATE matches m
SET player4_individual_id = (SELECT new_id FROM individual_player_mapping WHERE old_id = m.player4_individual_id)
WHERE player4_individual_id IS NOT NULL;

-- Add new foreign key constraints pointing to players table
ALTER TABLE matches 
ADD CONSTRAINT matches_player1_individual_id_fkey 
FOREIGN KEY (player1_individual_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE matches 
ADD CONSTRAINT matches_player2_individual_id_fkey 
FOREIGN KEY (player2_individual_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE matches 
ADD CONSTRAINT matches_player3_individual_id_fkey 
FOREIGN KEY (player3_individual_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE matches 
ADD CONSTRAINT matches_player4_individual_id_fkey 
FOREIGN KEY (player4_individual_id) REFERENCES players(id) ON DELETE SET NULL;

-- Step 4: Update payment_transactions.player_id
-- First drop the old constraint
ALTER TABLE payment_transactions DROP CONSTRAINT IF EXISTS payment_transactions_player_id_fkey;

-- Update the player_id references
UPDATE payment_transactions pt
SET player_id = (SELECT new_id FROM individual_player_mapping WHERE old_id = pt.player_id)
WHERE player_id IS NOT NULL;

-- Add new foreign key constraint pointing to players table
ALTER TABLE payment_transactions
ADD CONSTRAINT payment_transactions_player_id_fkey
FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL;

-- Step 5: Drop individual_players table
-- First drop remaining foreign key constraints
ALTER TABLE individual_players DROP CONSTRAINT IF EXISTS individual_players_tournament_id_fkey;
ALTER TABLE individual_players DROP CONSTRAINT IF EXISTS individual_players_category_id_fkey;
ALTER TABLE individual_players DROP CONSTRAINT IF EXISTS individual_players_payment_transaction_id_fkey;

-- Now drop the table
DROP TABLE IF EXISTS individual_players;

-- Step 6: Update RLS policies for players table
-- Drop old policies
DROP POLICY IF EXISTS "Players are viewable by everyone" ON players;
DROP POLICY IF EXISTS "Users can insert their own players" ON players;
DROP POLICY IF EXISTS "Users can update their own players" ON players;
DROP POLICY IF EXISTS "Users can delete their own players" ON players;

-- Create comprehensive policies
CREATE POLICY "Anyone can view players in public tournaments"
  ON players FOR SELECT
  USING (
    -- Players without tournament_id (team players)
    tournament_id IS NULL
    OR
    -- Players in tournaments that allow public registration
    EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = players.tournament_id
      AND t.allow_public_registration = true
    )
    OR
    -- Players in tournaments owned by authenticated user
    EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = players.tournament_id
      AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert players for their tournaments"
  ON players FOR INSERT
  TO authenticated
  WITH CHECK (
    -- User can insert players without tournament_id
    tournament_id IS NULL
    OR
    -- User can insert players for public registration tournaments
    EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = players.tournament_id
      AND t.allow_public_registration = true
    )
    OR
    -- User can insert players for their own tournaments
    EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = players.tournament_id
      AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update players for their tournaments"
  ON players FOR UPDATE
  TO authenticated
  USING (
    -- User owns the player record
    user_id = auth.uid()
    OR
    -- User owns the tournament
    EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = players.tournament_id
      AND t.user_id = auth.uid()
    )
  )
  WITH CHECK (
    -- User owns the player record
    user_id = auth.uid()
    OR
    -- User owns the tournament
    EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = players.tournament_id
      AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete players for their tournaments"
  ON players FOR DELETE
  TO authenticated
  USING (
    -- User owns the player record
    user_id = auth.uid()
    OR
    -- User owns the tournament
    EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = players.tournament_id
      AND t.user_id = auth.uid()
    )
  );