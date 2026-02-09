/*
  # Add profile fields to player_accounts

  Adds new columns to player_accounts table for complete player profile:
  - player_category (M6-M1, F6-F1)
  - gender
  - birth_date
  - avatar_url
  - location
  - preferred_hand
  - court_position
  - bio
  - favorite_club_id
  - level, points, wins, losses, level_reliability_percent
*/

-- Add profile columns to player_accounts
ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS player_category text,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS preferred_hand text,
  ADD COLUMN IF NOT EXISTS court_position text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS favorite_club_id uuid,
  ADD COLUMN IF NOT EXISTS level numeric,
  ADD COLUMN IF NOT EXISTS points integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wins integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS losses integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level_reliability_percent numeric;

-- Add CHECK constraints (idempotent: drop if exists, then create)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'player_accounts_player_category_check') THEN
    ALTER TABLE player_accounts ADD CONSTRAINT player_accounts_player_category_check
      CHECK (player_category IS NULL OR player_category IN ('M6', 'M5', 'M4', 'M3', 'M2', 'M1', 'F6', 'F5', 'F4', 'F3', 'F2', 'F1'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'player_accounts_gender_check') THEN
    ALTER TABLE player_accounts ADD CONSTRAINT player_accounts_gender_check
      CHECK (gender IS NULL OR gender IN ('male', 'female', 'other'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'player_accounts_preferred_hand_check') THEN
    ALTER TABLE player_accounts ADD CONSTRAINT player_accounts_preferred_hand_check
      CHECK (preferred_hand IS NULL OR preferred_hand IN ('right', 'left', 'ambidextrous'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'player_accounts_court_position_check') THEN
    ALTER TABLE player_accounts ADD CONSTRAINT player_accounts_court_position_check
      CHECK (court_position IS NULL OR court_position IN ('right', 'left', 'both'));
  END IF;
END $$;
