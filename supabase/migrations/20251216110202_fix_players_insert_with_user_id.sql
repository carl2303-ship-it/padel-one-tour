/*
  # Fix Players Insert Policy to Allow user_id

  ## Changes
    - Updates the INSERT policy for authenticated users to allow setting user_id
    - Ensures users can set their own user_id when creating players for their tournaments
    
  ## Security
    - Maintains all existing security checks
    - Allows user_id to be set to auth.uid() or left NULL
    - Prevents users from setting user_id to other users' IDs
*/

-- Drop the existing policy
DROP POLICY IF EXISTS "Authenticated users can insert players for their tournaments" ON players;

-- Create updated policy that allows setting user_id
CREATE POLICY "Authenticated users can insert players for their tournaments"
  ON players
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      -- Allow if tournament_id is null (global players) and user_id matches
      (tournament_id IS NULL AND (user_id IS NULL OR user_id = auth.uid()))
      OR
      -- Allow if the user owns the tournament
      (
        EXISTS (
          SELECT 1
          FROM tournaments t
          WHERE t.id = players.tournament_id
          AND t.user_id = auth.uid()
        )
        AND (user_id IS NULL OR user_id = auth.uid())
      )
      OR
      -- Allow if tournament allows public registration
      (
        EXISTS (
          SELECT 1
          FROM tournaments t
          WHERE t.id = players.tournament_id
          AND t.allow_public_registration = true
        )
        AND (user_id IS NULL OR user_id = auth.uid())
      )
    )
  );
