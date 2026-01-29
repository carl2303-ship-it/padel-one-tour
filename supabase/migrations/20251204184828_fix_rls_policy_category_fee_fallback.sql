/*
  # Fix RLS Policy to Use Tournament Fee as Fallback

  ## Problem
  When a category has registration_fee = NULL, the current policy allows free registration
  even if the tournament itself has a registration fee. This allows users to bypass payment.

  ## Solution
  Update the RLS policy to:
  - If category_id is set AND category has a fee defined, use the category fee
  - If category_id is set BUT category has NO fee defined (NULL), use the tournament fee as fallback
  - Only allow free registration when BOTH tournament fee AND category fee are 0 or NULL

  ## Logic
  Free registration is allowed only when:
  - No category selected: tournament fee is NULL or 0
  - Category selected: COALESCE(category_fee, tournament_fee) is NULL or 0
*/

-- Drop the existing policy
DROP POLICY IF EXISTS "Anonymous users can create teams in free public tournaments" ON teams;

-- Create new policy with proper fee fallback logic
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
          COALESCE(tc.registration_fee, t.registration_fee, 0) = 0
        )
    )
  );

COMMENT ON POLICY "Anonymous users can create teams in free public tournaments" ON teams IS 
  'Allows public registration only when the effective registration fee is 0. Uses category fee if defined, otherwise falls back to tournament fee. Paid registrations must go through Stripe webhook.';
