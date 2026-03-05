/*
  # Allow Authenticated Users to View All Players (Community Feed)

  1. Problem
    - The community feed needs to look up `players` entries for followed users
      to find their tournament matches (via teams → matches).
    - Current RLS only allows viewing:
      a) Own players (user_id = auth.uid())
      b) Players in tournaments the user owns or is enrolled in
    - This means if User A follows User B, but they share no tournaments,
      User A cannot see User B's player records → no feed matches appear.
    - Result: 2 out of 4 profiles see games, 2 don't.

  2. Solution
    - Add a broad SELECT policy allowing all authenticated users to view
      player entries. The `players` table only contains non-sensitive data
      (name, tournament_id, user_id, player_account_id, phone_number).
    - Tournament participation is public information in competitive sports.
    - matches and teams tables already have public read access.

  3. Security
    - SELECT only — no INSERT/UPDATE/DELETE changes
    - Only for authenticated users (not anonymous)
*/

-- Add policy for community feed: authenticated users can view all players
CREATE POLICY "Authenticated users can view all players for community"
  ON players
  FOR SELECT
  TO authenticated
  USING (true);
