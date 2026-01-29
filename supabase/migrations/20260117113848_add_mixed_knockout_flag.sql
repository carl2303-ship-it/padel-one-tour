/*
  # Add Mixed Knockout Support
  
  1. Changes
    - Add `mixed_knockout` boolean field to tournaments table
    - When enabled, knockout phase combines players from different categories (M+F) into mixed teams
    - Default is false to maintain backward compatibility with existing tournaments
  
  2. Notes
    - This allows "Americano Misto" style tournaments where:
      - Group phase: categories play separately (M vs M, F vs F)
      - Knockout phase: teams are formed with 1 male + 1 female player
*/

ALTER TABLE tournaments
ADD COLUMN IF NOT EXISTS mixed_knockout boolean DEFAULT false;

COMMENT ON COLUMN tournaments.mixed_knockout IS 'When true, knockout phase combines players from different categories into mixed teams (1M + 1F)';