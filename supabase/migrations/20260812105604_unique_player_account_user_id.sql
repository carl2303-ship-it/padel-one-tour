/*
  # Enforce 1:1 between auth.users and player_accounts.user_id

  ## Problem
  Multiple player_accounts rows shared the same auth user_id. The Player app
  loads open games / profile data by auth.uid(), so one login showed another
  player's games and profile data.

  ## Changes
  1. Deduplicate existing rows: keep the account that best matches the auth
     user's phone / display name / email; clear user_id on the others.
  2. Clear emails that were wrongly copied onto the unlinked accounts when
     they still equal the kept account's auth email.
  3. Add a UNIQUE partial index so one auth user can only map to one
     player_accounts row going forward.
*/

-- Prefer the player_account whose phone matches auth.users.phone / metadata,
-- then display_name, then email. Unlink the rest.
WITH ranked AS (
  SELECT
    pa.id AS player_account_id,
    pa.user_id,
    pa.email AS pa_email,
    pa.phone_number,
    pa.name,
    u.email AS auth_email,
    ROW_NUMBER() OVER (
      PARTITION BY pa.user_id
      ORDER BY
        CASE
          WHEN NULLIF(regexp_replace(COALESCE(pa.phone_number, ''), '\D', '', 'g'), '') IS NOT NULL
           AND (
             regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g')
               LIKE '%' || RIGHT(regexp_replace(pa.phone_number, '\D', '', 'g'), 9)
             OR regexp_replace(COALESCE(u.raw_user_meta_data->>'phone_number', ''), '\D', '', 'g')
               LIKE '%' || RIGHT(regexp_replace(pa.phone_number, '\D', '', 'g'), 9)
           )
          THEN 0 ELSE 1
        END,
        CASE
          WHEN lower(COALESCE(u.raw_user_meta_data->>'display_name', '')) <> ''
           AND lower(COALESCE(pa.name, '')) <> ''
           AND lower(u.raw_user_meta_data->>'display_name') LIKE '%' || lower(split_part(pa.name, ' ', 1)) || '%'
          THEN 0 ELSE 1
        END,
        CASE
          WHEN lower(COALESCE(pa.email, '')) <> ''
           AND lower(COALESCE(u.email, '')) = lower(pa.email)
          THEN 0 ELSE 1
        END,
        pa.created_at ASC NULLS LAST,
        pa.id ASC
    ) AS rn
  FROM public.player_accounts pa
  JOIN auth.users u ON u.id = pa.user_id
  WHERE pa.user_id IS NOT NULL
),
dupes AS (
  SELECT * FROM ranked
  WHERE user_id IN (
    SELECT user_id
    FROM public.player_accounts
    WHERE user_id IS NOT NULL
    GROUP BY user_id
    HAVING COUNT(*) > 1
  )
),
unlinked AS (
  UPDATE public.player_accounts pa
  SET
    user_id = NULL,
    email = CASE
      WHEN d.pa_email IS NOT NULL
       AND d.auth_email IS NOT NULL
       AND lower(d.pa_email) = lower(d.auth_email)
      THEN regexp_replace(COALESCE(pa.phone_number, ''), '\D', '', 'g') || '@boostpadel.app'
      ELSE pa.email
    END,
    updated_at = now()
  FROM dupes d
  WHERE pa.id = d.player_account_id
    AND d.rn > 1
  RETURNING pa.id
)
SELECT count(*) AS unlinked_player_accounts FROM unlinked;

CREATE UNIQUE INDEX IF NOT EXISTS player_accounts_user_id_unique
  ON public.player_accounts (user_id)
  WHERE user_id IS NOT NULL;
