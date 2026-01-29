/*
  # Fix league standings entity types
  
  1. Changes
    - Update constraint to accept 'player' type
    - Remove old team standings (teams change, doesn't make sense)
    - Change 'individual' entity_type to 'player' for consistency
  
  2. Notes
    - After this migration, tournaments need to be re-finalized to populate standings correctly
*/

-- Drop old constraint first
ALTER TABLE league_standings DROP CONSTRAINT IF EXISTS league_standings_entity_type_check;

-- Update 'individual' to 'player' for consistency
UPDATE league_standings SET entity_type = 'player' WHERE entity_type = 'individual';

-- Delete team standings as they no longer make sense
DELETE FROM league_standings WHERE entity_type = 'team';

-- Add new constraint that only allows 'player'
ALTER TABLE league_standings 
  ADD CONSTRAINT league_standings_entity_type_check 
  CHECK (entity_type = 'player');
