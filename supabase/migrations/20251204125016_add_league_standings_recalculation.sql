/*
  # Add League Standings Recalculation System

  1. New Functions
    - `recalculate_league_standings(league_uuid)` - Completely rebuilds standings for a league
      * Deletes all existing standings for the league
      * Recalculates from all completed tournaments in the league
      * Uses the calculate_league_points function for scoring
      * Handles both teams and individual players
    
    - `recalculate_all_league_standings()` - Rebuilds standings for all leagues
      * Useful for data cleanup and maintenance

  2. Triggers
    - Automatically recalculates league standings when:
      * A tournament's league_id is changed
      * A tournament's status changes to 'completed'
      * This ensures standings are always accurate

  3. Benefits
    - Removing a tournament from a league automatically updates standings
    - No orphaned players in standings
    - Always reflects current state of tournaments
*/

-- Function to completely recalculate standings for a specific league
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
        -- Check if standing exists
        SELECT * INTO standing_record
        FROM league_standings
        WHERE league_id = league_uuid
          AND entity_type = 'player'
          AND entity_id = team_record.player1_id;

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
        -- Check if standing exists
        SELECT * INTO standing_record
        FROM league_standings
        WHERE league_id = league_uuid
          AND entity_type = 'player'
          AND entity_id = team_record.player2_id;

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

      -- Check if standing exists
      SELECT * INTO standing_record
      FROM league_standings
      WHERE league_id = league_uuid
        AND entity_type = 'player'
        AND entity_name = player_record.player_name;

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

-- Function to recalculate standings for all leagues
CREATE OR REPLACE FUNCTION recalculate_all_league_standings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  league_record RECORD;
BEGIN
  FOR league_record IN SELECT id FROM leagues LOOP
    PERFORM recalculate_league_standings(league_record.id);
  END LOOP;
END;
$$;

-- Trigger function to auto-recalculate when tournament league changes
CREATE OR REPLACE FUNCTION trigger_recalculate_league_standings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- If league_id changed or status changed to completed
  IF (TG_OP = 'UPDATE') THEN
    -- Recalculate old league if it existed
    IF OLD.league_id IS NOT NULL THEN
      PERFORM recalculate_league_standings(OLD.league_id);
    END IF;
    
    -- Recalculate new league if it exists
    IF NEW.league_id IS NOT NULL THEN
      PERFORM recalculate_league_standings(NEW.league_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS tournaments_league_change_trigger ON tournaments;

-- Create trigger on tournaments table
CREATE TRIGGER tournaments_league_change_trigger
  AFTER UPDATE OF league_id, status ON tournaments
  FOR EACH ROW
  EXECUTE FUNCTION trigger_recalculate_league_standings();

-- Recalculate all existing league standings with the new system
SELECT recalculate_all_league_standings();
