-- Allow invite_only club_league tournaments to be visible in Padel1
-- when the logged-in player is on a club league roster.

CREATE OR REPLACE FUNCTION public.is_player_enrolled_in_tournament(tournament_uuid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM players p
    JOIN player_accounts pa ON pa.id = p.player_account_id
    WHERE p.tournament_id = tournament_uuid
    AND pa.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM players p
    JOIN player_accounts pa ON pa.user_id = auth.uid()
    WHERE p.tournament_id = tournament_uuid
    AND pa.phone_number IS NOT NULL
    AND p.phone_number IS NOT NULL
    AND normalize_phone(p.phone_number) = normalize_phone(pa.phone_number)
  )
  OR EXISTS (
    SELECT 1 FROM players p
    JOIN player_accounts pa ON pa.user_id = auth.uid()
    WHERE p.tournament_id = tournament_uuid
    AND pa.name IS NOT NULL
    AND p.name ILIKE pa.name
  )
  OR EXISTS (
    SELECT 1 FROM teams t
    JOIN players p1 ON (t.player1_id = p1.id OR t.player2_id = p1.id)
    JOIN player_accounts pa ON pa.id = p1.player_account_id
    WHERE t.tournament_id = tournament_uuid
    AND pa.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM teams t
    JOIN players p1 ON (t.player1_id = p1.id OR t.player2_id = p1.id)
    JOIN player_accounts pa ON pa.user_id = auth.uid()
    WHERE t.tournament_id = tournament_uuid
    AND pa.name IS NOT NULL
    AND p1.name ILIKE pa.name
  )
  OR EXISTS (
    SELECT 1
    FROM club_league_players clp
    JOIN club_league_teams clt ON clt.id = clp.team_id
    JOIN player_accounts pa ON pa.id = clp.player_account_id
    WHERE clt.tournament_id = tournament_uuid
    AND pa.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM club_league_players clp
    JOIN club_league_teams clt ON clt.id = clp.team_id
    JOIN player_accounts pa ON pa.user_id = auth.uid()
    WHERE clt.tournament_id = tournament_uuid
    AND pa.phone_number IS NOT NULL
    AND clp.phone_number IS NOT NULL
    AND normalize_phone(clp.phone_number) = normalize_phone(pa.phone_number)
  );
$function$;

-- Normalize existing club league phones to E.164 and link player accounts
UPDATE club_league_players clp
SET phone_number = CASE
  WHEN clp.phone_number ~ '^\+3519[1236][0-9]{7}$' THEN clp.phone_number
  WHEN regexp_replace(clp.phone_number, '\D', '', 'g') ~ '^9[1236][0-9]{7}$'
    THEN '+351' || regexp_replace(clp.phone_number, '\D', '', 'g')
  WHEN regexp_replace(clp.phone_number, '\D', '', 'g') ~ '^3519[1236][0-9]{7}$'
    THEN '+' || regexp_replace(clp.phone_number, '\D', '', 'g')
  ELSE clp.phone_number
END
WHERE clp.phone_number IS NOT NULL
  AND clp.phone_number !~ '^\+';

UPDATE club_league_players clp
SET player_account_id = pa.id
FROM player_accounts pa
WHERE clp.player_account_id IS NULL
  AND pa.phone_number IS NOT NULL
  AND clp.phone_number IS NOT NULL
  AND normalize_phone(clp.phone_number) = normalize_phone(pa.phone_number);
