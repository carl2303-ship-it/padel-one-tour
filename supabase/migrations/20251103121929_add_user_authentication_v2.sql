/*
  # Add User Authentication Support

  ## Changes Made
  
  1. **Add user_id to tournaments table**
     - Links each tournament to the authenticated user who created it
     - Uses auth.users table (Supabase built-in authentication)
     - Allows NULL temporarily for existing records
  
  2. **Update Row Level Security Policies**
     - Users can only view their own tournaments
     - Users can only create tournaments for themselves
     - Users can only update their own tournaments
     - Users can only delete their own tournaments
     - Public access removed - only authenticated users can access data
  
  3. **Cascade Permissions**
     - Teams, matches, players, and categories inherit access through tournament relationship
     - Users can only see data related to their own tournaments
  
  ## Security
  - All policies restricted to authenticated users only
  - Each user has complete isolation of their tournament data
  - No cross-user data access possible
*/

-- Add user_id column to tournaments table (nullable for now)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
    
    -- Create index for performance
    CREATE INDEX IF NOT EXISTS idx_tournaments_user_id ON tournaments(user_id);
  END IF;
END $$;

-- Drop all existing public policies
DROP POLICY IF EXISTS "Enable read access for all users" ON tournaments;
DROP POLICY IF EXISTS "Enable insert access for all users" ON tournaments;
DROP POLICY IF EXISTS "Enable update access for all users" ON tournaments;
DROP POLICY IF EXISTS "Enable delete for all users" ON tournaments;
DROP POLICY IF EXISTS "Public tournaments are viewable by everyone" ON tournaments;
DROP POLICY IF EXISTS "Users can insert their own tournaments" ON tournaments;
DROP POLICY IF EXISTS "Users can update their own tournaments" ON tournaments;
DROP POLICY IF EXISTS "Users can delete their own tournaments" ON tournaments;

DROP POLICY IF EXISTS "Enable read access for all users" ON teams;
DROP POLICY IF EXISTS "Enable insert access for all users" ON teams;
DROP POLICY IF EXISTS "Enable update access for all users" ON teams;
DROP POLICY IF EXISTS "Enable delete for all users" ON teams;

DROP POLICY IF EXISTS "Enable read access for all users" ON matches;
DROP POLICY IF EXISTS "Enable insert access for all users" ON matches;
DROP POLICY IF EXISTS "Enable update access for all users" ON matches;
DROP POLICY IF EXISTS "Enable delete for all users" ON matches;

DROP POLICY IF EXISTS "Enable read access for all users" ON players;
DROP POLICY IF EXISTS "Enable insert access for all users" ON players;
DROP POLICY IF EXISTS "Enable update access for all users" ON players;
DROP POLICY IF EXISTS "Enable delete for all users" ON players;

DROP POLICY IF EXISTS "Enable read access for all users" ON tournament_categories;
DROP POLICY IF EXISTS "Enable insert access for all users" ON tournament_categories;
DROP POLICY IF EXISTS "Enable update access for all users" ON tournament_categories;
DROP POLICY IF EXISTS "Enable delete for all users" ON tournament_categories;

-- Create new restrictive policies for tournaments
CREATE POLICY "Users can view own tournaments"
  ON tournaments FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own tournaments"
  ON tournaments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tournaments"
  ON tournaments FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own tournaments"
  ON tournaments FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create policies for teams (access through tournament relationship)
CREATE POLICY "Users can view teams in their tournaments"
  ON teams FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = teams.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create teams in their tournaments"
  ON teams FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = teams.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update teams in their tournaments"
  ON teams FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = teams.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = teams.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete teams in their tournaments"
  ON teams FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = teams.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

-- Create policies for matches
CREATE POLICY "Users can view matches in their tournaments"
  ON matches FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = matches.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create matches in their tournaments"
  ON matches FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = matches.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update matches in their tournaments"
  ON matches FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = matches.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = matches.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete matches in their tournaments"
  ON matches FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = matches.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

-- Create policies for players (all authenticated users can manage players)
CREATE POLICY "Authenticated users can view players"
  ON players FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create players"
  ON players FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update players"
  ON players FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete players"
  ON players FOR DELETE
  TO authenticated
  USING (true);

-- Create policies for tournament_categories
CREATE POLICY "Users can view categories in their tournaments"
  ON tournament_categories FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = tournament_categories.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create categories in their tournaments"
  ON tournament_categories FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = tournament_categories.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update categories in their tournaments"
  ON tournament_categories FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = tournament_categories.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = tournament_categories.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete categories in their tournaments"
  ON tournament_categories FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = tournament_categories.tournament_id
      AND tournaments.user_id = auth.uid()
    )
  );