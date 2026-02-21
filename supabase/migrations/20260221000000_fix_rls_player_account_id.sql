/*
  # Fix RLS: Add player_account_id check to is_player_enrolled_in_tournament
  
  ## Problem
  The is_player_enrolled_in_tournament function only checks phone_number and name,
  but many players are now linked via player_account_id (from the trigger).
  If phone formats don't match exactly, the function fails, blocking access to matches.
  
  ## Solution
  Add player_account_id as the PRIMARY check (most reliable).
  Keep phone and name as fallbacks.
*/

CREATE OR REPLACE FUNCTION is_player_enrolled_in_tournament(tournament_uuid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    -- Priority 1: Check via player_account_id (most reliable)
    SELECT 1 FROM players p
    JOIN player_accounts pa ON pa.id = p.player_account_id
    WHERE p.tournament_id = tournament_uuid
    AND pa.user_id = auth.uid()
  )
  OR EXISTS (
    -- Priority 2: Check via normalized phone number
    SELECT 1 FROM players p
    JOIN player_accounts pa ON pa.user_id = auth.uid()
    WHERE p.tournament_id = tournament_uuid
    AND pa.phone_number IS NOT NULL
    AND p.phone_number IS NOT NULL
    AND normalize_phone(p.phone_number) = normalize_phone(pa.phone_number)
  )
  OR EXISTS (
    -- Priority 3: Check via name in players
    SELECT 1 FROM players p
    JOIN player_accounts pa ON pa.user_id = auth.uid()
    WHERE p.tournament_id = tournament_uuid
    AND pa.name IS NOT NULL
    AND p.name ILIKE pa.name
  )
  OR EXISTS (
    -- Priority 4: Check via player_account_id in teams
    SELECT 1 FROM teams t
    JOIN players p1 ON (t.player1_id = p1.id OR t.player2_id = p1.id)
    JOIN player_accounts pa ON pa.id = p1.player_account_id
    WHERE t.tournament_id = tournament_uuid
    AND pa.user_id = auth.uid()
  )
  OR EXISTS (
    -- Priority 5: Check via name in teams
    SELECT 1 FROM teams t
    JOIN players p1 ON (t.player1_id = p1.id OR t.player2_id = p1.id)
    JOIN player_accounts pa ON pa.user_id = auth.uid()
    WHERE t.tournament_id = tournament_uuid
    AND pa.name IS NOT NULL
    AND p1.name ILIKE pa.name
  );
$$;
