-- Fix RLS policy to also check member_price / non_member_price
-- Without this, players can bypass payment when only member/non-member prices are set

DROP POLICY IF EXISTS "Anonymous users can create teams in free public tournaments" ON teams;

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
          AND COALESCE(tc.member_price, t.member_price, 0) = 0
          AND COALESCE(tc.non_member_price, t.non_member_price, 0) = 0
        )
    )
  );

-- Same for players table
DROP POLICY IF EXISTS "Anonymous users can create players in free public tournaments" ON players;

CREATE POLICY "Anonymous users can create players in free public tournaments"
  ON players
  FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM tournaments t
      LEFT JOIN tournament_categories tc ON tc.id = players.category_id
      WHERE t.id = players.tournament_id
        AND t.allow_public_registration = true
        AND t.status = 'active'
        AND (
          COALESCE(tc.registration_fee, t.registration_fee, 0) = 0
          AND COALESCE(tc.member_price, t.member_price, 0) = 0
          AND COALESCE(tc.non_member_price, t.non_member_price, 0) = 0
        )
    )
  );
