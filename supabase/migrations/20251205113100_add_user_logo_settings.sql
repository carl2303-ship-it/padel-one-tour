/*
  # Add User Logo Settings

  1. New Tables
    - `user_logo_settings`
      - `id` (uuid, primary key)
      - `user_id` (uuid, unique, foreign key to auth.users)
      - `logo_url` (text) - URL or path to the custom logo image
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `user_logo_settings` table
    - Add policy for authenticated users to manage their own logo settings
    - Add policy for public read access to logo settings (for displaying logos on public pages)
*/

CREATE TABLE IF NOT EXISTS user_logo_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logo_url text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_logo_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own logo settings"
  ON user_logo_settings
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own logo settings"
  ON user_logo_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own logo settings"
  ON user_logo_settings
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own logo settings"
  ON user_logo_settings
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Public can view logo settings"
  ON user_logo_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);