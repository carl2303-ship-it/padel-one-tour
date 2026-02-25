/*
  # Club Payment Settings

  Adds payment configuration fields to the clubs table:
  - payment_method: which payment methods the club accepts
    'at_club' = pay at the club only
    'per_player' = each player pays online (Stripe) per player price
    'full_court' = one player pays the full court price online
    'at_club_or_per_player' = both options available
    'at_club_or_full_court' = both options available
    'all' = all three options
  - stripe_account_id: Stripe Connect account ID for the club
  - stripe_publishable_key: Stripe publishable key for the club
  - stripe_secret_key: Stripe secret key for the club
*/

-- Add payment columns to clubs
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'at_club'
  CHECK (payment_method IN ('at_club', 'per_player', 'full_court', 'at_club_or_per_player', 'at_club_or_full_court', 'all'));

ALTER TABLE clubs ADD COLUMN IF NOT EXISTS stripe_publishable_key text;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS stripe_secret_key text;

-- Add payment_id to open_game_players for tracking Stripe payments
ALTER TABLE open_game_players ADD COLUMN IF NOT EXISTS stripe_session_id text;

-- Table to track open game payments
CREATE TABLE IF NOT EXISTS open_game_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES open_games(id) ON DELETE CASCADE,
  player_account_id uuid REFERENCES player_accounts(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  stripe_session_id text,
  stripe_payment_intent_id text,
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'eur',
  payment_type text NOT NULL DEFAULT 'per_player' CHECK (payment_type IN ('per_player', 'full_court')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE open_game_payments ENABLE ROW LEVEL SECURITY;

-- Players can view their own payments
CREATE POLICY "Users can view own game payments"
  ON open_game_payments FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Service role full access
CREATE POLICY "Service role full access on game payments"
  ON open_game_payments FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ogp_game_id ON open_game_payments(game_id);
CREATE INDEX IF NOT EXISTS idx_ogp_stripe_session ON open_game_payments(stripe_session_id);
