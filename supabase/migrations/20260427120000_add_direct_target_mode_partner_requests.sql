-- Add 'direct' to the target_mode CHECK constraint on partner_match_requests
-- This allows sending a partner invite directly to a specific player by phone number

ALTER TABLE public.partner_match_requests
  DROP CONSTRAINT IF EXISTS partner_match_requests_target_mode_check;

ALTER TABLE public.partner_match_requests
  ADD CONSTRAINT partner_match_requests_target_mode_check
  CHECK (target_mode IN ('any', 'following', 'direct'));
