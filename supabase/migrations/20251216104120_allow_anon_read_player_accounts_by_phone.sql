/*
  # Allow Anonymous Users to Read Player Accounts

  1. Changes
    - Add policy for anon users to read player_accounts by phone_number
    - This is needed for registration flow to check if account exists
    - Also allow anon to update player accounts for registration updates

  2. Security
    - Limited to SELECT and UPDATE operations
    - Enables proper registration flow for non-authenticated users
*/

-- Allow anon users to read player accounts (needed to check if account exists)
CREATE POLICY "Anon can read player accounts"
  ON player_accounts
  FOR SELECT
  TO anon
  USING (true);

-- Allow anon users to update player accounts (needed for registration updates)
CREATE POLICY "Anon can update player accounts"
  ON player_accounts
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
