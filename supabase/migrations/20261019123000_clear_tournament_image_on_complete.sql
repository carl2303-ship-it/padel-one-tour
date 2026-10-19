-- When a tournament is finalized, drop image_url so completed lists don't keep the photo.
-- Storage object removal is handled in the app (deleteTournamentImage) on finalize.

CREATE OR REPLACE FUNCTION public.clear_tournament_image_on_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed'
     AND (OLD.status IS DISTINCT FROM 'completed')
     AND NEW.image_url IS NOT NULL
     AND NEW.image_url <> '' THEN
    NEW.image_url := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_tournament_image_on_complete ON public.tournaments;
CREATE TRIGGER trg_clear_tournament_image_on_complete
  BEFORE UPDATE OF status ON public.tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_tournament_image_on_complete();
