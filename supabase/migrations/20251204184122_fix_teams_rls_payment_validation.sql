/*
  # Fix Teams RLS to Prevent Unpaid Registrations

  ## Problem
  The current RLS policy allows anonymous users to create teams in public tournaments
  without verifying payment status. This allows users to bypass the payment system.

  ## Solution
  1. Drop the existing anonymous insert policy
  2. Create two new policies:
     - Allow anonymous inserts ONLY when registration_fee is 0 (free tournaments)
     - For paid tournaments, only service role (Stripe webhook) can insert teams

  ## Security
  - Prevents unpaid registrations for paid tournaments
  - Maintains free registration flow for free tournaments
  - Only Stripe webhook can create teams after successful payment
*/

-- Drop the existing policy that allows unrestricted anonymous inserts
DROP POLICY IF EXISTS "Anonymous users can create teams in public tournaments" ON teams;

-- Allow anonymous users to create teams ONLY in free public tournaments
CREATE POLICY "Anonymous users can create teams in free public tournaments"
  ON teams
  FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM tournaments t
      LEFT JOIN tournament_categories tc ON tc.id = teams.category_id
      WHERE t.id = teams.tournament_id
        AND t.allow_public_registration = true
        AND t.status = 'active'
        AND (
          (teams.category_id IS NULL AND (t.registration_fee IS NULL OR t.registration_fee = 0))
          OR
          (teams.category_id IS NOT NULL AND (tc.registration_fee IS NULL OR tc.registration_fee = 0))
        )
    )
  );

-- Note: For paid tournaments, the Stripe webhook uses the service role key
-- which bypasses RLS policies, allowing it to create teams after successful payment

COMMENT ON POLICY "Anonymous users can create teams in free public tournaments" ON teams IS 
  'Allows public registration only when registration_fee is 0. Paid registrations must go through Stripe webhook.';
