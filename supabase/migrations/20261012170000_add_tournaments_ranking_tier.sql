-- Escala de pontos do ranking 12 meses: master | regular (Open) | social (Americano)
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS ranking_tier text;

ALTER TABLE public.tournaments
  DROP CONSTRAINT IF EXISTS tournaments_ranking_tier_check;

ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_ranking_tier_check
  CHECK (ranking_tier IS NULL OR ranking_tier IN ('master', 'regular', 'social'));

COMMENT ON COLUMN public.tournaments.ranking_tier IS
  'Pontos ranking 12m: master (Master), regular (Open), social (Americano). NULL = inferir do nome/formato.';

CREATE INDEX IF NOT EXISTS idx_tournaments_ranking_tier
  ON public.tournaments (ranking_tier)
  WHERE ranking_tier IS NOT NULL;
