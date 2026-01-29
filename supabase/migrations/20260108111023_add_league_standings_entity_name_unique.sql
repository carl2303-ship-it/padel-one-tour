/*
  # Add Unique Constraint on Entity Name

  1. Changes
    - Add unique constraint on (league_id, entity_type, entity_name) for ON CONFLICT to work
    - This allows upserts based on player name
*/

CREATE UNIQUE INDEX IF NOT EXISTS league_standings_league_entity_type_name_unique 
ON league_standings (league_id, entity_type, LOWER(entity_name));
