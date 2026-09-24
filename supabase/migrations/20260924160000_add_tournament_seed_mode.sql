-- seed_mode: 'level' = auto CS by rating; 'manual' = organizer order (skip auto recalc)
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS seed_mode text NOT NULL DEFAULT 'level'
  CHECK (seed_mode IN ('level', 'manual'));

COMMENT ON COLUMN public.tournaments.seed_mode IS
  'level = auto CS by player level; manual = organizer-defined seed order';
