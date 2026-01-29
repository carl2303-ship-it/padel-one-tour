/*
  # Fix Phone Number Normalization in Player Account Trigger

  1. Changes
    - Update trigger to normalize phone numbers before insert/update
    - Removes spaces, dashes, parentheses from phone numbers
    - This prevents duplicate accounts for the same phone number with different formatting

  2. Security
    - Function runs with SECURITY DEFINER
    - Proper search_path set
*/

-- Create helper function to normalize phone numbers
CREATE OR REPLACE FUNCTION normalize_phone_number(phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF phone IS NULL THEN
    RETURN NULL;
  END IF;
  -- Remove spaces, dashes, parentheses, dots
  RETURN regexp_replace(phone, '[\s\-\(\)\.]', '', 'g');
END;
$$;

-- Update the trigger function to normalize phone numbers
CREATE OR REPLACE FUNCTION create_player_account_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  normalized_phone TEXT;
BEGIN
  -- Only create player_account if user_id and phone_number exist
  IF NEW.user_id IS NOT NULL AND NEW.phone_number IS NOT NULL AND NEW.phone_number != '' THEN
    -- Normalize the phone number
    normalized_phone := normalize_phone_number(NEW.phone_number);
    
    -- Insert or update player_account with normalized phone
    INSERT INTO player_accounts (phone_number, user_id, name, email)
    VALUES (normalized_phone, NEW.user_id, NEW.name, NEW.email)
    ON CONFLICT (phone_number) DO UPDATE SET
      user_id = COALESCE(player_accounts.user_id, EXCLUDED.user_id),
      name = COALESCE(EXCLUDED.name, player_accounts.name),
      email = CASE 
        WHEN EXCLUDED.email IS NOT NULL AND EXCLUDED.email != '' 
        THEN EXCLUDED.email 
        ELSE player_accounts.email 
      END,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

-- Also normalize the phone_number in the players table when inserting
CREATE OR REPLACE FUNCTION normalize_player_phone_on_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.phone_number IS NOT NULL THEN
    NEW.phone_number := normalize_phone_number(NEW.phone_number);
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger to normalize phone before insert (if not exists)
DROP TRIGGER IF EXISTS normalize_player_phone_trigger ON players;
CREATE TRIGGER normalize_player_phone_trigger
  BEFORE INSERT OR UPDATE ON players
  FOR EACH ROW
  EXECUTE FUNCTION normalize_player_phone_on_insert();
