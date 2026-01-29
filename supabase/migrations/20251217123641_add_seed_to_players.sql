/*
  # Add seed column to players table

  1. Changes
    - Add `seed` column to `players` table for individual player seeding
    - Similar to teams table, allows ranking players 1-120

  2. Notes
    - Optional field, defaults to NULL
    - Used for tournament bracket seeding in individual formats
*/

ALTER TABLE players ADD COLUMN IF NOT EXISTS seed integer;

COMMENT ON COLUMN players.seed IS 'Seed/ranking for tournament bracket placement (1-120)';