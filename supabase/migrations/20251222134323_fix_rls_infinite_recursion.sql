/*
  # Fix RLS Infinite Recursion

  The previous migration created policies that caused infinite recursion when
  querying players table. This fixes the issue by:

  1. Dropping the problematic policies
  2. Creating simpler, non-recursive policies
  3. Using SECURITY DEFINER functions to safely check ownership

  ## Changes
  - Remove recursive policies on players and teams
  - Create safe helper functions
  - Restore proper access for organizers and live view
*/

-- Drop the problematic policies that cause recursion
DROP POLICY IF EXISTS "Players can view players in enrolled tournaments" ON players;
DROP POLICY IF EXISTS "Players can view teams in enrolled tournaments" ON teams;
DROP POLICY IF EXISTS "Organizers can view players in own tournaments" ON players;
DROP POLICY IF EXISTS "Organizers can view teams in own tournaments" ON teams;
DROP POLICY IF EXISTS "Anon can view players in public tournaments" ON players;
DROP POLICY IF EXISTS "Anon can view teams in public tournaments" ON teams;
DROP POLICY IF EXISTS "Organizers can manage own tournament categories" ON tournament_categories;

-- Create a helper function to check tournament ownership without recursion
CREATE OR REPLACE FUNCTION is_tournament_owner(p_tournament_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tournaments 
    WHERE id = p_tournament_id 
    AND user_id = auth.uid()
  );
$$;

-- Create a helper function to check if tournament is public
CREATE OR REPLACE FUNCTION is_tournament_public(p_tournament_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tournaments 
    WHERE id = p_tournament_id 
    AND allow_public_registration = true
  );
$$;

-- PLAYERS POLICIES
-- Organizers can view all players in their tournaments
CREATE POLICY "Organizers view own tournament players"
  ON players FOR SELECT
  TO authenticated
  USING (
    tournament_id IS NULL 
    OR is_tournament_owner(tournament_id)
  );

-- Anyone can view players in public tournaments (for live view)
CREATE POLICY "Anyone view public tournament players"
  ON players FOR SELECT
  TO public
  USING (
    tournament_id IS NULL 
    OR is_tournament_public(tournament_id)
  );

-- TEAMS POLICIES  
-- Organizers can view all teams in their tournaments
CREATE POLICY "Organizers view own tournament teams"
  ON teams FOR SELECT
  TO authenticated
  USING (is_tournament_owner(tournament_id));

-- Anyone can view teams in public tournaments (for live view)
CREATE POLICY "Anyone view public tournament teams"
  ON teams FOR SELECT
  TO public
  USING (is_tournament_public(tournament_id));

-- TOURNAMENT CATEGORIES POLICIES
-- Organizers can manage categories in their tournaments
CREATE POLICY "Organizers manage own categories"
  ON tournament_categories FOR ALL
  TO authenticated
  USING (is_tournament_owner(tournament_id))
  WITH CHECK (is_tournament_owner(tournament_id));

-- Anyone can view categories in public tournaments
CREATE POLICY "Anyone view public tournament categories"
  ON tournament_categories FOR SELECT
  TO public
  USING (is_tournament_public(tournament_id));
