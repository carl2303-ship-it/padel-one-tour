-- Home match slot per club league team (weekday + kickoff time).
-- Used when generating the calendar so each home game lands on that club's day/time.
-- weekday: ISO 1=Monday … 7=Sunday

ALTER TABLE club_league_teams
  ADD COLUMN IF NOT EXISTS home_weekday SMALLINT
    CHECK (home_weekday IS NULL OR (home_weekday BETWEEN 1 AND 7)),
  ADD COLUMN IF NOT EXISTS home_time TIME;

COMMENT ON COLUMN club_league_teams.home_weekday IS
  'Preferred home match weekday (ISO): 1=Monday … 7=Sunday';
COMMENT ON COLUMN club_league_teams.home_time IS
  'Preferred home match kickoff time (local)';
