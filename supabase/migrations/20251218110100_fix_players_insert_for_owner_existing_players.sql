/*
  # Fix players insert RLS for tournament owners

  1. Problem
    - Tournament owners cannot add existing players to their tournaments
    - The RLS policy was not correctly allowing owners to insert players
  
  2. Solution
    - Update the authenticated INSERT policy to properly check tournament ownership
    - Allow tournament owners to insert any player regardless of user_id
*/

DROP POLICY IF EXISTS "Auth can insert players" ON players;

CREATE POLICY "Auth can insert players"
  ON players
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tournament_id IS NULL
    OR tournament_owned_by_user(tournament_id, auth.uid())
    OR (
      tournament_allows_public_registration(tournament_id) = true
      AND (user_id IS NULL OR user_id = auth.uid())
    )
  );