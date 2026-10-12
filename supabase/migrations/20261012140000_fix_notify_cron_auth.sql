-- Fix notify crons: previous jobs used
--   Authorization: Bearer || current_setting('app.settings.service_role_key', true)
-- which evaluated to NULL → Edge Functions returned 401 on every run.
--
-- notify-new-tournament is deployed with verify_jwt=false, so cron only needs
-- Content-Type. Other notify functions still expect a valid JWT; use the
-- public anon key (same as the client) which is a valid HS256 JWT.
--
-- NOTE: Replace ANON_KEY_PLACEHOLDER before applying on a new environment,
-- or set the header via Dashboard → Edge Functions / cron after deploy.

DO $$
DECLARE
  anon text := current_setting('app.settings.anon_key', true);
BEGIN
  -- Prefer DB setting if present; otherwise keep existing schedules untouched
  -- when placeholder is used (production was fixed via MCP execute_sql).
  IF anon IS NULL OR length(anon) < 20 THEN
    RAISE NOTICE 'app.settings.anon_key not set — skip cron rewrite (set ALTER DATABASE … SET app.settings.anon_key and re-run, or update jobs in Dashboard)';
    RETURN;
  END IF;

  PERFORM cron.unschedule(j.jobid)
  FROM cron.job j
  WHERE j.jobname IN (
    'notify-new-tournament',
    'notify-upcoming-matches',
    'notify-upcoming-open-games',
    'notify-open-game-reminders',
    'notify-game-ended',
    'app notifications'
  );

  PERFORM cron.schedule(
    'notify-new-tournament',
    '*/30 * * * *',
    format($cron$
      SELECT net.http_post(
        url := 'https://rqiwnxcexsccguruiteq.supabase.co/functions/v1/notify-new-tournament',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer %s',
          'apikey', '%s'
        ),
        body := '{"mode":"cron"}'::jsonb
      );
    $cron$, anon, anon)
  );

  PERFORM cron.schedule(
    'notify-upcoming-matches',
    '*/15 * * * *',
    format($cron$
      SELECT net.http_post(
        url := 'https://rqiwnxcexsccguruiteq.supabase.co/functions/v1/notify-upcoming-matches',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer %s',
          'apikey', '%s'
        ),
        body := '{}'::jsonb
      );
    $cron$, anon, anon)
  );

  PERFORM cron.schedule(
    'notify-upcoming-open-games',
    '*/15 * * * *',
    format($cron$
      SELECT net.http_post(
        url := 'https://rqiwnxcexsccguruiteq.supabase.co/functions/v1/notify-upcoming-open-games',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer %s',
          'apikey', '%s'
        ),
        body := '{}'::jsonb
      );
    $cron$, anon, anon)
  );

  PERFORM cron.schedule(
    'notify-open-game-reminders',
    '*/15 * * * *',
    format($cron$
      SELECT net.http_post(
        url := 'https://rqiwnxcexsccguruiteq.supabase.co/functions/v1/notify-open-game-reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer %s',
          'apikey', '%s'
        ),
        body := '{}'::jsonb
      );
    $cron$, anon, anon)
  );

  PERFORM cron.schedule(
    'notify-game-ended',
    '*/15 * * * *',
    format($cron$
      SELECT net.http_post(
        url := 'https://rqiwnxcexsccguruiteq.supabase.co/functions/v1/notify-game-ended',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer %s',
          'apikey', '%s'
        ),
        body := '{}'::jsonb
      );
    $cron$, anon, anon)
  );
END $$;
