/*
  # Populate players.player_category from organizer_players
  
  Copies player_category from organizer_players to players table
  by matching on normalized player name.
*/

UPDATE players p
SET player_category = op.player_category
FROM organizer_players op
WHERE LOWER(TRIM(p.name)) = LOWER(TRIM(op.name))
  AND op.player_category IS NOT NULL
  AND p.player_category IS NULL;
