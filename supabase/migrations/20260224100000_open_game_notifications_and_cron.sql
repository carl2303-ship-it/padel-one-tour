/*
  # Open Game Notifications - Tracking table + Cron Job
  
  1. New Table: open_game_notifications_sent
     - Tracks which reminder notifications have been sent for open games
     - Prevents duplicate notifications
  
  2. Cron Job: notify-upcoming-open-games
     - Runs every 15 minutes
     - Calls edge function to notify players about games starting within 1 hour
*/

-- Ensure push_subscriptions has unique constraint for player_account_id + endpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_player_endpoint_unique'
  ) THEN
    ALTER TABLE push_subscriptions
      ADD CONSTRAINT push_subscriptions_player_endpoint_unique UNIQUE (player_account_id, endpoint);
  END IF;
END $$;

-- Table to track sent notifications for open games
CREATE TABLE IF NOT EXISTS open_game_notifications_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES open_games(id) ON DELETE CASCADE,
  player_account_id uuid NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
  notification_type text NOT NULL DEFAULT 'reminder_1h',
  sent_at timestamptz DEFAULT now(),
  UNIQUE(game_id, player_account_id, notification_type)
);

ALTER TABLE open_game_notifications_sent ENABLE ROW LEVEL SECURITY;

-- Only service_role can manage these
CREATE POLICY "Service role can manage open game notifications"
  ON open_game_notifications_sent
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ogn_game_id ON open_game_notifications_sent(game_id);
CREATE INDEX IF NOT EXISTS idx_ogn_player_id ON open_game_notifications_sent(player_account_id);

-- Schedule cron job for open game reminders
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'notify-upcoming-open-games'
  ) THEN
    PERFORM cron.unschedule('notify-upcoming-open-games');
  END IF;
END $$;

SELECT cron.schedule(
  'notify-upcoming-open-games',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://rqiwnxcexsccguruiteq.supabase.co/functions/v1/notify-upcoming-open-games',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    )
  )
  $$
);
