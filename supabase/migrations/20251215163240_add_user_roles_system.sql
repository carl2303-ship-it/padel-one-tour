/*
  # Add User Roles System
  
  1. Changes
    - Add `role` column to `user_logo_settings` table
    - Role can be 'organizer' or 'player'
    - Default role is 'organizer' for backwards compatibility
    
  2. Security
    - Users can update their own role
    - Maintain existing RLS policies
*/

-- Add role column to user_logo_settings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_logo_settings' AND column_name = 'role'
  ) THEN
    ALTER TABLE user_logo_settings 
    ADD COLUMN role text DEFAULT 'organizer' CHECK (role IN ('organizer', 'player'));
  END IF;
END $$;

-- Update existing users to have organizer role
UPDATE user_logo_settings SET role = 'organizer' WHERE role IS NULL;