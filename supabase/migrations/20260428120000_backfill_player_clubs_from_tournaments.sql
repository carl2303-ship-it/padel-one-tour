-- Backfill player_clubs from tournament participation
-- Players who played in a tournament at a club should have that club in their player_clubs list

-- STEP 1: Backfill existing tournament participants
-- Path: players → teams → tournaments → club_id
-- We need: player_account_id (from players) + club_id (from tournaments)
INSERT INTO player_clubs (player_account_id, club_id)
SELECT DISTINCT p.player_account_id, t.club_id
FROM players p
JOIN teams tm ON (tm.player1_id = p.id OR tm.player2_id = p.id)
JOIN tournaments t ON tm.tournament_id = t.id
WHERE p.player_account_id IS NOT NULL
  AND t.club_id IS NOT NULL
ON CONFLICT (player_account_id, club_id) DO NOTHING;

-- STEP 2: Also set favorite_club_id for players who don't have one yet
-- Use the most recent tournament's club
UPDATE player_accounts pa
SET favorite_club_id = sub.club_id
FROM (
  SELECT DISTINCT ON (p.player_account_id)
    p.player_account_id,
    t.club_id
  FROM players p
  JOIN teams tm ON (tm.player1_id = p.id OR tm.player2_id = p.id)
  JOIN tournaments t ON tm.tournament_id = t.id
  WHERE p.player_account_id IS NOT NULL
    AND t.club_id IS NOT NULL
  ORDER BY p.player_account_id, t.start_date DESC
) sub
WHERE pa.id = sub.player_account_id
  AND pa.favorite_club_id IS NULL;

-- STEP 3: Create trigger function to auto-add club when player is inserted in a tournament
CREATE OR REPLACE FUNCTION auto_add_player_club_on_team_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_club_id UUID;
  v_pa_id_1 UUID;
  v_pa_id_2 UUID;
BEGIN
  -- Get the club_id from the tournament
  SELECT t.club_id INTO v_club_id
  FROM tournaments t
  WHERE t.id = NEW.tournament_id;

  IF v_club_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get player_account_ids for both players
  SELECT player_account_id INTO v_pa_id_1 FROM players WHERE id = NEW.player1_id;
  SELECT player_account_id INTO v_pa_id_2 FROM players WHERE id = NEW.player2_id;

  -- Insert into player_clubs (ignore if already exists)
  IF v_pa_id_1 IS NOT NULL THEN
    INSERT INTO player_clubs (player_account_id, club_id)
    VALUES (v_pa_id_1, v_club_id)
    ON CONFLICT (player_account_id, club_id) DO NOTHING;

    -- Set favorite_club_id if not set
    UPDATE player_accounts
    SET favorite_club_id = v_club_id
    WHERE id = v_pa_id_1 AND favorite_club_id IS NULL;
  END IF;

  IF v_pa_id_2 IS NOT NULL THEN
    INSERT INTO player_clubs (player_account_id, club_id)
    VALUES (v_pa_id_2, v_club_id)
    ON CONFLICT (player_account_id, club_id) DO NOTHING;

    UPDATE player_accounts
    SET favorite_club_id = v_club_id
    WHERE id = v_pa_id_2 AND favorite_club_id IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger on teams table
DROP TRIGGER IF EXISTS trg_auto_add_player_club_on_team ON teams;
CREATE TRIGGER trg_auto_add_player_club_on_team
  AFTER INSERT ON teams
  FOR EACH ROW
  EXECUTE FUNCTION auto_add_player_club_on_team_insert();
