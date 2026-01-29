/*
  # Fix teams INSERT policy for authenticated players

  1. Problem
    - Current policy only allows anonymous users to create teams in public tournaments
    - When a player logs in, they become authenticated and cannot create teams

  2. Solution
    - Add a new policy allowing authenticated users to create teams in public tournaments
    - This enables players to register teams after logging in

  3. Security
    - Only allows inserts in tournaments with public registration enabled
    - Only allows inserts in active tournaments
    - Only allows inserts when registration fee is 0 (free)
*/

CREATE POLICY "Authenticated players can create teams in free public tournaments"
  ON teams
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM tournaments t
      LEFT JOIN tournament_categories tc ON tc.id = teams.category_id
      WHERE t.id = teams.tournament_id
        AND t.allow_public_registration = true
        AND t.status = 'active'
        AND COALESCE(tc.registration_fee, t.registration_fee, 0) = 0
    )
  );
