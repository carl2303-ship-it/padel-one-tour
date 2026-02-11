-- Add club payment settings to tournaments
-- member_price: price for club members
-- non_member_price: price for non-members
-- allow_club_payment: if true, players can choose to pay at the club instead of being forced to pay via Stripe

ALTER TABLE tournaments
ADD COLUMN IF NOT EXISTS member_price decimal(10,2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS non_member_price decimal(10,2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS allow_club_payment boolean DEFAULT false;

-- Also add to tournament_categories for per-category pricing
ALTER TABLE tournament_categories
ADD COLUMN IF NOT EXISTS member_price decimal(10,2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS non_member_price decimal(10,2) DEFAULT NULL;
