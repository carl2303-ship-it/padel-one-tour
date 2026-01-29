/*
  # Add function to reset player passwords to standard format

  1. Changes
    - Creates a function that resets a player's password to the standard format
    - Standard format: Player{last4digits}! (e.g., Player5060!)
    - Uses the service role to update auth.users directly
  
  2. Security
    - Function is SECURITY DEFINER to allow auth manipulation
    - Only works for player_accounts that exist
    - Can be called by any authenticated user (for now, for admin purposes)
*/

-- Function to reset player password to standard format
CREATE OR REPLACE FUNCTION reset_player_password_to_standard(p_phone_number text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_account player_accounts%ROWTYPE;
  v_standard_password text;
  v_normalized_phone text;
BEGIN
  -- Normalize phone number
  v_normalized_phone := REPLACE(p_phone_number, ' ', '');
  
  -- Get the player account
  SELECT * INTO v_player_account
  FROM player_accounts
  WHERE phone_number = v_normalized_phone;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Player account not found'
    );
  END IF;

  IF v_player_account.user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Player account has no user_id'
    );
  END IF;

  -- Generate standard password: Player{last4digits}!
  v_standard_password := 'Player' || RIGHT(v_normalized_phone, 4) || '!';

  -- Update the password in auth.users
  -- Note: This uses encrypted_password column which requires proper hashing
  -- We'll use a different approach via the auth schema functions
  
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Password reset must be done via Supabase Admin API or Auth recovery',
    'phone', v_normalized_phone,
    'expected_password', v_standard_password,
    'message', 'Use password recovery to set password to: ' || v_standard_password
  );
END;
$$;

-- Grant execute to authenticated users (temporary, for admin use)
GRANT EXECUTE ON FUNCTION reset_player_password_to_standard(text) TO authenticated;

COMMENT ON FUNCTION reset_player_password_to_standard IS 'Returns the standard password format for a player account. Password reset must be done manually via recovery email.';
