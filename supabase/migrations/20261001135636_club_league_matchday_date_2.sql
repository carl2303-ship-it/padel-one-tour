-- Segundo dia opcional por jornada (jornada pode decorrer em 2 dias)
ALTER TABLE club_league_matchdays
  ADD COLUMN IF NOT EXISTS matchday_date_2 DATE;
