/*
  # Allow anonymous access to tournaments for live view

  1. Changes
    - Add SELECT policy for anonymous users on tournaments table
    - This allows the public live tournament view to work without authentication

  2. Security
    - Anonymous users can only read tournament data, not modify it
    - All write operations still require authentication and ownership
*/

-- Allow anonymous users to view all tournaments
CREATE POLICY "Anonymous users can view all tournaments"
  ON tournaments FOR SELECT
  TO anon
  USING (true);
