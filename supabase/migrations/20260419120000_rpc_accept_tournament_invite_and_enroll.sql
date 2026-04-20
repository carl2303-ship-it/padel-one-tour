CREATE OR REPLACE FUNCTION public.accept_tournament_invite(
  p_player_account_id uuid,
  p_tournament_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_account_name text;
  v_account_phone text;
  v_category_id uuid;
  v_existing_player_id uuid;
  v_inserted_player_id uuid;
  v_invite_id uuid;
BEGIN
  IF p_status NOT IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'Status invalido: %', p_status;
  END IF;

  UPDATE tournament_invites
  SET status = p_status
  WHERE player_account_id = p_player_account_id
    AND tournament_id = p_tournament_id
  RETURNING id INTO v_invite_id;

  IF v_invite_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Convite nao encontrado');
  END IF;

  IF p_status = 'declined' THEN
    RETURN jsonb_build_object('success', true, 'invite_id', v_invite_id);
  END IF;

  v_existing_player_id := (
    SELECT p.id FROM players p
    WHERE p.tournament_id = p_tournament_id
      AND p.player_account_id = p_player_account_id
    LIMIT 1
  );

  IF v_existing_player_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'invite_id', v_invite_id,
      'player_id', v_existing_player_id,
      'already_enrolled', true
    );
  END IF;

  v_account_name := (
    SELECT pa.name FROM player_accounts pa WHERE pa.id = p_player_account_id
  );

  IF v_account_name IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'invite_id', v_invite_id,
      'enrolled', false,
      'reason', 'player_account_not_found'
    );
  END IF;

  v_account_phone := (
    SELECT pa.phone_number FROM player_accounts pa WHERE pa.id = p_player_account_id
  );

  v_category_id := (
    SELECT tc.id FROM tournament_categories tc
    WHERE tc.tournament_id = p_tournament_id
    ORDER BY tc.name
    LIMIT 1
  );

  IF v_category_id IS NULL THEN
    v_category_id := (
      SELECT p.category_id FROM players p
      WHERE p.tournament_id = p_tournament_id
      LIMIT 1
    );
  END IF;

  INSERT INTO players (
    tournament_id,
    category_id,
    name,
    phone_number,
    player_account_id
  ) VALUES (
    p_tournament_id,
    v_category_id,
    v_account_name,
    v_account_phone,
    p_player_account_id
  )
  RETURNING id INTO v_inserted_player_id;

  RETURN jsonb_build_object(
    'success', true,
    'invite_id', v_invite_id,
    'player_id', v_inserted_player_id,
    'enrolled', true
  );
END;
$body$;

GRANT EXECUTE ON FUNCTION public.accept_tournament_invite(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_tournament_invite(uuid, uuid, text) TO anon;
