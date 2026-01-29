/*
  # Remove unique constraint on player names

  1. Changes
    - Drop the unique index `players_name_lower_idx` on players table
    - This allows multiple players to have the same name, which is correct behavior
    - Players should be identified by email or ID, not name
  
  2. Reasoning
    - Different people can have the same name
    - The same person can participate in multiple tournaments
    - Names are not a reliable unique identifier
*/

DROP INDEX IF EXISTS players_name_lower_idx;
