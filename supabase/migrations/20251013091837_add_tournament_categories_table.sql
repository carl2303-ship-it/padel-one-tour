/*
  # Add Tournament Categories Support

  1. New Tables
    - `tournament_categories`
      - `id` (uuid, primary key)
      - `tournament_id` (uuid, foreign key to tournaments)
      - `name` (text) - Category name (e.g., "M1", "F1", "M2")
      - `format` (text) - Format for this category (single_elimination, groups_knockout)
      - `number_of_groups` (integer) - Number of groups if format is groups_knockout
      - `max_teams` (integer) - Maximum teams allowed in this category
      - `created_at` (timestamptz)

  2. Changes
    - Add `category_id` column to teams table to link teams to specific categories
    - Add `category_id` column to matches table to link matches to specific categories

  3. Security
    - Enable RLS on tournament_categories table
    - Add policies for public read access
    - Add policies for authenticated users to manage categories
*/

-- Create tournament_categories table
CREATE TABLE IF NOT EXISTS tournament_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name text NOT NULL,
  format text NOT NULL CHECK (format IN ('single_elimination', 'groups_knockout')),
  number_of_groups integer DEFAULT 0,
  max_teams integer DEFAULT 16,
  created_at timestamptz DEFAULT now()
);

-- Add category_id to teams table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'teams' AND column_name = 'category_id'
  ) THEN
    ALTER TABLE teams ADD COLUMN category_id uuid REFERENCES tournament_categories(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add category_id to matches table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'matches' AND column_name = 'category_id'
  ) THEN
    ALTER TABLE matches ADD COLUMN category_id uuid REFERENCES tournament_categories(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE tournament_categories ENABLE ROW LEVEL SECURITY;

-- Public read access to tournament categories
CREATE POLICY "Public can view tournament categories"
  ON tournament_categories
  FOR SELECT
  TO public
  USING (true);

-- Authenticated users can insert tournament categories
CREATE POLICY "Authenticated users can create tournament categories"
  ON tournament_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated users can update tournament categories
CREATE POLICY "Authenticated users can update tournament categories"
  ON tournament_categories
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Authenticated users can delete tournament categories
CREATE POLICY "Authenticated users can delete tournament categories"
  ON tournament_categories
  FOR DELETE
  TO authenticated
  USING (true);
