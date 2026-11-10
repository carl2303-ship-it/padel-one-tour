-- HUB-70: Auto-link new Player App accounts to Carlos organizer roster.
-- Project: padel1 (rqiwnxcexsccguruiteq)
-- Does NOT touch player_clubs / club memberships.
-- organizer_players.organizer_id = auth.users.id of Carlos (not organizers.id).

CREATE OR REPLACE FUNCTION public.attach_player_account_to_carlos_organizer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  carlos_uid constant uuid := '2f3df003-1ab6-4a14-b756-08800d95419a';
  v_name text;
  v_email text;
  v_phone text;
BEGIN
  v_name := nullif(trim(NEW.name), '');
  v_email := nullif(trim(NEW.email), '');
  v_phone := nullif(trim(NEW.phone_number), '');

  -- Need name + phone to match HUB-68 attach rules
  IF v_name IS NULL OR v_phone IS NULL THEN
    RETURN NEW;
  END IF;

  -- Already on Carlos roster by phone or exact name
  IF EXISTS (
    SELECT 1
    FROM public.organizer_players op
    WHERE op.organizer_id = carlos_uid
      AND (
        op.phone_number = v_phone
        OR op.name = v_name
      )
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.organizer_players (
    organizer_id,
    name,
    email,
    phone_number,
    player_category
  )
  VALUES (
    carlos_uid,
    v_name,
    v_email,
    v_phone,
    NEW.player_category
  )
  ON CONFLICT (organizer_id, name) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.attach_player_account_to_carlos_organizer() IS
  'HUB-70: AFTER INSERT on player_accounts → copy contact into organizer_players for Carlos (2f3df003-…). Never deletes club links.';

DROP TRIGGER IF EXISTS trg_attach_player_account_to_carlos ON public.player_accounts;

CREATE TRIGGER trg_attach_player_account_to_carlos
  AFTER INSERT ON public.player_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.attach_player_account_to_carlos_organizer();
