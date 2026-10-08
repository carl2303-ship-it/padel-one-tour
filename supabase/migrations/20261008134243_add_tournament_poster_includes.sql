-- Text for poster / WhatsApp: what is included in the entry fee
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS poster_includes text;
