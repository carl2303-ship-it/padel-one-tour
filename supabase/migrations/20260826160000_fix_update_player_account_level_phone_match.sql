-- Keep update_player_account_level in sync: match by account id OR last 9 phone digits.
-- Fixes organizers updating levels when phones are stored as +351... vs national digits.

CREATE OR REPLACE FUNCTION public.update_player_account_level(
  p_phone_number text DEFAULT NULL,
  p_player_account_id uuid DEFAULT NULL,
  p_player_category text DEFAULT NULL,
  p_level numeric DEFAULT NULL,
  p_level_reliability_percent numeric DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_updated_id UUID;
  v_name TEXT;
  v_phone_digits TEXT;
  v_phone_suffix TEXT;
BEGIN
  IF p_player_account_id IS NOT NULL THEN
    UPDATE player_accounts
    SET
      player_category = COALESCE(p_player_category, player_category),
      level = COALESCE(p_level, level),
      level_reliability_percent = COALESCE(p_level_reliability_percent, level_reliability_percent),
      updated_at = NOW()
    WHERE id = p_player_account_id
    RETURNING id, name INTO v_updated_id, v_name;
  ELSIF p_phone_number IS NOT NULL THEN
    v_phone_digits := regexp_replace(p_phone_number, '\D', '', 'g');
    IF length(v_phone_digits) >= 7 THEN
      v_phone_suffix := RIGHT(v_phone_digits, LEAST(9, length(v_phone_digits)));

      UPDATE player_accounts
      SET
        player_category = COALESCE(p_player_category, player_category),
        level = COALESCE(p_level, level),
        level_reliability_percent = COALESCE(p_level_reliability_percent, level_reliability_percent),
        updated_at = NOW()
      WHERE RIGHT(regexp_replace(COALESCE(phone_number, ''), '\D', '', 'g'), length(v_phone_suffix)) = v_phone_suffix
      RETURNING id, name INTO v_updated_id, v_name;
    END IF;
  END IF;

  IF v_updated_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Player account not found',
      'phone', p_phone_number,
      'player_account_id', p_player_account_id
    );
  END IF;

  RETURN json_build_object('success', true, 'id', v_updated_id, 'name', v_name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_player_account_level TO authenticated;
