/*
  # Add Phone Number Normalization Function and Triggers

  1. New Functions
    - `normalize_portuguese_phone(phone_number text)` - Normalizes Portuguese phone numbers to +351XXXXXXXXX format
    - Handles formats: 9XXXXXXXX, +9XXXXXXXX, +351XXXXXXXXX, 351XXXXXXXXX

  2. New Triggers
    - Auto-normalize phone numbers on INSERT/UPDATE for players table
    - Auto-normalize phone numbers on INSERT/UPDATE for player_accounts table

  3. Purpose
    - Ensures all Portuguese phone numbers are stored in consistent format
    - Allows matching phone numbers regardless of how user enters them
*/

-- Function to normalize Portuguese phone numbers
CREATE OR REPLACE FUNCTION normalize_portuguese_phone(phone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cleaned text;
BEGIN
  IF phone IS NULL OR phone = '' THEN
    RETURN phone;
  END IF;
  
  -- Remove spaces and dashes
  cleaned := REGEXP_REPLACE(phone, '[\s\-]', '', 'g');
  
  -- If it's a Portuguese number without country code (starts with 9 and has 9 digits)
  IF cleaned ~ '^9[0-9]{8}$' THEN
    RETURN '+351' || cleaned;
  END IF;
  
  -- If it starts with + followed by 9 digits (Portuguese without 351)
  IF cleaned ~ '^\+9[0-9]{8}$' THEN
    RETURN '+351' || SUBSTRING(cleaned FROM 2);
  END IF;
  
  -- If it starts with 351 without + (and has 12 digits total)
  IF cleaned ~ '^3519[0-9]{8}$' THEN
    RETURN '+' || cleaned;
  END IF;
  
  -- If it starts with 00351 (international format)
  IF cleaned ~ '^003519[0-9]{8}$' THEN
    RETURN '+' || SUBSTRING(cleaned FROM 3);
  END IF;
  
  -- Return as-is if it doesn't match Portuguese patterns
  RETURN cleaned;
END;
$$;

-- Trigger function to normalize phone on players table
CREATE OR REPLACE FUNCTION normalize_player_phone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.phone_number := normalize_portuguese_phone(NEW.phone_number);
  RETURN NEW;
END;
$$;

-- Trigger function to normalize phone on player_accounts table
CREATE OR REPLACE FUNCTION normalize_player_account_phone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.phone_number := normalize_portuguese_phone(NEW.phone_number);
  RETURN NEW;
END;
$$;

-- Create trigger on players table
DROP TRIGGER IF EXISTS normalize_player_phone_trigger ON players;
CREATE TRIGGER normalize_player_phone_trigger
  BEFORE INSERT OR UPDATE OF phone_number ON players
  FOR EACH ROW
  EXECUTE FUNCTION normalize_player_phone();

-- Create trigger on player_accounts table  
DROP TRIGGER IF EXISTS normalize_player_account_phone_trigger ON player_accounts;
CREATE TRIGGER normalize_player_account_phone_trigger
  BEFORE INSERT OR UPDATE OF phone_number ON player_accounts
  FOR EACH ROW
  EXECUTE FUNCTION normalize_player_account_phone();
