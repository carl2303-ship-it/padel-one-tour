-- Fix players UPDATE RLS failures (500) when organizers save final_position.
-- tournament_owned_by_user was SECURITY DEFINER without search_path, so the
-- lookup of public.tournaments could fail under restricted roles → WITH CHECK false.

CREATE OR REPLACE FUNCTION public.tournament_owned_by_user(tournament_id uuid, user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tournaments t
    WHERE t.id = tournament_owned_by_user.tournament_id
      AND t.user_id = tournament_owned_by_user.user_id
  );
$$;

-- Align organizer update policy with the stable is_tournament_owner helper
DROP POLICY IF EXISTS "Users can update players for their tournaments" ON public.players;
CREATE POLICY "Users can update players for their tournaments"
  ON public.players
  FOR UPDATE
  TO authenticated
  USING (
    (user_id = auth.uid())
    OR is_tournament_owner(tournament_id)
  )
  WITH CHECK (
    (user_id = auth.uid())
    OR is_tournament_owner(tournament_id)
  );
