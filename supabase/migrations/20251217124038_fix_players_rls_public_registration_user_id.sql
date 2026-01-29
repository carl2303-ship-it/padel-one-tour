/*
  # Fix players RLS for public registration with user_id

  1. Problem
    - When a player registers for a tournament with public registration:
      - signUp creates/authenticates a user (changes session)
      - Insert passes user_id from player_account (may differ from auth.uid())
      - Current policy blocks this because user_id != auth.uid()

  2. Solution
    - Update the insert policy to allow any user_id when tournament has public registration
    - The user_id should match auth.uid() OR be null when tournament allows public registration

  3. Changes
    - Drop and recreate "Authenticated users can insert players for their tournaments" policy
*/

DROP POLICY IF EXISTS "Authenticated users can insert players for their tournaments" ON players;

CREATE POLICY "Authenticated users can insert players for their tournaments"
  ON players
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      (tournament_id IS NULL) AND ((user_id IS NULL) OR (user_id = auth.uid()))
    )
    OR
    (
      EXISTS (
        SELECT 1 FROM tournaments t
        WHERE t.id = players.tournament_id AND t.user_id = auth.uid()
      )
    )
    OR
    (
      EXISTS (
        SELECT 1 FROM tournaments t
        WHERE t.id = players.tournament_id AND t.allow_public_registration = true
      )
      AND ((user_id IS NULL) OR (user_id = auth.uid()))
    )
  );