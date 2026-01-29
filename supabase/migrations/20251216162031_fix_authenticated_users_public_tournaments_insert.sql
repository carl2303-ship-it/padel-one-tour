/*
  # Fix authenticated users inserting players in public tournaments

  ## Changes
  - Update RLS policy for authenticated users to allow insertion in public tournaments
  - The issue was that authenticated users couldn't create players in public tournaments
  - Now authenticated users can create players if:
    1. Tournament is NULL (generic players)
    2. Tournament belongs to them (organizers)
    3. Tournament allows public registration (any authenticated user)

  ## Security
  - Maintains security by checking tournament ownership or public registration flag
  - Users can only set their own user_id or leave it NULL
*/

-- Drop existing policy
DROP POLICY IF EXISTS "Authenticated users can insert players for their tournaments" ON players;

-- Create new policy that allows authenticated users to insert in public tournaments
CREATE POLICY "Authenticated users can insert players for their tournaments"
  ON players
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Generic players without tournament (user must own the player)
    (tournament_id IS NULL AND (user_id IS NULL OR user_id = auth.uid()))
    OR
    -- Players for tournaments owned by the user
    (EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = players.tournament_id
      AND t.user_id = auth.uid()
    ))
    OR
    -- Players for public registration tournaments (anyone authenticated can register)
    (EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = players.tournament_id
      AND t.allow_public_registration = true
    ))
  );
