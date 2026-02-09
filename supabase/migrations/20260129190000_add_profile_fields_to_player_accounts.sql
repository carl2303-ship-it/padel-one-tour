/*
  # Add profile fields to player_accounts

  Adds new columns to player_accounts for player profile:
  - player_category (M6-M1, F6-F1)
  - gender
  - birth_date
  - avatar_url
  - location
  - preferred_hand
  - court_position
  - bio
  - favorite_club_id (already referenced in code)
  - level, points, wins, losses (stats)
  - level_reliability_percent
*/

-- Player category
ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS player_category text;

ALTER TABLE player_accounts
  ADD CONSTRAINT player_accounts_player_category_check
  CHECK (player_category IS NULL OR player_category IN (
    'M6', 'M5', 'M4', 'M3', 'M2', 'M1',
    'F6', 'F5', 'F4', 'F3', 'F2', 'F1'
  ));

-- Gender
ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS gender text;

ALTER TABLE player_accounts
  ADD CONSTRAINT player_accounts_gender_check
  CHECK (gender IS NULL OR gender IN ('male', 'female', 'other'));

-- Birth date
ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS birth_date date;

-- Avatar URL
ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- Location (city/region)
ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS location text;

-- Preferred hand
ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS preferred_hand text;

ALTER TABLE player_accounts
  ADD CONSTRAINT player_accounts_preferred_hand_check
  CHECK (preferred_hand IS NULL OR preferred_hand IN ('right', 'left', 'ambidextrous'));

-- Court position
ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS court_position text;

ALTER TABLE player_accounts
  ADD CONSTRAINT player_accounts_court_position_check
  CHECK (court_position IS NULL OR court_position IN ('right', 'left', 'both'));

-- Bio / description
ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS bio text;

-- Favorite club
ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS favorite_club_id uuid;

-- Stats (calculated, but stored for quick access)
ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS level numeric(3,1);

ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS points integer DEFAULT 0;

ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS wins integer DEFAULT 0;

ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS losses integer DEFAULT 0;

ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS level_reliability_percent integer;

-- Create index on player_category for filtering
CREATE INDEX IF NOT EXISTS idx_player_accounts_category ON player_accounts(player_category);
