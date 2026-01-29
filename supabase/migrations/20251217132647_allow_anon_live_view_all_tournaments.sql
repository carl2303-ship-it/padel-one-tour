/*
  # Allow Anonymous Access for Live Tournament View

  1. Changes
    - Add RLS policies to allow anonymous users to view tournament data
    - This enables the public Live view page to work for all tournaments
    - Policies are READ-ONLY for safety

  2. Security
    - Only SELECT operations are allowed
    - No write access is granted to anonymous users
*/

-- Allow anonymous users to view all matches (for Live view)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'matches' 
    AND policyname = 'Anonymous users can view all matches for live view'
  ) THEN
    CREATE POLICY "Anonymous users can view all matches for live view"
      ON matches
      FOR SELECT
      TO anon
      USING (true);
  END IF;
END $$;

-- Allow anonymous users to view all teams (for Live view)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'teams' 
    AND policyname = 'Anonymous users can view all teams for live view'
  ) THEN
    CREATE POLICY "Anonymous users can view all teams for live view"
      ON teams
      FOR SELECT
      TO anon
      USING (true);
  END IF;
END $$;

-- Allow anonymous users to view all players (for Live view)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'players' 
    AND policyname = 'Anonymous users can view all players for live view'
  ) THEN
    CREATE POLICY "Anonymous users can view all players for live view"
      ON players
      FOR SELECT
      TO anon
      USING (true);
  END IF;
END $$;
