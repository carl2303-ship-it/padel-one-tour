/*
  # EMERGENCY FIX: Remove NOT NULL constraint on players.user_id
  
  ## Problem
  Migration 20251112123950_add_user_id_to_players_and_fix_rls_v2.sql was re-applied:
    1. DELETE FROM players WHERE user_id IS NULL → Deleted ALL individual tournament players
    2. ALTER TABLE players ALTER COLUMN user_id SET NOT NULL → Blocks new registrations
  
  ## Fix
  1. Drop the NOT NULL constraint on players.user_id
  2. Drop the DEFAULT auth.uid() — individual players should explicitly set user_id or leave NULL
  3. Ensure correct RLS policies exist for INSERT
  4. Clean up redundant policies added by the re-applied migration
  
  ## Recovery
  Player data needs to be restored from Supabase backups (Dashboard > Project Settings > Backups)
*/

-- Step 1: Remove NOT NULL constraint
ALTER TABLE players ALTER COLUMN user_id DROP NOT NULL;

-- Step 2: Remove the DEFAULT auth.uid()
ALTER TABLE players ALTER COLUMN user_id DROP DEFAULT;

-- Step 3: Clean up redundant policies that might have been re-created by the old migration
DROP POLICY IF EXISTS "Users can view own players" ON players;
DROP POLICY IF EXISTS "Users can create own players" ON players;
DROP POLICY IF EXISTS "Users can update own players" ON players;
DROP POLICY IF EXISTS "Users can delete own players" ON players;

-- Step 4: Ensure the correct INSERT policies exist (from the latest working state)
-- These use SECURITY DEFINER functions to avoid RLS recursion

-- Ensure helper functions exist
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

-- Recreate INSERT policies (drop first to avoid duplicates)
DROP POLICY IF EXISTS "Anon can insert players for public tournaments" ON players;
DROP POLICY IF EXISTS "Auth can insert players" ON players;

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
    OR (
      tournament_allows_public_registration(tournament_id) = true
      AND (user_id IS NULL OR user_id = auth.uid())
    )
  );

-- Step 5: Ensure SELECT policy exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'players' AND policyname = 'Anyone can view players'
  ) THEN
    CREATE POLICY "Anyone can view players" ON players FOR SELECT USING (true);
  END IF;
END $$;

-- Step 6: Ensure UPDATE/DELETE policies exist for tournament owners
DROP POLICY IF EXISTS "Users can update players for their tournaments" ON players;
CREATE POLICY "Users can update players for their tournaments"
  ON players FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR tournament_owned_by_user(tournament_id, auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR tournament_owned_by_user(tournament_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete players for their tournaments" ON players;
CREATE POLICY "Users can delete players for their tournaments"
  ON players FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR tournament_owned_by_user(tournament_id, auth.uid())
  );
