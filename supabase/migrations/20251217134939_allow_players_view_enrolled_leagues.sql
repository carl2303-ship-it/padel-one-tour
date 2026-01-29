/*
  # Allow Players to View Leagues Where They Have Standings

  1. Changes
    - Add RLS policy to allow players to view leagues where they have standings
    - This enables the player dashboard to load league info for standings display

  2. Security
    - Players can only see leagues where they have an associated player_account
    - Uses auth.uid() to verify ownership through player_accounts and league_standings
*/

CREATE POLICY "Players can view leagues with own standings"
  ON leagues
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_standings ls
      JOIN player_accounts pa ON pa.id = ls.player_account_id
      WHERE ls.league_id = leagues.id
        AND pa.user_id = auth.uid()
    )
  );
