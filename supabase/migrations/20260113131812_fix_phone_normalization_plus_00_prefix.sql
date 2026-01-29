/*
  # Fix Phone Normalization for +00 Prefix
  
  1. Updates
    - Enhanced `normalize_portuguese_phone` function to handle +00 prefix correctly
    - Removes the + before checking for 00 prefix
  
  2. Data Cleanup
    - Removes duplicate player_accounts with +00351 prefix
    - Keeps the correct +351 version
*/

-- Update the normalization function to handle +00 prefix
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
  
  -- Remove spaces, dashes, and parentheses
  cleaned := REGEXP_REPLACE(phone, '[\s\-\(\)]', '', 'g');
  
  -- Handle +00 prefix (convert +00351 to +351)
  IF cleaned LIKE '+00%' THEN
    cleaned := '+' || SUBSTRING(cleaned FROM 4);
  -- Handle 00 prefix (convert 00351 to +351)
  ELSIF cleaned LIKE '00%' THEN
    cleaned := '+' || SUBSTRING(cleaned FROM 3);
  END IF;
  
  -- PORTUGUESE NUMBERS
  -- If it's a Portuguese number without country code (starts with 9 and has 9 digits)
  IF cleaned ~ '^9[0-9]{8}$' THEN
    RETURN '+351' || cleaned;
  END IF;
  
  -- If it starts with + followed by 9 digits (Portuguese without 351)
  IF cleaned ~ '^\+9[0-9]{8}$' THEN
    RETURN '+351' || SUBSTRING(cleaned FROM 2);
  END IF;
  
  -- If it starts with 351 without + (Portuguese)
  IF cleaned ~ '^3519[0-9]{8}$' THEN
    RETURN '+' || cleaned;
  END IF;
  
  -- INTERNATIONAL NUMBERS
  -- If it already starts with +, return as-is (already normalized)
  IF cleaned LIKE '+%' THEN
    RETURN cleaned;
  END IF;
  
  -- Common country codes without + (add + if it looks like a valid international number)
  IF cleaned ~ '^[1-9][0-9]{9,14}$' THEN
    IF cleaned ~ '^(1|27|31|32|33|34|39|41|44|45|46|47|48|49|351|352|353|354|355|356|357|358|359|36|370|371|372|373|374|375|376|377|378|380|381|382|383|385|386|387|389|420|421|423|43|852|853|86|81|82|84|91|92|93|94|95|960|961|962|963|964|965|966|967|968|971|972|973|974|975|976|977|98)[0-9]+$' THEN
      RETURN '+' || cleaned;
    END IF;
  END IF;
  
  -- Return as-is if no pattern matches
  RETURN cleaned;
END;
$$;

-- Remove duplicate player_accounts with +00 prefix
DELETE FROM player_accounts 
WHERE phone_number LIKE '+00%' 
AND EXISTS (
  SELECT 1 FROM player_accounts pa2 
  WHERE pa2.user_id = player_accounts.user_id 
  AND pa2.phone_number = normalize_portuguese_phone(player_accounts.phone_number)
  AND pa2.id != player_accounts.id
);