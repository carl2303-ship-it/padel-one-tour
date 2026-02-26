-- =====================================================
-- Fix RLS policy for open_games to allow players to see games they're in
-- =====================================================

-- Drop existing policy
DROP POLICY IF EXISTS "Anyone can view open games" ON open_games;

-- Create new policy that allows:
-- 1. Anyone authenticated can see all games (existing behavior)
-- 2. Players can see games they're confirmed in (even if RLS blocks direct access)
CREATE POLICY "Anyone can view open games" ON open_games
  FOR SELECT TO authenticated
  USING (
    true OR
    EXISTS (
      SELECT 1 FROM open_game_players
      WHERE open_game_players.game_id = open_games.id
      AND open_game_players.status = 'confirmed'
      AND (
        open_game_players.user_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM player_accounts
          WHERE player_accounts.id = open_game_players.player_account_id
          AND player_accounts.user_id = auth.uid()
        )
      )
    )
  );

-- Note: The `true OR` ensures backward compatibility (anyone can see all games)
-- The EXISTS clause is redundant but makes the intent clear
