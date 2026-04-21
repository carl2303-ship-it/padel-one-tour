-- Create player_clubs junction table for N:N relationship between players and clubs
CREATE TABLE IF NOT EXISTS public.player_clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_account_id UUID NOT NULL REFERENCES public.player_accounts(id) ON DELETE CASCADE,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(player_account_id, club_id)
);

ALTER TABLE public.player_clubs ENABLE ROW LEVEL SECURITY;

-- Players can see their own club associations
CREATE POLICY "Players can view own clubs"
  ON public.player_clubs FOR SELECT TO authenticated
  USING (
    player_account_id IN (
      SELECT id FROM public.player_accounts WHERE user_id = auth.uid()
    )
  );

-- Players can add themselves to clubs
CREATE POLICY "Players can insert own clubs"
  ON public.player_clubs FOR INSERT TO authenticated
  WITH CHECK (
    player_account_id IN (
      SELECT id FROM public.player_accounts WHERE user_id = auth.uid()
    )
  );

-- Players can remove themselves from clubs
CREATE POLICY "Players can delete own clubs"
  ON public.player_clubs FOR DELETE TO authenticated
  USING (
    player_account_id IN (
      SELECT id FROM public.player_accounts WHERE user_id = auth.uid()
    )
  );

-- Service role / Edge Functions can read all (for notifications)
CREATE POLICY "Service can view all player clubs"
  ON public.player_clubs FOR SELECT TO service_role
  USING (true);

-- Migrate existing favorite_club_id data
INSERT INTO public.player_clubs (player_account_id, club_id)
SELECT id, favorite_club_id
FROM public.player_accounts
WHERE favorite_club_id IS NOT NULL
ON CONFLICT (player_account_id, club_id) DO NOTHING;
