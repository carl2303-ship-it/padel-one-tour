-- Venues (clubs) that an independent organizer can use across tournaments.
-- Optional link to public.clubs for discovery; courts are per venue.

CREATE TABLE IF NOT EXISTS public.organizer_venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  club_id uuid REFERENCES public.clubs(id) ON DELETE SET NULL,
  name text NOT NULL,
  address text,
  city text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organizer_venues_user_id_idx ON public.organizer_venues(user_id);
CREATE INDEX IF NOT EXISTS organizer_venues_club_id_idx ON public.organizer_venues(club_id);

CREATE TABLE IF NOT EXISTS public.organizer_venue_courts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.organizer_venues(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organizer_venue_courts_venue_id_idx ON public.organizer_venue_courts(venue_id);

ALTER TABLE public.organizer_venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizer_venue_courts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizer_venues_select ON public.organizer_venues;
CREATE POLICY organizer_venues_select ON public.organizer_venues
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS organizer_venues_insert ON public.organizer_venues;
CREATE POLICY organizer_venues_insert ON public.organizer_venues
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS organizer_venues_update ON public.organizer_venues;
CREATE POLICY organizer_venues_update ON public.organizer_venues
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS organizer_venues_delete ON public.organizer_venues;
CREATE POLICY organizer_venues_delete ON public.organizer_venues
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS organizer_venue_courts_select ON public.organizer_venue_courts;
CREATE POLICY organizer_venue_courts_select ON public.organizer_venue_courts
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS organizer_venue_courts_insert ON public.organizer_venue_courts;
CREATE POLICY organizer_venue_courts_insert ON public.organizer_venue_courts
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organizer_venues v
      WHERE v.id = venue_id AND v.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS organizer_venue_courts_update ON public.organizer_venue_courts;
CREATE POLICY organizer_venue_courts_update ON public.organizer_venue_courts
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organizer_venues v
      WHERE v.id = venue_id AND v.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organizer_venues v
      WHERE v.id = venue_id AND v.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS organizer_venue_courts_delete ON public.organizer_venue_courts;
CREATE POLICY organizer_venue_courts_delete ON public.organizer_venue_courts
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organizer_venues v
      WHERE v.id = venue_id AND v.user_id = auth.uid()
    )
  );

-- Allow authenticated organizers to insert lightweight directory clubs (no owner)
-- used as venues, without becoming "club owners" in App.tsx.
DROP POLICY IF EXISTS "Organizers can insert directory clubs" ON public.clubs;
CREATE POLICY "Organizers can insert directory clubs" ON public.clubs
  FOR INSERT TO authenticated
  WITH CHECK (owner_id IS NULL AND coalesce(is_managed, false) = false);
