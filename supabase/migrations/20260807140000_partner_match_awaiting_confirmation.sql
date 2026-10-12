-- Partner match: awaiting confirmation + registration_source on teams

-- 1) Allow request status awaiting_confirmation
ALTER TABLE partner_match_requests DROP CONSTRAINT IF EXISTS partner_match_requests_status_check;
ALTER TABLE partner_match_requests
  ADD CONSTRAINT partner_match_requests_status_check
  CHECK (status = ANY (ARRAY['open'::text, 'awaiting_confirmation'::text, 'matched'::text, 'cancelled'::text, 'expired'::text]));

-- 2) Track how the team was registered
ALTER TABLE teams ADD COLUMN IF NOT EXISTS registration_source text;
COMMENT ON COLUMN teams.registration_source IS 'manual | partner_match | stripe | organizer';

-- 3) Store min/max level filter on the request for audit
ALTER TABLE partner_match_requests ADD COLUMN IF NOT EXISTS min_level numeric;
ALTER TABLE partner_match_requests ADD COLUMN IF NOT EXISTS max_level numeric;
