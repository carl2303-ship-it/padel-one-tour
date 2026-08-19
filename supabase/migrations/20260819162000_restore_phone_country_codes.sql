-- =============================================================================
-- PHONE INTERNATIONAL FORMAT FIX (run entire file in Supabase SQL editor)
-- Storage: +351..., +44..., +34...  |  Login matching: national digits
-- =============================================================================

-- 1) Remove restrictive CHECK constraints (if present)
ALTER TABLE public.player_accounts DROP CONSTRAINT IF EXISTS player_accounts_phone_number_format_check;
ALTER TABLE public.player_accounts DROP CONSTRAINT IF EXISTS player_accounts_phone_number_check;
ALTER TABLE public.players DROP CONSTRAINT IF EXISTS players_phone_number_format_check;
ALTER TABLE public.players DROP CONSTRAINT IF EXISTS players_phone_number_check;

-- 2) Core converter: any input -> E.164 (+CC...)
CREATE OR REPLACE FUNCTION public.to_e164_for_players(phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $to_e164$
DECLARE
  cleaned text;
  digits text;
BEGIN
  IF phone IS NULL OR btrim(phone) = '' THEN
    RETURN NULL;
  END IF;

  cleaned := regexp_replace(phone, '[\s\-\(\)\.]', '', 'g');

  IF cleaned LIKE '+%' THEN
    digits := regexp_replace(substring(cleaned from 2), '[^0-9]', '', 'g');
    IF digits = '' THEN RETURN NULL; END IF;
    RETURN '+' || digits;
  END IF;

  IF cleaned LIKE '00%' THEN
    digits := regexp_replace(substring(cleaned from 3), '[^0-9]', '', 'g');
    IF digits = '' THEN RETURN NULL; END IF;
    RETURN '+' || digits;
  END IF;

  digits := regexp_replace(cleaned, '[^0-9]', '', 'g');
  IF digits = '' THEN
    RETURN NULL;
  END IF;

  IF digits ~ '^9[1236][0-9]{7}$' THEN
    RETURN '+351' || digits;
  END IF;

  IF digits ~ '^[67][0-9]{8}$' THEN
    RETURN '+34' || digits;
  END IF;

  IF digits ~ '^0[127][0-9]{8,9}$' THEN
    RETURN '+44' || substring(digits from 2);
  END IF;

  IF digits ~ '^(351|352|353|354|355|356|357|358|359|370|371|372|373|374|375|376|377|378|380|381|382|383|385|386|387|389|420|421|423|212|213|216|244|245|258|297|298|299|852|853|855|856|880|886|960|961|962|963|964|965|966|967|968|971|972|973|974|975|976|977|992|993|994|995|996|998|20|27|30|31|32|33|34|36|39|40|41|43|44|45|46|47|48|49|51|52|53|54|55|56|57|58|60|61|62|63|64|65|66|81|82|84|86|90|91|92|93|94|95|98|1)[0-9]{6,}$' THEN
    RETURN '+' || digits;
  END IF;

  RETURN digits;
END;
$to_e164$;

-- 3) Matching key (national digits, for login/search)
CREATE OR REPLACE FUNCTION public.normalize_phone(phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $normalize_phone$
DECLARE
  e164 text;
  digits text;
BEGIN
  IF phone IS NULL OR btrim(phone) = '' THEN
    RETURN NULL;
  END IF;

  e164 := public.to_e164_for_players(phone);
  IF e164 IS NULL THEN
    RETURN NULL;
  END IF;

  IF e164 LIKE '+%' THEN
    digits := substring(e164 from 2);
  ELSE
    digits := e164;
  END IF;

  IF digits ~ '^3519[0-9]{8}$' THEN
    RETURN substring(digits from 4);
  END IF;
  IF digits ~ '^34[67][0-9]{8}$' THEN
    RETURN substring(digits from 3);
  END IF;
  IF digits ~ '^447[0-9]{9}$' THEN
    RETURN '0' || substring(digits from 3);
  END IF;
  IF digits ~ '^44[127][0-9]{8,9}$' THEN
    RETURN '0' || substring(digits from 3);
  END IF;

  RETURN digits;
END;
$normalize_phone$;

-- 4) Trigger helpers (must store E.164)
CREATE OR REPLACE FUNCTION public.normalize_phone_number(phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $normalize_phone_number$
BEGIN
  RETURN public.to_e164_for_players(phone);
END;
$normalize_phone_number$;

CREATE OR REPLACE FUNCTION public.normalize_portuguese_phone(phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $normalize_portuguese_phone$
BEGIN
  RETURN public.to_e164_for_players(phone);
END;
$normalize_portuguese_phone$;

CREATE OR REPLACE FUNCTION public.normalize_player_phone_on_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $normalize_player_phone_on_insert$
BEGIN
  IF NEW.phone_number IS NOT NULL THEN
    NEW.phone_number := public.to_e164_for_players(NEW.phone_number);
  END IF;
  RETURN NEW;
END;
$normalize_player_phone_on_insert$;

DROP TRIGGER IF EXISTS normalize_player_phone_trigger ON public.players;
CREATE TRIGGER normalize_player_phone_trigger
  BEFORE INSERT OR UPDATE OF phone_number ON public.players
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_player_phone_on_insert();

-- 5) Migrate existing data (skip collisions on player_accounts)
WITH candidates AS (
  SELECT
    pa.id,
    pa.phone_number AS old_phone,
    public.to_e164_for_players(pa.phone_number) AS new_phone
  FROM public.player_accounts pa
)
UPDATE public.player_accounts pa
SET phone_number = c.new_phone
FROM candidates c
WHERE pa.id = c.id
  AND c.new_phone IS NOT NULL
  AND c.new_phone <> c.old_phone
  AND NOT EXISTS (
    SELECT 1
    FROM public.player_accounts x
    WHERE x.phone_number = c.new_phone
      AND x.id <> c.id
  );

UPDATE public.players p
SET phone_number = public.to_e164_for_players(p.phone_number)
WHERE p.phone_number IS NOT NULL
  AND public.to_e164_for_players(p.phone_number) IS NOT NULL
  AND public.to_e164_for_players(p.phone_number) <> p.phone_number;

UPDATE public.organizer_players op
SET phone_number = public.to_e164_for_players(op.phone_number)
WHERE op.phone_number IS NOT NULL
  AND public.to_e164_for_players(op.phone_number) IS NOT NULL
  AND public.to_e164_for_players(op.phone_number) <> op.phone_number;

UPDATE public.member_subscriptions ms
SET member_phone = public.to_e164_for_players(ms.member_phone)
WHERE ms.member_phone IS NOT NULL
  AND public.to_e164_for_players(ms.member_phone) IS NOT NULL
  AND public.to_e164_for_players(ms.member_phone) <> ms.member_phone;
