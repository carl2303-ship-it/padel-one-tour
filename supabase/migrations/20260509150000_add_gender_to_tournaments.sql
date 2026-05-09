-- Add gender column to tournaments for filtering (male/female/mixed)
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS gender text
    CHECK (gender IS NULL OR gender IN ('male', 'female', 'mixed'));

COMMENT ON COLUMN tournaments.gender IS 'Target gender for the tournament: male, female, mixed, or NULL (open to all)';
