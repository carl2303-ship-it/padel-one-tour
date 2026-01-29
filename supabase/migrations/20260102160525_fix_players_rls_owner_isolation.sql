/*
  # Fix Players RLS - Owner Isolation

  1. Problem
    - Current RLS allows all organizers to see global players (tournament_id IS NULL)
    - Each organizer should only see their own global players
    - Players within tournaments should only be visible to tournament owner

  2. Changes
    - Update "Organizers view own tournament players" policy
    - Global players (tournament_id IS NULL) now require user_id match
    - Tournament players still require tournament ownership

  3. Security
    - Ensures proper data isolation between organizers
    - Each organizer only sees their own players
*/

-- Drop existing policy
DROP POLICY IF EXISTS "Organizers view own tournament players" ON players;

-- Create new policy with proper owner isolation
CREATE POLICY "Organizers view own tournament players"
  ON players
  FOR SELECT
  TO authenticated
  USING (
    -- Tournament players: check tournament ownership
    (tournament_id IS NOT NULL AND is_tournament_owner(tournament_id))
    OR
    -- Global players: check direct ownership via user_id
    (tournament_id IS NULL AND user_id = auth.uid())
  );
