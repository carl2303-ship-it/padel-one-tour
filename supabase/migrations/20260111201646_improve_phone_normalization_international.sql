/*
  # Improve Phone Normalization for International Numbers

  1. Updates
    - Enhanced `normalize_portuguese_phone` function to handle international formats
    - Converts 00XX... to +XX... (common international dialing format)
    - Adds + prefix to numbers that start with valid country codes
    - Preserves existing international numbers with +

  2. Supported Formats
    - Portuguese: 9XXXXXXXX, +9XXXXXXXX, 351XXXXXXXXX, +351XXXXXXXXX, 00351XXXXXXXXX
    - International: +XXXXXXXXXXXX, 00XXXXXXXXXXXX
*/

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
  
  -- If it starts with 00, convert to +
  IF cleaned LIKE '00%' THEN
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
  -- This covers most European and common international codes
  -- Format: country code (1-3 digits) + number (typically 8-12 digits)
  IF cleaned ~ '^[1-9][0-9]{9,14}$' THEN
    -- Check for common country codes at the start
    -- 1: USA/Canada, 27: South Africa, 31: Netherlands, 32: Belgium, 33: France
    -- 34: Spain, 39: Italy, 41: Switzerland, 44: UK, 46: Sweden, 49: Germany
    -- 351: Portugal, 352: Luxembourg, 353: Ireland, 354: Iceland, 355: Albania
    IF cleaned ~ '^(1|27|31|32|33|34|39|41|44|45|46|47|48|49|351|352|353|354|355|356|357|358|359|36|370|371|372|373|374|375|376|377|378|380|381|382|383|385|386|387|389|420|421|423|43|852|853|86|81|82|84|91|92|93|94|95|960|961|962|963|964|965|966|967|968|971|972|973|974|975|976|977|98)[0-9]+$' THEN
      RETURN '+' || cleaned;
    END IF;
  END IF;
  
  -- Return as-is if no pattern matches
  RETURN cleaned;
END;
$$;
