/*
  # Fix Player Accounts RLS for Anonymous Registrations

  1. Changes
    - Drop existing restrictive policy for player account creation
    - Add new policy that explicitly allows anon users to create player accounts
    - This enables tournament registration for non-authenticated users

  2. Security
    - Policy allows both anon and authenticated users to create accounts
    - No restrictions on user_id to allow flexible account creation during registration
*/

-- Drop the existing policy that might be too restrictive
DROP POLICY IF EXISTS "Anyone can create player account" ON player_accounts;

-- Create a new, more explicit policy for inserting player accounts
CREATE POLICY "Allow anon and authenticated to create player accounts"
  ON player_accounts
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
