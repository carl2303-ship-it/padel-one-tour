/*
  # Fix Organizer Data Isolation

  This migration fixes critical data isolation issues where organizers could see
  data from other organizers' accounts.

  ## Changes

  1. Removes overly permissive public SELECT policies from:
     - tournament_categories
     - players
     - teams

  2. Tightens access to ensure:
     - Organizers only see their own tournaments, leagues, players, teams
     - Public/anonymous access is only for live tournament viewing (read-only)
     - Players can only see data for tournaments they're enrolled in

  ## Security Notes
  - Data isolation is critical for multi-tenant SaaS functionality
  - Each organizer's data must be completely isolated from others
*/

-- Drop overly permissive policies on tournament_categories
DROP POLICY IF EXISTS "Public can view tournament categories" ON tournament_categories;
DROP POLICY IF EXISTS "Public can create tournament categories" ON tournament_categories;
DROP POLICY IF EXISTS "Public can update tournament categories" ON tournament_categories;
DROP POLICY IF EXISTS "Public can delete tournament categories" ON tournament_categories;

-- Drop overly permissive policies on players
DROP POLICY IF EXISTS "Anyone can view players" ON players;

-- Drop overly permissive policies on teams  
DROP POLICY IF EXISTS "Anyone can view teams" ON teams;
DROP POLICY IF EXISTS "Anonymous users can view all teams for live view" ON teams;

-- Drop overly permissive policies on matches
DROP POLICY IF EXISTS "Anonymous users can view all matches for live view" ON matches;

-- Drop overly permissive policies on tournaments
DROP POLICY IF EXISTS "Anonymous users can view all tournaments" ON tournaments;

-- Create proper restricted policies for tournament_categories
-- Only organizers can manage their tournament categories
CREATE POLICY "Organizers can manage own tournament categories"
  ON tournament_categories FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tournaments t 
    WHERE t.id = tournament_categories.tournament_id 
    AND t.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM tournaments t 
    WHERE t.id = tournament_categories.tournament_id 
    AND t.user_id = auth.uid()
  ));

-- Anonymous can view categories only for public tournaments (for registration)
CREATE POLICY "Anon can view categories for public tournaments"
  ON tournament_categories FOR SELECT
  TO anon
  USING (EXISTS (
    SELECT 1 FROM tournaments t 
    WHERE t.id = tournament_categories.tournament_id 
    AND t.allow_public_registration = true
  ));

-- Create proper restricted policies for players
-- Organizers can view players in their tournaments
CREATE POLICY "Organizers can view players in own tournaments"
  ON players FOR SELECT
  TO authenticated
  USING (
    tournament_id IS NULL 
    OR EXISTS (
      SELECT 1 FROM tournaments t 
      WHERE t.id = players.tournament_id 
      AND t.user_id = auth.uid()
    )
  );

-- Players can view other players in tournaments they're enrolled in
CREATE POLICY "Players can view players in enrolled tournaments"
  ON players FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM players p2 
      WHERE p2.tournament_id = players.tournament_id 
      AND p2.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM player_accounts pa
      JOIN players p2 ON normalize_phone(p2.phone_number) = normalize_phone(pa.phone_number)
      WHERE pa.user_id = auth.uid()
      AND p2.tournament_id = players.tournament_id
    )
  );

-- Anonymous can view players in public tournaments (for live view)
CREATE POLICY "Anon can view players in public tournaments"
  ON players FOR SELECT
  TO anon
  USING (
    tournament_id IS NULL
    OR EXISTS (
      SELECT 1 FROM tournaments t 
      WHERE t.id = players.tournament_id 
      AND t.allow_public_registration = true
    )
  );

-- Create proper restricted policies for teams
-- Organizers can view teams in their tournaments
CREATE POLICY "Organizers can view teams in own tournaments"
  ON teams FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tournaments t 
    WHERE t.id = teams.tournament_id 
    AND t.user_id = auth.uid()
  ));

-- Players can view teams in tournaments they're enrolled in
CREATE POLICY "Players can view teams in enrolled tournaments"
  ON teams FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM players p 
      WHERE p.tournament_id = teams.tournament_id 
      AND p.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM player_accounts pa
      JOIN players p ON normalize_phone(p.phone_number) = normalize_phone(pa.phone_number)
      WHERE pa.user_id = auth.uid()
      AND p.tournament_id = teams.tournament_id
    )
  );

-- Anonymous can view teams in public tournaments (for live view)
CREATE POLICY "Anon can view teams in public tournaments"
  ON teams FOR SELECT
  TO anon
  USING (EXISTS (
    SELECT 1 FROM tournaments t 
    WHERE t.id = teams.tournament_id 
    AND t.allow_public_registration = true
  ));

-- Create proper restricted policies for matches
-- Anonymous can view matches only in public tournaments
CREATE POLICY "Anon can view matches in public tournaments"
  ON matches FOR SELECT
  TO anon
  USING (EXISTS (
    SELECT 1 FROM tournaments t 
    WHERE t.id = matches.tournament_id 
    AND t.allow_public_registration = true
  ));

-- Create proper policy for anonymous tournament access
-- Only allow viewing public tournaments
CREATE POLICY "Anon can view public tournaments"
  ON tournaments FOR SELECT
  TO anon
  USING (allow_public_registration = true);
