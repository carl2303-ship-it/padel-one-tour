-- Speed up tournament_categories SELECT under large IN(...) filters.

DROP POLICY IF EXISTS "Enrolled players can view tournament categories" ON public.tournament_categories;
CREATE POLICY "Enrolled players can view tournament categories"
  ON public.tournament_categories
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM player_accounts pa
      JOIN players p ON p.player_account_id = pa.id
      WHERE pa.user_id = (SELECT auth.uid())
        AND p.tournament_id = tournament_categories.tournament_id
    )
  );

DROP POLICY IF EXISTS "Users can view categories in their tournaments" ON public.tournament_categories;
CREATE POLICY "Users can view categories in their tournaments"
  ON public.tournament_categories
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM tournaments
      WHERE tournaments.id = tournament_categories.tournament_id
        AND tournaments.user_id = (SELECT auth.uid())
    )
  );
