/*
  # Fix Players Insert Policy for Tournament Owners

  1. Problem
    - Tournament owners cannot insert players with different user_id values
    - This breaks tournament copy functionality
    - Organizers need to add players to their tournaments regardless of player's user_id

  2. Solution
    - Update the INSERT policy to allow tournament owners to insert any player
    - Tournament owners have full control over players in their tournaments
*/

DROP POLICY IF EXISTS "Authenticated users can insert players for their tournaments" ON players;

CREATE POLICY "Authenticated users can insert players for their tournaments"
  ON players
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (tournament_id IS NULL AND (user_id IS NULL OR user_id = auth.uid()))
    OR
    EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = players.tournament_id AND t.user_id = auth.uid()
    )
    OR
    (
      EXISTS (
        SELECT 1 FROM tournaments t
        WHERE t.id = players.tournament_id AND t.allow_public_registration = true
      )
      AND (user_id IS NULL OR user_id = auth.uid())
    )
  );
