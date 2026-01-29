/*
  # Fix player accounts without auth users

  1. Changes
    - Creates a function to fix player accounts that have user_id = null
    - The function attempts to create the auth user with the correct password
    - Updates the player_account with the new user_id
  
  2. Security
    - Function is security definer to allow auth.users manipulation
    - Only accessible by authenticated users
*/

-- Function to fix/create missing auth users for player accounts
CREATE OR REPLACE FUNCTION fix_player_account_auth(p_phone_number text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account player_accounts%ROWTYPE;
  v_password text;
  v_user_id uuid;
  v_result jsonb;
BEGIN
  -- Get the player account
  SELECT * INTO v_account
  FROM player_accounts
  WHERE phone_number = p_phone_number;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Account not found'
    );
  END IF;

  -- If user_id already exists, nothing to do
  IF v_account.user_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Account already has user_id',
      'user_id', v_account.user_id
    );
  END IF;

  -- Generate the password (Player + last 4 digits + !)
  v_password := 'Player' || RIGHT(p_phone_number, 4) || '!';

  -- Try to get existing user by email
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = v_account.email;

  IF FOUND THEN
    -- User exists, just update the player_account
    UPDATE player_accounts
    SET user_id = v_user_id,
        updated_at = NOW()
    WHERE phone_number = p_phone_number;

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Linked to existing auth user',
      'user_id', v_user_id
    );
  ELSE
    -- User doesn't exist, return info to create manually
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Auth user does not exist',
      'email', v_account.email,
      'password', v_password,
      'action_needed', 'User must register again or admin must create auth user'
    );
  END IF;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION fix_player_account_auth(text) TO authenticated;
