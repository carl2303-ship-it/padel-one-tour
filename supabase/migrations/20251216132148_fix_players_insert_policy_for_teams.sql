/*
  # Fix Players Insert Policy for Team Registration

  1. Changes
    - Drop and recreate the INSERT policy for authenticated users
    - Allow tournament organizers to insert players with any user_id (or NULL)
    - Remove the restrictive check on user_id that was blocking team registration

  2. Security
    - Still requires that the user owns the tournament
    - Or that the tournament allows public registration
    - Or that it's a generic player (no tournament_id)
*/

-- Drop the existing policy
DROP POLICY IF EXISTS "Authenticated users can insert players for their tournaments" ON players;

-- Create a new, less restrictive policy
CREATE POLICY "Authenticated users can insert players for their tournaments"
  ON players
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow generic players (no tournament) with user_id = NULL or own user_id
    (tournament_id IS NULL AND (user_id IS NULL OR user_id = auth.uid()))
    OR
    -- Allow tournament organizers to add any players to their tournaments
    (EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = players.tournament_id
      AND t.user_id = auth.uid()
    ))
    OR
    -- Allow public registration with user_id = NULL or own user_id
    (EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = players.tournament_id
      AND t.allow_public_registration = true
    ) AND (user_id IS NULL OR user_id = auth.uid()))
  );
