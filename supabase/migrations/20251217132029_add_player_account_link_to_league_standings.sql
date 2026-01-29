/*
  # Link League Standings to Player Accounts

  1. Changes
    - Add `player_account_id` column to `league_standings` table
    - This allows direct linking between league standings and player accounts
    - Players can see their league positions in their dashboard

  2. Data Migration
    - Automatically link existing standings to player accounts by matching names
*/

-- Add player_account_id column
ALTER TABLE league_standings 
ADD COLUMN IF NOT EXISTS player_account_id uuid REFERENCES player_accounts(id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_league_standings_player_account_id 
ON league_standings(player_account_id);

-- Link existing standings to player accounts by exact name match
UPDATE league_standings ls
SET player_account_id = pa.id
FROM player_accounts pa
WHERE LOWER(TRIM(ls.entity_name)) = LOWER(TRIM(pa.name))
  AND ls.player_account_id IS NULL
  AND ls.entity_type = 'player';
