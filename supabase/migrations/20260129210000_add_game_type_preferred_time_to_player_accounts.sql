/*
  # Add game_type and preferred_time to player_accounts
  
  Adds missing profile fields:
  - game_type: competitive, friendly, both
  - preferred_time: morning, afternoon, evening, all_day
*/

ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS game_type text,
  ADD COLUMN IF NOT EXISTS preferred_time text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'player_accounts_game_type_check') THEN
    ALTER TABLE player_accounts ADD CONSTRAINT player_accounts_game_type_check
      CHECK (game_type IS NULL OR game_type IN ('competitive', 'friendly', 'both'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'player_accounts_preferred_time_check') THEN
    ALTER TABLE player_accounts ADD CONSTRAINT player_accounts_preferred_time_check
      CHECK (preferred_time IS NULL OR preferred_time IN ('morning', 'afternoon', 'evening', 'all_day'));
  END IF;
END $$;
