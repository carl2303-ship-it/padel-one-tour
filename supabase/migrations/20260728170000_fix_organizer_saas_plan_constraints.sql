-- Align organizer plan/tier constraints with Boost SaaS plans (bronze/silver/gold/platinum)
ALTER TABLE public.organizers DROP CONSTRAINT IF EXISTS organizers_subscription_plan_check;
ALTER TABLE public.organizers DROP CONSTRAINT IF EXISTS organizers_organizer_tier_check;

ALTER TABLE public.organizers
  ADD CONSTRAINT organizers_subscription_plan_check
  CHECK (subscription_plan IN (
    'free', 'basic', 'pro', 'enterprise',
    'bronze', 'silver', 'gold', 'platinum'
  ));

ALTER TABLE public.organizers
  ADD CONSTRAINT organizers_organizer_tier_check
  CHECK (organizer_tier IN ('bronze', 'silver', 'gold', 'platinum'));
