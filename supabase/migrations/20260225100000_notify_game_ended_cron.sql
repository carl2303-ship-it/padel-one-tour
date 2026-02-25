/*
  # Notify Game Ended - Cron Job
  
  Cron Job: notify-game-ended
    - Runs every 15 minutes
    - Calls edge function to notify players about games that have ended and need result entry
*/

-- Ensure pg_cron and pg_net extensions exist
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove existing cron job if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'notify-game-ended'
  ) THEN
    PERFORM cron.unschedule('notify-game-ended');
  END IF;
END $$;

-- Schedule cron job for game ended notifications
SELECT cron.schedule(
  'notify-game-ended',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://rqiwnxcexsccguruiteq.supabase.co/functions/v1/notify-game-ended',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    )
  )
  $$
);
