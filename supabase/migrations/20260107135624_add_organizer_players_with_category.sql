/*
  # Add organizer players table with category support

  1. New Tables
    - `organizer_players`
      - `id` (uuid, primary key)
      - `organizer_id` (uuid, references auth.users) - the organizer who owns this player record
      - `name` (text) - normalized player name
      - `email` (text, nullable) - player email
      - `phone_number` (text, nullable) - player phone
      - `player_category` (text, nullable) - skill category (M6-M1, F6-F1)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS
    - Organizers can only see and manage their own players

  3. Notes
    - This table stores unique players per organizer for contact management
    - Categories represent skill levels: M = Male, F = Female, 6 = beginner, 1 = advanced
*/

CREATE TABLE IF NOT EXISTS organizer_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone_number text,
  player_category text CHECK (player_category IS NULL OR player_category IN ('M6', 'M5', 'M4', 'M3', 'M2', 'M1', 'F6', 'F5', 'F4', 'F3', 'F2', 'F1')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(organizer_id, name)
);

ALTER TABLE organizer_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Organizers can view own players"
  ON organizer_players FOR SELECT
  TO authenticated
  USING (auth.uid() = organizer_id);

CREATE POLICY "Organizers can insert own players"
  ON organizer_players FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = organizer_id);

CREATE POLICY "Organizers can update own players"
  ON organizer_players FOR UPDATE
  TO authenticated
  USING (auth.uid() = organizer_id)
  WITH CHECK (auth.uid() = organizer_id);

CREATE POLICY "Organizers can delete own players"
  ON organizer_players FOR DELETE
  TO authenticated
  USING (auth.uid() = organizer_id);

CREATE INDEX idx_organizer_players_organizer ON organizer_players(organizer_id);
CREATE INDEX idx_organizer_players_name ON organizer_players(organizer_id, lower(name));
