/*
  # Fix Tournament Categories RLS Policies

  1. Changes
    - Drop existing restrictive policies
    - Add public access policies for tournament_categories table
    - Allow anyone to insert, update, and delete categories (matching other tables)

  2. Security
    - Enable public access to match the rest of the application
    - No authentication required
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Authenticated users can create tournament categories" ON tournament_categories;
DROP POLICY IF EXISTS "Authenticated users can update tournament categories" ON tournament_categories;
DROP POLICY IF EXISTS "Authenticated users can delete tournament categories" ON tournament_categories;

-- Public insert access
CREATE POLICY "Public can create tournament categories"
  ON tournament_categories
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Public update access
CREATE POLICY "Public can update tournament categories"
  ON tournament_categories
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

-- Public delete access
CREATE POLICY "Public can delete tournament categories"
  ON tournament_categories
  FOR DELETE
  TO public
  USING (true);
