-- Sync player_category from organizer_players to player_accounts via phone_number
-- This makes player_accounts the single source of truth for player categories

UPDATE player_accounts pa
SET player_category = op.player_category
FROM organizer_players op
WHERE pa.phone_number = op.phone_number
  AND op.player_category IS NOT NULL
  AND (pa.player_category IS NULL OR pa.player_category = '');
