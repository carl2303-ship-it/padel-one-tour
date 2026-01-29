/*
  # Add Push Subscriptions for Organizer Notifications

  1. New Tables
    - `push_subscriptions`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `endpoint` (text, unique) - Push service endpoint URL
      - `p256dh` (text) - Public key for encryption
      - `auth` (text) - Auth secret for encryption
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `push_subscriptions` table
    - Users can only manage their own subscriptions

  3. Purpose
    - Stores Web Push subscription data for organizers
    - Enables sending push notifications to organizer devices
*/

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own push subscriptions"
  ON push_subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own push subscriptions"
  ON push_subscriptions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own push subscriptions"
  ON push_subscriptions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own push subscriptions"
  ON push_subscriptions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
