/*
  # Update João Pinto Authentication Email
  
  This migration updates the authentication email for João Pinto from 
  'carloscoelho2303@gmail.com' to 'geral@jdpinto.pt' in the auth.users table.
  
  ## Changes
  - Updates the email in auth.users for user_id 'b65313a7-bfab-4d67-8a9e-7a982eb7c1c0'
  - Updates both email and raw_user_meta_data fields
*/

-- Update the email in auth.users
UPDATE auth.users
SET 
  email = 'geral@jdpinto.pt',
  raw_user_meta_data = jsonb_set(
    COALESCE(raw_user_meta_data, '{}'::jsonb),
    '{email}',
    '"geral@jdpinto.pt"'
  ),
  updated_at = NOW()
WHERE id = 'b65313a7-bfab-4d67-8a9e-7a982eb7c1c0';

-- Verify the update
DO $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email
  FROM auth.users
  WHERE id = 'b65313a7-bfab-4d67-8a9e-7a982eb7c1c0';
  
  RAISE NOTICE 'João Pinto email updated to: %', v_email;
END $$;
