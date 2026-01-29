/*
  # Allow Players to View Their Own League Standings

  1. Changes
    - Add RLS policy to allow players to view their own standings in any league
    - This enables players to see their ranking even in private leagues

  2. Security
    - Players can only see their own standings (matched by player_account_id)
    - Uses auth.uid() to verify ownership through player_accounts table
*/

CREATE POLICY "Players can view own league standings"
  ON league_standings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM player_accounts
      WHERE player_accounts.id = league_standings.player_account_id
        AND player_accounts.user_id = auth.uid()
    )
  );
