/*
  # Allow authenticated users to view public tournaments

  ## Changes
  - Add policy for authenticated users to view tournaments with public registration enabled
  - This was missing - authenticated users could only see their own tournaments
  - Now they can also see public registration tournaments

  ## Security
  - Only allows viewing tournaments where allow_public_registration = true
  - Maintains existing security for private tournaments
*/

CREATE POLICY "Authenticated users can view public registration tournaments"
  ON tournaments
  FOR SELECT
  TO authenticated
  USING (allow_public_registration = true);
