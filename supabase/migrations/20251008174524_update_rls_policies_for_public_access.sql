/*
  # Update RLS policies for public access

  1. Changes
    - Update all tables to allow public access (no authentication required)
    - This is for demo/testing purposes
    - Policies now use `public` role instead of `authenticated`
  
  2. Tables Updated
    - tournaments (SELECT, INSERT, UPDATE, DELETE)
    - teams (SELECT, INSERT, UPDATE, DELETE)
    - players (SELECT, INSERT, UPDATE, DELETE)
    - matches (SELECT, INSERT, UPDATE, DELETE)
  
  3. Security Notes
    - In a production app, you would want proper authentication
    - For this demo app, public access is acceptable
*/

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Authenticated users can create tournaments" ON tournaments;
DROP POLICY IF EXISTS "Authenticated users can update tournaments" ON tournaments;
DROP POLICY IF EXISTS "Authenticated users can delete tournaments" ON tournaments;

DROP POLICY IF EXISTS "Authenticated users can create teams" ON teams;
DROP POLICY IF EXISTS "Authenticated users can update teams" ON teams;
DROP POLICY IF EXISTS "Authenticated users can delete teams" ON teams;

DROP POLICY IF EXISTS "Authenticated users can create players" ON players;
DROP POLICY IF EXISTS "Authenticated users can update players" ON players;
DROP POLICY IF EXISTS "Authenticated users can delete players" ON players;

DROP POLICY IF EXISTS "Authenticated users can create matches" ON matches;
DROP POLICY IF EXISTS "Authenticated users can update matches" ON matches;
DROP POLICY IF EXISTS "Authenticated users can delete matches" ON matches;

-- Create public access policies for tournaments
CREATE POLICY "Public can insert tournaments"
  ON tournaments FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Public can update tournaments"
  ON tournaments FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Public can delete tournaments"
  ON tournaments FOR DELETE
  TO public
  USING (true);

-- Create public access policies for teams
CREATE POLICY "Public can insert teams"
  ON teams FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Public can update teams"
  ON teams FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Public can delete teams"
  ON teams FOR DELETE
  TO public
  USING (true);

-- Create public access policies for players
CREATE POLICY "Public can insert players"
  ON players FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Public can update players"
  ON players FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Public can delete players"
  ON players FOR DELETE
  TO public
  USING (true);

-- Create public access policies for matches
CREATE POLICY "Public can insert matches"
  ON matches FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Public can update matches"
  ON matches FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Public can delete matches"
  ON matches FOR DELETE
  TO public
  USING (true);
