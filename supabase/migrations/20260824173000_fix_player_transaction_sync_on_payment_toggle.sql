-- Harden insert/delete so payment toggles stay in sync with metrics ledger
CREATE OR REPLACE FUNCTION public.insert_player_transaction(
  p_club_owner_id uuid,
  p_player_name text,
  p_player_phone text,
  p_transaction_type text,
  p_amount numeric,
  p_reference_id uuid,
  p_reference_type text,
  p_notes text DEFAULT NULL,
  p_player_account_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id uuid;
  v_name text := trim(both from coalesce(p_player_name, ''));
  v_phone text := nullif(trim(both from coalesce(p_player_phone, '')), '');
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'player_name is required';
  END IF;

  INSERT INTO player_transactions (
    club_owner_id, player_name, player_phone, transaction_type,
    amount, reference_id, reference_type, notes, player_account_id
  ) VALUES (
    p_club_owner_id, v_name, v_phone, p_transaction_type,
    p_amount, p_reference_id, p_reference_type, p_notes, p_player_account_id
  )
  ON CONFLICT (player_name, reference_id, reference_type) WHERE reference_id IS NOT NULL
  DO UPDATE SET
    amount = EXCLUDED.amount,
    notes = EXCLUDED.notes,
    player_phone = COALESCE(EXCLUDED.player_phone, player_transactions.player_phone),
    player_account_id = COALESCE(EXCLUDED.player_account_id, player_transactions.player_account_id),
    transaction_date = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_player_transaction(
  p_club_owner_id uuid,
  p_reference_id uuid,
  p_reference_type text,
  p_player_name text,
  p_player_phone text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_deleted integer := 0;
  v_name text := lower(trim(both from coalesce(p_player_name, '')));
  v_phone_digits text := NULLIF(regexp_replace(coalesce(p_player_phone, ''), '[^0-9]', '', 'g'), '');
BEGIN
  DELETE FROM player_transactions
  WHERE club_owner_id = p_club_owner_id
    AND reference_id = p_reference_id
    AND reference_type = p_reference_type
    AND (
      lower(trim(both from player_name)) = v_name
      OR (
        v_phone_digits IS NOT NULL
        AND NULLIF(regexp_replace(coalesce(player_phone, ''), '[^0-9]', '', 'g'), '') = v_phone_digits
      )
    );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

-- Remove stale ledger rows for players no longer marked paid
DELETE FROM player_transactions pt
USING players p
WHERE pt.reference_type = 'tournament'
  AND p.tournament_id = pt.reference_id
  AND lower(trim(both from p.name)) = lower(trim(both from pt.player_name))
  AND coalesce(p.payment_status, 'pending') IS DISTINCT FROM 'paid';
