/*
  # Fix League Standings - Case Insensitive Name Matching

  1. Changes
    - Update recalculate_league_standings to use case-insensitive name matching
    - Consolidate duplicate entries for same player with different capitalization
    - Use LOWER() for name comparisons to treat "Paulo Ferreira" and "Paulo ferreira" as same player
    
  2. Benefits
    - Players with names in different capitalizations are now treated as same person
    - Accurately combines statistics from both team tournaments and individual tournaments
    - Prevents duplicate standings entries
*/

-- Drop existing function
DROP FUNCTION IF EXISTS recalculate_league_standings(uuid);

-- Recreate function with case-insensitive matching
CREATE OR REPLACE FUNCTION recalculate_league_standings(league_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  team_record RECORD;
  player_record RECORD;
  standing_record RECORD;
BEGIN
  -- Delete all existing standings for this league
  DELETE FROM league_standings WHERE league_id = league_uuid;

  -- Recalculate from teams in completed tournaments
  FOR team_record IN
    SELECT 
      t.id as tournament_id,
      t.league_id,
      tm.id as team_id,
      tm.final_position,
      p1.id as player1_id,
      p1.name as player1_name,
      p2.id as player2_id,
      p2.name as player2_name
    FROM tournaments t
    JOIN teams tm ON tm.tournament_id = t.id
    LEFT JOIN players p1 ON p1.id = tm.player1_id
    LEFT JOIN players p2 ON p2.id = tm.player2_id
    WHERE t.league_id = league_uuid
      AND t.status = 'completed'
      AND tm.final_position IS NOT NULL
  LOOP
    -- Calculate points for this position
    DECLARE
      position_points int;
    BEGIN
      position_points := calculate_league_points(team_record.final_position);

      -- Add/update standing for player 1
      IF team_record.player1_id IS NOT NULL AND team_record.player1_name IS NOT NULL THEN
        -- Check if standing exists (case-insensitive)
        SELECT * INTO standing_record
        FROM league_standings
        WHERE league_id = league_uuid
          AND entity_type = 'player'
          AND LOWER(entity_name) = LOWER(team_record.player1_name);

        IF FOUND THEN
          -- Update existing
          UPDATE league_standings
          SET 
            total_points = total_points + position_points,
            tournaments_played = tournaments_played + 1,
            best_position = LEAST(best_position, team_record.final_position),
            updated_at = now()
          WHERE id = standing_record.id;
        ELSE
          -- Insert new
          INSERT INTO league_standings (
            league_id, entity_type, entity_id, entity_name,
            total_points, tournaments_played, best_position
          ) VALUES (
            league_uuid, 'player', team_record.player1_id, team_record.player1_name,
            position_points, 1, team_record.final_position
          );
        END IF;
      END IF;

      -- Add/update standing for player 2
      IF team_record.player2_id IS NOT NULL AND team_record.player2_name IS NOT NULL THEN
        -- Check if standing exists (case-insensitive)
        SELECT * INTO standing_record
        FROM league_standings
        WHERE league_id = league_uuid
          AND entity_type = 'player'
          AND LOWER(entity_name) = LOWER(team_record.player2_name);

        IF FOUND THEN
          -- Update existing
          UPDATE league_standings
          SET 
            total_points = total_points + position_points,
            tournaments_played = tournaments_played + 1,
            best_position = LEAST(best_position, team_record.final_position),
            updated_at = now()
          WHERE id = standing_record.id;
        ELSE
          -- Insert new
          INSERT INTO league_standings (
            league_id, entity_type, entity_id, entity_name,
            total_points, tournaments_played, best_position
          ) VALUES (
            league_uuid, 'player', team_record.player2_id, team_record.player2_name,
            position_points, 1, team_record.final_position
          );
        END IF;
      END IF;
    END;
  END LOOP;

  -- Recalculate from individual players in completed tournaments
  FOR player_record IN
    SELECT 
      ip.id as player_id,
      ip.name as player_name,
      ip.final_position,
      t.league_id
    FROM tournaments t
    JOIN individual_players ip ON ip.tournament_id = t.id
    WHERE t.league_id = league_uuid
      AND t.status = 'completed'
      AND ip.final_position IS NOT NULL
  LOOP
    -- Calculate points for this position
    DECLARE
      position_points int;
    BEGIN
      position_points := calculate_league_points(player_record.final_position);

      -- Check if standing exists (case-insensitive)
      SELECT * INTO standing_record
      FROM league_standings
      WHERE league_id = league_uuid
        AND entity_type = 'player'
        AND LOWER(entity_name) = LOWER(player_record.player_name);

      IF FOUND THEN
        -- Update existing
        UPDATE league_standings
        SET 
          total_points = total_points + position_points,
          tournaments_played = tournaments_played + 1,
          best_position = LEAST(best_position, player_record.final_position),
          updated_at = now()
        WHERE id = standing_record.id;
      ELSE
        -- Insert new (use name as identifier for individual players)
        INSERT INTO league_standings (
          league_id, entity_type, entity_id, entity_name,
          total_points, tournaments_played, best_position
        ) VALUES (
          league_uuid, 'player', player_record.player_id, player_record.player_name,
          position_points, 1, player_record.final_position
        );
      END IF;
    END;
  END LOOP;
END;
$$;

-- Recalculate all league standings with the new case-insensitive logic
SELECT recalculate_all_league_standings();
