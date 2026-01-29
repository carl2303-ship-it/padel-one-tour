/*
  # Fix Players Privacy Policies

  1. Changes
    - Remove overly permissive public access to all players
    - Implement strict privacy: users can only see their own players and players in their tournaments
    - Allow anonymous users to see players only in public tournaments (for registration and live view)

  2. Security
    - Drop all existing player policies
    - Create restrictive policies based on user ownership and tournament access
    - Players are private by default unless in a public tournament
*/

-- Drop all existing policies on players table
DROP POLICY IF EXISTS "Players are viewable by everyone" ON players;
DROP POLICY IF EXISTS "Anonymous users can create players for public registration" ON players;
DROP POLICY IF EXISTS "Authenticated users can create players" ON players;
DROP POLICY IF EXISTS "Authenticated users can create players for registration" ON players;
DROP POLICY IF EXISTS "Authenticated users can view players in public tournament teams" ON players;
DROP POLICY IF EXISTS "Users can view own players and public registration players" ON players;
DROP POLICY IF EXISTS "Users can update own player profile" ON players;
DROP POLICY IF EXISTS "Users can update own players" ON players;
DROP POLICY IF EXISTS "Users can delete own players" ON players;

-- SELECT policies for authenticated users
CREATE POLICY "Users can view their own players"
  ON players
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view players in their tournaments"
  ON players
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM teams
      JOIN tournaments ON tournaments.id = teams.tournament_id
      WHERE (teams.player1_id = players.id OR teams.player2_id = players.id)
      AND tournaments.user_id = auth.uid()
    )
  );

-- SELECT policy for anonymous users (only for public tournaments)
CREATE POLICY "Anonymous users can view players in public tournaments"
  ON players
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM teams
      JOIN tournaments ON tournaments.id = teams.tournament_id
      WHERE (teams.player1_id = players.id OR teams.player2_id = players.id)
      AND tournaments.allow_public_registration = true
    )
  );

-- INSERT policies
CREATE POLICY "Users can create their own players"
  ON players
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Anonymous users can create players for public registration"
  ON players
  FOR INSERT
  TO anon
  WITH CHECK (user_id IS NULL);

-- UPDATE policies
CREATE POLICY "Users can update their own players"
  ON players
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE policies
CREATE POLICY "Users can delete their own players"
  ON players
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
