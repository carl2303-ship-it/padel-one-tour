/*
  # Open Game Fill Reminders + New Tournament Notifications
  
  1. Cron Job: notify-open-game-reminders
     - Runs every 15 minutes
     - Sends escalated reminders (24h, 16h, 8h, 4h, 2h, 1h) to matching players
       for open games that are NOT full yet
     - Uses open_game_notifications_sent for deduplication

  2. Cron Job: notify-new-tournament
     - Runs every 30 minutes
     - Detects newly created/published tournaments and notifies all players
     - Uses open_game_notifications_sent with notification_type = 'new_tournament'

  3. Remove FK constraint on open_game_notifications_sent.game_id to allow
     tournament IDs (which live in a different table)
*/

-- Allow game_id to store tournament IDs too (remove FK if it exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'open_game_notifications_sent_game_id_fkey'
      AND table_name = 'open_game_notifications_sent'
  ) THEN
    ALTER TABLE open_game_notifications_sent
      DROP CONSTRAINT open_game_notifications_sent_game_id_fkey;
  END IF;
END $$;

-- Ensure pg_cron and pg_net extensions are available
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ============================================================
-- Cron Job 1: Open Game Fill Reminders (every 15 minutes)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'notify-open-game-reminders'
  ) THEN
    PERFORM cron.unschedule('notify-open-game-reminders');
  END IF;
END $$;

SELECT cron.schedule(
  'notify-open-game-reminders',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://rqiwnxcexsccguruiteq.supabase.co/functions/v1/notify-open-game-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    )
  )
  $$
);

-- ============================================================
-- Cron Job 2: New Tournament Notifications (every 30 minutes)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'notify-new-tournament'
  ) THEN
    PERFORM cron.unschedule('notify-new-tournament');
  END IF;
END $$;

SELECT cron.schedule(
  'notify-new-tournament',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://rqiwnxcexsccguruiteq.supabase.co/functions/v1/notify-new-tournament',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{"mode":"cron"}'::jsonb
  )
  $$
);
