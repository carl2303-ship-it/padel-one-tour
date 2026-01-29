/*
  # Add Player Push Notifications Support

  1. Changes to `push_subscriptions`
    - Add `player_account_id` column for player subscriptions
    - Make `user_id` nullable (either user_id OR player_account_id must be set)
    - Add check constraint to ensure at least one ID is set

  2. New Tables
    - `match_notifications_sent`
      - Tracks which match notifications have been sent
      - Prevents duplicate notifications

  3. Security
    - Update RLS policies for player access
    - Enable RLS on new table
*/

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS player_account_id uuid REFERENCES player_accounts(id) ON DELETE CASCADE;

ALTER TABLE push_subscriptions
  ALTER COLUMN user_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_owner_check'
  ) THEN
    ALTER TABLE push_subscriptions
      ADD CONSTRAINT push_subscriptions_owner_check
      CHECK (user_id IS NOT NULL OR player_account_id IS NOT NULL);
  END IF;
END $$;

DROP INDEX IF EXISTS idx_push_subscriptions_user_id;
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_player_account_id ON push_subscriptions(player_account_id) WHERE player_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS match_notifications_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_account_id uuid NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
  notification_type text NOT NULL DEFAULT 'reminder_1h',
  sent_at timestamptz DEFAULT now(),
  UNIQUE(match_id, player_account_id, notification_type)
);

ALTER TABLE match_notifications_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage match notifications"
  ON match_notifications_sent
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view own push subscriptions" ON push_subscriptions;
DROP POLICY IF EXISTS "Users can insert own push subscriptions" ON push_subscriptions;
DROP POLICY IF EXISTS "Users can update own push subscriptions" ON push_subscriptions;
DROP POLICY IF EXISTS "Users can delete own push subscriptions" ON push_subscriptions;

CREATE POLICY "Users can view own push subscriptions"
  ON push_subscriptions
  FOR SELECT
  TO authenticated
  USING (
    (user_id IS NOT NULL AND auth.uid() = user_id) OR
    (player_account_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM player_accounts pa WHERE pa.id = player_account_id AND pa.user_id = auth.uid()
    ))
  );

CREATE POLICY "Users can insert own push subscriptions"
  ON push_subscriptions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (user_id IS NOT NULL AND auth.uid() = user_id) OR
    (player_account_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM player_accounts pa WHERE pa.id = player_account_id AND pa.user_id = auth.uid()
    ))
  );

CREATE POLICY "Users can update own push subscriptions"
  ON push_subscriptions
  FOR UPDATE
  TO authenticated
  USING (
    (user_id IS NOT NULL AND auth.uid() = user_id) OR
    (player_account_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM player_accounts pa WHERE pa.id = player_account_id AND pa.user_id = auth.uid()
    ))
  )
  WITH CHECK (
    (user_id IS NOT NULL AND auth.uid() = user_id) OR
    (player_account_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM player_accounts pa WHERE pa.id = player_account_id AND pa.user_id = auth.uid()
    ))
  );

CREATE POLICY "Users can delete own push subscriptions"
  ON push_subscriptions
  FOR DELETE
  TO authenticated
  USING (
    (user_id IS NOT NULL AND auth.uid() = user_id) OR
    (player_account_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM player_accounts pa WHERE pa.id = player_account_id AND pa.user_id = auth.uid()
    ))
  );
