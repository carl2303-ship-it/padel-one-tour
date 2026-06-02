/*
  # Fix tournament visibility for independent organizers

  The existing RLS policy only allows viewing tournaments where:
  - user_id = auth.uid() (organizer)
  - allow_public_registration = true

  Independent organizer tournaments need to be visible to all authenticated users
  when they are public (not invite_only).

  This migration updates the policy to also include tournaments without a club
  that have public visibility.
*/

DROP POLICY IF EXISTS "Authenticated users can view tournaments" ON tournaments;

CREATE POLICY "Authenticated users can view tournaments"
  ON tournaments
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR allow_public_registration = true
    OR (club_id IS NULL AND (visibility IS NULL OR visibility = 'public'))
  );
