/*
  # Create trigger to auto-create player accounts

  1. Changes
    - Add trigger function to automatically create player_accounts when a player is inserted with user_id
    - Ensures players can see their tournaments in the dashboard immediately after registration

  2. Security
    - Function runs with SECURITY DEFINER to bypass RLS
    - Only creates player_accounts for players with both user_id and phone_number
*/

-- Function to create player_account automatically
CREATE OR REPLACE FUNCTION create_player_account_on_insert()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only create player_account if user_id and phone_number exist
  IF NEW.user_id IS NOT NULL AND NEW.phone_number IS NOT NULL AND NEW.phone_number != '' THEN
    -- Insert or update player_account
    INSERT INTO player_accounts (phone_number, user_id, name, email)
    VALUES (NEW.phone_number, NEW.user_id, NEW.name, NEW.email)
    ON CONFLICT (phone_number) DO UPDATE SET
      user_id = COALESCE(EXCLUDED.user_id, player_accounts.user_id),
      name = COALESCE(EXCLUDED.name, player_accounts.name),
      email = COALESCE(EXCLUDED.email, player_accounts.email),
      updated_at = now();
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS trigger_create_player_account ON players;

-- Create trigger
CREATE TRIGGER trigger_create_player_account
  AFTER INSERT ON players
  FOR EACH ROW
  EXECUTE FUNCTION create_player_account_on_insert();
