/*
  # Make logo_url nullable in user_logo_settings
  
  1. Changes
    - Change `logo_url` column to nullable in `user_logo_settings` table
    - This allows users to set their role without requiring a logo URL
  
  2. Security
    - Maintain existing RLS policies
*/

ALTER TABLE user_logo_settings 
ALTER COLUMN logo_url DROP NOT NULL;