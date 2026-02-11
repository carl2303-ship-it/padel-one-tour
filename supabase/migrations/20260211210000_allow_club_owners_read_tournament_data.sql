/*
  # Allow club owners to read tournament data linked to their club

  When a tournament is linked to a club (via club_id), the club owner needs to:
  - View the tournament details
  - View tournament categories
  - View and update players (for payment management)
  
  This fixes the issue where clicking a tournament booking in the Manager calendar
  fails to open the tournament details modal because RLS blocks reading.
*/

-- Allow club owners to view tournaments linked to their club
DROP POLICY IF EXISTS "Club owners can view linked tournaments" ON tournaments;
CREATE POLICY "Club owners can view linked tournaments"
  ON tournaments FOR SELECT
  TO authenticated
  USING (
    club_id IS NOT NULL 
    AND EXISTS (
      SELECT 1 FROM clubs 
      WHERE clubs.id = tournaments.club_id 
      AND clubs.owner_id = auth.uid()
    )
  );

-- Allow club owners to view categories of tournaments linked to their club
DROP POLICY IF EXISTS "Club owners can view linked tournament categories" ON tournament_categories;
CREATE POLICY "Club owners can view linked tournament categories"
  ON tournament_categories FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tournaments t
      JOIN clubs c ON c.id = t.club_id
      WHERE t.id = tournament_categories.tournament_id
      AND c.owner_id = auth.uid()
    )
  );

-- Allow club owners to view players in tournaments linked to their club
DROP POLICY IF EXISTS "Club owners can view linked tournament players" ON players;
CREATE POLICY "Club owners can view linked tournament players"
  ON players FOR SELECT
  TO authenticated
  USING (
    tournament_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM tournaments t
      JOIN clubs c ON c.id = t.club_id
      WHERE t.id = players.tournament_id
      AND c.owner_id = auth.uid()
    )
  );

-- Allow club owners to update player payment_status in tournaments linked to their club
DROP POLICY IF EXISTS "Club owners can update linked tournament players" ON players;
CREATE POLICY "Club owners can update linked tournament players"
  ON players FOR UPDATE
  TO authenticated
  USING (
    tournament_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM tournaments t
      JOIN clubs c ON c.id = t.club_id
      WHERE t.id = players.tournament_id
      AND c.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    tournament_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM tournaments t
      JOIN clubs c ON c.id = t.club_id
      WHERE t.id = players.tournament_id
      AND c.owner_id = auth.uid()
    )
  );
