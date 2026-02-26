-- =====================================================
-- Fix RLS policy for open_games to allow players to see games they're in
-- =====================================================

-- Drop existing policy
DROP POLICY IF EXISTS "Anyone can view open games" ON open_games;

-- Create new policy that allows:
-- 1. Anyone authenticated can see all games (existing behavior)
-- 2. Players can see games they're confirmed in (even if RLS blocks direct access)
-- This ensures that all confirmed players can see the game, not just the creator
CREATE POLICY "Anyone can view open games" ON open_games
  FOR SELECT TO authenticated
  USING (
    -- Allow if user is the creator
    creator_user_id = auth.uid() OR
    -- Allow if user is confirmed in the game (by user_id)
    EXISTS (
      SELECT 1 FROM open_game_players
      WHERE open_game_players.game_id = open_games.id
      AND open_game_players.status = 'confirmed'
      AND open_game_players.user_id = auth.uid()
    ) OR
    -- Allow if user is confirmed in the game (by player_account_id)
    EXISTS (
      SELECT 1 FROM open_game_players
      INNER JOIN player_accounts ON player_accounts.id = open_game_players.player_account_id
      WHERE open_game_players.game_id = open_games.id
      AND open_game_players.status = 'confirmed'
      AND player_accounts.user_id = auth.uid()
    ) OR
    -- Fallback: allow all authenticated users (backward compatibility)
    true
  );
