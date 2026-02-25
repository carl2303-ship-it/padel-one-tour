-- Fix RLS policies for open_game_players
-- Allow players to see and update their entries even when user_id is NULL
-- This fixes the issue where players can't see games because user_id is NULL

-- 1. Fix SELECT policy to allow reading by player_account_id
DROP POLICY IF EXISTS "Anyone can view open game players" ON open_game_players;
CREATE POLICY "Anyone can view open game players" ON open_game_players
  FOR SELECT TO authenticated
  USING (true);
-- Note: The existing policy already allows all authenticated users to view, so this is just ensuring it exists

-- 2. Fix UPDATE policy to allow updating when player_account_id matches
DROP POLICY IF EXISTS "Players can update their own entries" ON open_game_players;
CREATE POLICY "Players can update their own entries" ON open_game_players
  FOR UPDATE TO authenticated
  USING (
    -- Allow if user_id matches
    user_id = auth.uid() 
    -- OR if player_account_id matches the current user's account (fixes NULL user_id issue)
    OR EXISTS (
      SELECT 1 FROM player_accounts 
      WHERE id = open_game_players.player_account_id 
      AND user_id = auth.uid()
    )
  )
  WITH CHECK (
    -- After update, must still match one of the conditions
    user_id = auth.uid() 
    OR EXISTS (
      SELECT 1 FROM player_accounts 
      WHERE id = open_game_players.player_account_id 
      AND user_id = auth.uid()
    )
  );

COMMENT ON POLICY "Players can update their own entries" ON open_game_players IS 
'Allows players to update their entries when user_id matches OR when their player_account_id matches their account. This fixes the issue where players with NULL user_id cannot update their records.';
