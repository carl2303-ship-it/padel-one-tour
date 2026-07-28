-- Distinguish Padel1 HQ organizers from Boost SaaS Tour licenses
ALTER TABLE public.organizers
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'padel1'
  CHECK (source IN ('padel1', 'boost'));

-- Backfill Boost SaaS organizers (provisioned via boost_saas metadata)
UPDATE public.organizers o
SET source = 'boost'
FROM auth.users u
WHERE o.user_id = u.id
  AND COALESCE(u.raw_user_meta_data->>'source', '') = 'boost_saas';
