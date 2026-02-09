/*
  # Add player_category to players table
  
  Adds player_category column to players table to classify players by skill level.
  This will be used for league categorization.
  
  Categories: M6-M1 (Male), F6-F1 (Female)
  - 6 = beginner
  - 1 = advanced
*/

-- Add player_category column
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS player_category text;

-- Add CHECK constraint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'players_player_category_check') THEN
    ALTER TABLE players ADD CONSTRAINT players_player_category_check
      CHECK (player_category IS NULL OR player_category IN ('M6', 'M5', 'M4', 'M3', 'M2', 'M1', 'F6', 'F5', 'F4', 'F3', 'F2', 'F1'));
  END IF;
END $$;

-- Create index for filtering by category
CREATE INDEX IF NOT EXISTS idx_players_category ON players(player_category);

-- Comment
COMMENT ON COLUMN players.player_category IS 'Player skill category: M6-M1 (Male), F6-F1 (Female). Used for league classification.';
