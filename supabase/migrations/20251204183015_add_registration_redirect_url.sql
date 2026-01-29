/*
  # Add Registration Redirect URL to Tournaments

  1. Changes
    - Add `registration_redirect_url` column to `tournaments` table
      - Optional text field to store a custom URL
      - When set, users will be redirected to this URL after completing registration
      - When not set, the registration modal will simply close as before

  2. Notes
    - This allows tournament organizers to redirect players to external sites
    - Common use cases: WhatsApp groups, Discord servers, additional information pages
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'registration_redirect_url'
  ) THEN
    ALTER TABLE tournaments ADD COLUMN registration_redirect_url text;
  END IF;
END $$;

COMMENT ON COLUMN tournaments.registration_redirect_url IS 'Optional URL to redirect users after successful registration';
