/*
  # Remove Public Access Policies
  
  ## Problem
  Old public policies are still active, allowing anyone to view/edit all tournaments
  
  ## Changes
  1. Drop all old public access policies from tournaments table
  2. Drop all old public access policies from related tables
  3. Ensure only authenticated user policies remain
  
  ## Security
  - After this migration, only authenticated users can access their own data
  - No public access to any tournament data
*/

-- Remove old public policies from tournaments
DROP POLICY IF EXISTS "Anyone can view tournaments" ON tournaments;
DROP POLICY IF EXISTS "Authenticated users can create tournaments" ON tournaments;
DROP POLICY IF EXISTS "Authenticated users can update tournaments" ON tournaments;
DROP POLICY IF EXISTS "Authenticated users can delete tournaments" ON tournaments;
DROP POLICY IF EXISTS "Public can insert tournaments" ON tournaments;
DROP POLICY IF EXISTS "Public can update tournaments" ON tournaments;
DROP POLICY IF EXISTS "Public can delete tournaments" ON tournaments;
DROP POLICY IF EXISTS "Public tournaments are viewable by everyone" ON tournaments;

-- Remove old public policies from teams
DROP POLICY IF EXISTS "Anyone can view teams" ON teams;
DROP POLICY IF EXISTS "Authenticated users can create teams" ON teams;
DROP POLICY IF EXISTS "Authenticated users can update teams" ON teams;
DROP POLICY IF EXISTS "Authenticated users can delete teams" ON teams;
DROP POLICY IF EXISTS "Public can view teams" ON teams;
DROP POLICY IF EXISTS "Public can insert teams" ON teams;
DROP POLICY IF EXISTS "Public can update teams" ON teams;
DROP POLICY IF EXISTS "Public can delete teams" ON teams;

-- Remove old public policies from matches
DROP POLICY IF EXISTS "Anyone can view matches" ON matches;
DROP POLICY IF EXISTS "Authenticated users can create matches" ON matches;
DROP POLICY IF EXISTS "Authenticated users can update matches" ON matches;
DROP POLICY IF EXISTS "Authenticated users can delete matches" ON matches;
DROP POLICY IF EXISTS "Public can view matches" ON matches;
DROP POLICY IF EXISTS "Public can insert matches" ON matches;
DROP POLICY IF EXISTS "Public can update matches" ON matches;
DROP POLICY IF EXISTS "Public can delete matches" ON matches;

-- Remove old public policies from players
DROP POLICY IF EXISTS "Anyone can view players" ON players;
DROP POLICY IF EXISTS "Public can view players" ON players;
DROP POLICY IF EXISTS "Public can insert players" ON players;
DROP POLICY IF EXISTS "Public can update players" ON players;
DROP POLICY IF EXISTS "Public can delete players" ON players;

-- Remove old public policies from tournament_categories
DROP POLICY IF EXISTS "Anyone can view tournament_categories" ON tournament_categories;
DROP POLICY IF EXISTS "Public can view tournament_categories" ON tournament_categories;
DROP POLICY IF EXISTS "Public can insert tournament_categories" ON tournament_categories;
DROP POLICY IF EXISTS "Public can update tournament_categories" ON tournament_categories;
DROP POLICY IF EXISTS "Public can delete tournament_categories" ON tournament_categories;
