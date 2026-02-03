-- Bracket advancement: when a knockout confrontation is completed,
-- the winner is placed in the next round confrontation.
ALTER TABLE super_team_confrontations
  ADD COLUMN IF NOT EXISTS next_confrontation_id UUID REFERENCES super_team_confrontations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS next_team_slot INTEGER CHECK (next_team_slot IN (1, 2));

CREATE INDEX IF NOT EXISTS idx_super_team_confrontations_next ON super_team_confrontations(next_confrontation_id);
