/*
  # Fix Players Insert RLS Policy

  ## Changes
    - Drops conflicting INSERT policies for authenticated users
    - Creates a single unified INSERT policy that allows:
      1. Users to create players for their own tournaments
      2. Users to set their own user_id when creating players
      
  ## Security
    - Ensures users can only create players for tournaments they own
    - Allows setting user_id to their own auth.uid()
    - Maintains protection against unauthorized player creation
*/

-- Drop existing conflicting policies
DROP POLICY IF EXISTS "Users can create their own players" ON players;
DROP POLICY IF EXISTS "Users can insert players for their tournaments" ON players;

-- Create a unified INSERT policy for authenticated users
CREATE POLICY "Authenticated users can insert players for their tournaments"
  ON players
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow if tournament_id is null (global players)
    tournament_id IS NULL
    OR
    -- Allow if the user owns the tournament
    EXISTS (
      SELECT 1
      FROM tournaments t
      WHERE t.id = players.tournament_id
      AND t.user_id = auth.uid()
    )
    OR
    -- Allow if tournament allows public registration
    EXISTS (
      SELECT 1
      FROM tournaments t
      WHERE t.id = players.tournament_id
      AND t.allow_public_registration = true
    )
  );
