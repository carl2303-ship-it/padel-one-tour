/*
  # Fix League Standings for Player App

  1. Update player_account_id for league_standings by matching entity_id (player) to player_accounts
     - Match via players.phone_number = player_accounts.phone_number
     - Or players.name ilike player_accounts.name (when phone not available)

  2. Add RLS policy to allow players to view league_standings by entity_id
     - When entity_id matches a player linked to their player_account
*/

-- Step 1: Update player_account_id for standings where entity_id matches a player
-- Match by phone first (most reliable), then by name
UPDATE league_standings ls
SET player_account_id = pa.id
FROM players p
JOIN player_accounts pa ON (
  (pa.phone_number IS NOT NULL AND p.phone_number IS NOT NULL AND 
   LOWER(TRIM(REPLACE(COALESCE(p.phone_number, ''), ' ', ''))) = LOWER(TRIM(REPLACE(COALESCE(pa.phone_number, ''), ' ', ''))))
  OR
  (pa.name IS NOT NULL AND p.name IS NOT NULL AND 
   LOWER(TRIM(p.name)) = LOWER(TRIM(pa.name)))
)
WHERE ls.entity_type = 'player'
  AND ls.entity_id = p.id
  AND ls.player_account_id IS NULL;

-- Step 2: Add policy to allow viewing by entity_id when player belongs to current user's account
-- (Keep existing "Players can view own league standings" - this adds entity_id fallback)
DROP POLICY IF EXISTS "Players can view league standings by entity" ON league_standings;
CREATE POLICY "Players can view league standings by entity"
  ON league_standings
  FOR SELECT
  TO authenticated
  USING (
    -- Existing: match by player_account_id
    (player_account_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM player_accounts
      WHERE player_accounts.id = league_standings.player_account_id
        AND player_accounts.user_id = auth.uid()
    ))
    OR
    -- New: match by entity_id when entity is a player linked to current user's account
    (entity_type = 'player' AND entity_id IN (
      SELECT p.id FROM players p
      JOIN player_accounts pa ON pa.user_id = auth.uid()
      WHERE (pa.phone_number IS NOT NULL AND p.phone_number IS NOT NULL AND 
             LOWER(TRIM(REPLACE(COALESCE(p.phone_number, ''), ' ', ''))) = LOWER(TRIM(REPLACE(COALESCE(pa.phone_number, ''), ' ', ''))))
         OR (pa.name IS NOT NULL AND p.name IS NOT NULL AND 
             LOWER(TRIM(p.name)) = LOWER(TRIM(pa.name)))
    ))
  );
