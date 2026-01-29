/*
  # Add is_paid_organizer field for security

  1. Changes
    - Add `is_paid_organizer` boolean field to `user_logo_settings` table
    - Default to false for security
    - Set existing organizer accounts (those with tournaments) as paid organizers

  2. Security
    - Only users with is_paid_organizer = true can access organizer dashboard
    - Players cannot change their role to organizer without payment
*/

-- Add is_paid_organizer column
ALTER TABLE user_logo_settings 
ADD COLUMN IF NOT EXISTS is_paid_organizer boolean DEFAULT false;

-- Mark existing legitimate organizers (those who have created tournaments) as paid
UPDATE user_logo_settings uls
SET is_paid_organizer = true
WHERE EXISTS (
  SELECT 1 FROM tournaments t 
  WHERE t.user_id = uls.user_id
);

-- Also mark users who were created via Stripe (have source = 'boostpadel_store' in metadata)
UPDATE user_logo_settings uls
SET is_paid_organizer = true
WHERE EXISTS (
  SELECT 1 FROM auth.users au 
  WHERE au.id = uls.user_id 
  AND au.raw_user_meta_data->>'source' = 'boostpadel_store'
);
