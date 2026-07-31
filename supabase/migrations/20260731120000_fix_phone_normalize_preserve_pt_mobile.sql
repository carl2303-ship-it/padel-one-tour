/*
  Fix normalize_portuguese_phone: never strip 91/92 from bare PT 9-digit mobiles.
  Storage = national digits only (no +, no country code).
  Bug: "+925358087" → strip + → "925358087" matched India/Pakistan 91/92 → "5358087".
*/

CREATE OR REPLACE FUNCTION normalize_portuguese_phone(phone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cleaned text;
  digits text;
BEGIN
  IF phone IS NULL OR phone = '' THEN
    RETURN phone;
  END IF;

  cleaned := REGEXP_REPLACE(phone, '[\s\-\(\)\.]', '', 'g');

  IF cleaned LIKE '+00%' THEN
    cleaned := SUBSTRING(cleaned FROM 4);
  ELSIF cleaned LIKE '+%' THEN
    cleaned := SUBSTRING(cleaned FROM 2);
  ELSIF cleaned LIKE '00%' THEN
    cleaned := SUBSTRING(cleaned FROM 3);
  END IF;

  digits := REGEXP_REPLACE(cleaned, '[^0-9]', '', 'g');

  -- Bare PT / ES national mobiles — keep as-is (fixes "+925358087" after removing +)
  IF digits ~ '^9[1236][0-9]{7}$' THEN
    RETURN digits;
  END IF;
  IF digits ~ '^[67][0-9]{8}$' THEN
    RETURN digits;
  END IF;

  -- Explicit PT / ES with country code
  IF digits ~ '^3519[0-9]{8}$' THEN
    RETURN SUBSTRING(digits FROM 4);
  END IF;
  IF digits ~ '^34[67][0-9]{8}$' THEN
    RETURN SUBSTRING(digits FROM 3);
  END IF;

  -- Only strip country codes on longer international numbers
  IF LENGTH(digits) >= 11 THEN
    IF digits ~ '^(351|352|353|354|355|356|357|358|359|370|371|372|373|374|375|376|377|378|380|381|382|383|385|386|387|389|420|421|423|212|213|216|244|245|258|297|298|299|852|853|855|856|880|886|960|961|962|963|964|965|966|967|968|971|972|973|974|975|976|977|992|993|994|995|996|998)[0-9]{6,}$' THEN
      digits := REGEXP_REPLACE(digits, '^(351|352|353|354|355|356|357|358|359|370|371|372|373|374|375|376|377|378|380|381|382|383|385|386|387|389|420|421|423|212|213|216|244|245|258|297|298|299|852|853|855|856|880|886|960|961|962|963|964|965|966|967|968|971|972|973|974|975|976|977|992|993|994|995|996|998)', '');
    ELSIF digits ~ '^(20|27|30|31|32|33|34|36|39|40|41|43|44|45|46|47|48|49|51|52|53|54|55|56|57|58|60|61|62|63|64|65|66|81|82|84|86|90|91|92|93|94|95|98)[0-9]{6,}$' THEN
      digits := REGEXP_REPLACE(digits, '^(20|27|30|31|32|33|34|36|39|40|41|43|44|45|46|47|48|49|51|52|53|54|55|56|57|58|60|61|62|63|64|65|66|81|82|84|86|90|91|92|93|94|95|98)', '');
    ELSIF digits ~ '^[17][0-9]{9,}$' THEN
      digits := SUBSTRING(digits FROM 2);
    END IF;
  ELSIF digits ~ '^351[29][0-9]{8}$' THEN
    digits := SUBSTRING(digits FROM 4);
  END IF;

  IF digits LIKE '0%' AND LENGTH(digits) > 6 THEN
    digits := SUBSTRING(digits FROM 2);
  END IF;

  RETURN digits;
END;
$$;

CREATE OR REPLACE FUNCTION normalize_phone_number(phone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result text;
BEGIN
  IF phone IS NULL THEN RETURN NULL; END IF;
  SELECT normalize_portuguese_phone(phone) INTO result;
  RETURN result;
END;
$$;
