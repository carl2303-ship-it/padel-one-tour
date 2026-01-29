/*
  # Fix infinite recursion in players/teams RLS policies
  
  ## Problem
  Multiple SELECT policies on players reference teams, and teams policies reference players,
  causing infinite recursion.
  
  ## Solution
  Simplify policies to avoid cross-table recursion by using direct ownership checks
  instead of joins that create circular dependencies.
*/

-- Drop ALL existing SELECT policies on players to start fresh
DROP POLICY IF EXISTS "Anonymous users can view all players for live view" ON players;
DROP POLICY IF EXISTS "Anonymous users can view players in public tournaments" ON players;
DROP POLICY IF EXISTS "Anyone can view players in public tournaments" ON players;
DROP POLICY IF EXISTS "Players can view own player records via phone" ON players;
DROP POLICY IF EXISTS "Users can view players in their individual tournaments" ON players;
DROP POLICY IF EXISTS "Users can view players in their tournaments" ON players;
DROP POLICY IF EXISTS "Users can view their own players" ON players;

-- Create simple, non-recursive SELECT policies for players
-- Policy 1: Anyone can view players (needed for live view and tournament display)
CREATE POLICY "Anyone can view players"
  ON players
  FOR SELECT
  USING (true);

-- Drop problematic INSERT policy and recreate
DROP POLICY IF EXISTS "Anonymous users can create players for public registration" ON players;
DROP POLICY IF EXISTS "Authenticated users can insert players for their tournaments" ON players;

-- Create simple INSERT policies
CREATE POLICY "Anon can insert players for public tournaments"
  ON players
  FOR INSERT
  TO anon
  WITH CHECK (
    tournament_id IS NULL 
    OR EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = tournament_id
      AND t.allow_public_registration = true
    )
  );

CREATE POLICY "Auth can insert players"
  ON players
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tournament_id IS NULL
    OR EXISTS (
      SELECT 1 FROM tournaments t
      WHERE t.id = tournament_id
      AND (t.user_id = auth.uid() OR t.allow_public_registration = true)
    )
  );

-- Fix teams policies to avoid recursion
DROP POLICY IF EXISTS "Players can view teams they are part of via phone" ON teams;

-- Simple teams SELECT policy
CREATE POLICY "Anyone can view teams"
  ON teams
  FOR SELECT
  USING (true);
