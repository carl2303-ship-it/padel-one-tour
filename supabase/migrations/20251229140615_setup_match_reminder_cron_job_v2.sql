/*
  # Setup Match Reminder Cron Job

  1. Changes
    - Enable pg_cron extension if not already enabled
    - Create cron job to call notify-upcoming-matches function every 15 minutes
    - The job runs 24/7 to check for matches starting within the next hour

  2. Schedule
    - Runs every 15 minutes (cron format)
    - Calls the edge function to send notifications to players

  3. Notes
    - Uses pg_net extension to make HTTP requests
    - Service role key is automatically available in Supabase
    - Job will send notifications 1 hour before matches
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'notify-upcoming-matches'
  ) THEN
    PERFORM cron.unschedule('notify-upcoming-matches');
  END IF;
END $$;

SELECT cron.schedule(
  'notify-upcoming-matches',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://rqiwnxcexsccguruiteq.supabase.co/functions/v1/notify-upcoming-matches',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    )
  )
  $$
);
