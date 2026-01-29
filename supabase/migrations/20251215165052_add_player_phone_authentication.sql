/*
  # Add Player Phone-Based Authentication System

  1. New Tables
    - `player_accounts`
      - Maps phone numbers to auth user accounts
      - `id` (uuid, primary key)
      - `phone_number` (text, unique, required) - Player's phone number
      - `user_id` (uuid, references auth.users) - Associated auth account
      - `name` (text) - Player's name
      - `email` (text) - Player's email (optional)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Changes
    - Make phone_number more prominent in player identification
    - Players are now uniquely identified by phone number across all tournaments

  3. Security
    - Enable RLS on `player_accounts` table
    - Players can view and update their own account
    - Authenticated users can view player accounts (for tournament registration)
*/

-- Create player_accounts table
CREATE TABLE IF NOT EXISTS player_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text UNIQUE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  email text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE player_accounts ENABLE ROW LEVEL SECURITY;

-- Policies for player_accounts
CREATE POLICY "Players can view own account"
  ON player_accounts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Players can update own account"
  ON player_accounts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Anyone can create player account"
  ON player_accounts FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can view all player accounts"
  ON player_accounts FOR SELECT
  TO authenticated
  USING (true);

-- Create index for faster phone lookup
CREATE INDEX IF NOT EXISTS idx_player_accounts_phone ON player_accounts(phone_number);
CREATE INDEX IF NOT EXISTS idx_player_accounts_user_id ON player_accounts(user_id);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_player_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER player_accounts_updated_at
  BEFORE UPDATE ON player_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_player_accounts_updated_at();
