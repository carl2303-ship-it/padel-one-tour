/*
  # Make player email optional

  1. Changes
    - Make email column nullable in players table
    - Make email column nullable in player_accounts table
    - Allow registrations without email for testing purposes
*/

-- Make email optional in players table
ALTER TABLE players ALTER COLUMN email DROP NOT NULL;

-- Make email optional in player_accounts table
ALTER TABLE player_accounts ALTER COLUMN email DROP NOT NULL;
