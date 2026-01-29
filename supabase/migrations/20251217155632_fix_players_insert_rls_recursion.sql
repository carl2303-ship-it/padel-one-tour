/*
  # Fix infinite recursion in players INSERT policies

  1. Problem
    - Players INSERT policies check tournaments with EXISTS
    - This can cause recursion when combined with tournament policies
    
  2. Solution
    - Create a security definer function to check tournament properties
    - This bypasses RLS and prevents recursion
    - Use this function in player INSERT policies
    
  3. Security
    - Function only checks specific tournament properties
    - Does not expose sensitive data
    - Maintains same access control logic
*/

-- Create helper function to check tournament properties (bypasses RLS)
CREATE OR REPLACE FUNCTION public.tournament_allows_public_registration(tournament_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT allow_public_registration
  FROM tournaments
  WHERE id = tournament_id;
$$;

-- Create helper function to check tournament ownership (bypasses RLS)
CREATE OR REPLACE FUNCTION public.tournament_owned_by_user(tournament_id uuid, user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tournaments
    WHERE id = tournament_id
    AND tournaments.user_id = tournament_owned_by_user.user_id
  );
$$;

-- Drop old INSERT policies
DROP POLICY IF EXISTS "Anon can insert players for public tournaments" ON players;
DROP POLICY IF EXISTS "Auth can insert players" ON players;

-- Create new INSERT policies using helper functions
CREATE POLICY "Anon can insert players for public tournaments"
  ON players
  FOR INSERT
  TO anon
  WITH CHECK (
    tournament_id IS NULL
    OR tournament_allows_public_registration(tournament_id) = true
  );

CREATE POLICY "Auth can insert players"
  ON players
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tournament_id IS NULL
    OR tournament_owned_by_user(tournament_id, auth.uid())
    OR tournament_allows_public_registration(tournament_id) = true
  );
