
/*
  # Switch to Inverse Scoring System (Golf-style)
  
  Changes the league scoring system from "more points = better" to "fewer points = better" (like golf).
  This allows unlimited participants in tournaments without running out of points.
  
  1. Changes
    - Update default scoring_system to use position as points (1st = 1pt, 2nd = 2pts, etc.)
    - Create helper function to calculate points based on position
    - Recalculate all existing league standings with new system
    - Note: Ordering will be changed in frontend to show lowest points first
  
  2. Benefits
    - Unlimited tournament participants (no point ceiling)
    - Simpler logic (position = points)
    - Scales infinitely
*/

-- Function to generate inverse scoring system
-- Returns the position number as points (1st place = 1 point, 2nd = 2, etc.)
CREATE OR REPLACE FUNCTION get_inverse_points(pos integer)
RETURNS integer AS $$
BEGIN
  RETURN pos;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Update all existing leagues to use inverse scoring
-- Generate a scoring system with positions 1-100 (should be more than enough)
DO $$
DECLARE
  new_scoring jsonb;
  i integer;
BEGIN
  -- Build scoring system: {1: 1, 2: 2, 3: 3, ..., 100: 100}
  new_scoring := '{}'::jsonb;
  FOR i IN 1..100 LOOP
    new_scoring := new_scoring || jsonb_build_object(i::text, i);
  END LOOP;
  
  -- Update all leagues
  UPDATE leagues 
  SET scoring_system = new_scoring,
      updated_at = now();
END $$;

-- Recalculate all league standings with new scoring system
DO $$
DECLARE
  league_rec RECORD;
  tournament_rec RECORD;
  team_rec RECORD;
  player_rec RECORD;
  new_points integer;
BEGIN
  -- Clear all existing standings
  DELETE FROM league_standings;
  
  -- For each league
  FOR league_rec IN SELECT id, scoring_system FROM leagues LOOP
    
    -- For each completed tournament in this league
    FOR tournament_rec IN 
      SELECT id FROM tournaments 
      WHERE league_id = league_rec.id 
      AND status = 'completed'
    LOOP
      
      -- Process teams with final positions
      FOR team_rec IN
        SELECT 
          t.final_position,
          p1.id as p1_id, p1.name as p1_name,
          p2.id as p2_id, p2.name as p2_name
        FROM teams t
        LEFT JOIN players p1 ON p1.id = t.player1_id
        LEFT JOIN players p2 ON p2.id = t.player2_id
        WHERE t.tournament_id = tournament_rec.id
        AND t.final_position IS NOT NULL
      LOOP
        new_points := (league_rec.scoring_system->>team_rec.final_position::text)::integer;
        
        -- Update or insert player 1 standing
        IF team_rec.p1_id IS NOT NULL AND team_rec.p1_name IS NOT NULL THEN
          INSERT INTO league_standings (
            league_id, entity_type, entity_id, entity_name,
            total_points, tournaments_played, best_position
          )
          VALUES (
            league_rec.id, 'player', team_rec.p1_id, team_rec.p1_name,
            new_points, 1, team_rec.final_position
          )
          ON CONFLICT (league_id, entity_type, entity_id) 
          DO UPDATE SET
            total_points = league_standings.total_points + new_points,
            tournaments_played = league_standings.tournaments_played + 1,
            best_position = LEAST(league_standings.best_position, team_rec.final_position),
            updated_at = now();
        END IF;
        
        -- Update or insert player 2 standing
        IF team_rec.p2_id IS NOT NULL AND team_rec.p2_name IS NOT NULL THEN
          INSERT INTO league_standings (
            league_id, entity_type, entity_id, entity_name,
            total_points, tournaments_played, best_position
          )
          VALUES (
            league_rec.id, 'player', team_rec.p2_id, team_rec.p2_name,
            new_points, 1, team_rec.final_position
          )
          ON CONFLICT (league_id, entity_type, entity_id) 
          DO UPDATE SET
            total_points = league_standings.total_points + new_points,
            tournaments_played = league_standings.tournaments_played + 1,
            best_position = LEAST(league_standings.best_position, team_rec.final_position),
            updated_at = now();
        END IF;
      END LOOP;
      
      -- Process individual players with final positions
      FOR player_rec IN
        SELECT id, name, final_position
        FROM individual_players
        WHERE tournament_id = tournament_rec.id
        AND final_position IS NOT NULL
      LOOP
        new_points := (league_rec.scoring_system->>player_rec.final_position::text)::integer;
        
        -- Find or create player in players table by name
        DECLARE
          found_player_id uuid;
        BEGIN
          SELECT id INTO found_player_id
          FROM players
          WHERE LOWER(TRIM(name)) = LOWER(TRIM(player_rec.name))
          LIMIT 1;
          
          IF found_player_id IS NULL THEN
            INSERT INTO players (name)
            VALUES (TRIM(player_rec.name))
            RETURNING id INTO found_player_id;
          END IF;
          
          -- Update or insert standing
          INSERT INTO league_standings (
            league_id, entity_type, entity_id, entity_name,
            total_points, tournaments_played, best_position
          )
          VALUES (
            league_rec.id, 'player', found_player_id, TRIM(player_rec.name),
            new_points, 1, player_rec.final_position
          )
          ON CONFLICT (league_id, entity_type, entity_id) 
          DO UPDATE SET
            total_points = league_standings.total_points + new_points,
            tournaments_played = league_standings.tournaments_played + 1,
            best_position = LEAST(league_standings.best_position, player_rec.final_position),
            updated_at = now();
        END;
      END LOOP;
      
    END LOOP;
  END LOOP;
END $$;

-- Update the default value for future leagues
ALTER TABLE leagues 
ALTER COLUMN scoring_system 
SET DEFAULT '{"1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "11": 11, "12": 12, "13": 13, "14": 14, "15": 15, "16": 16, "17": 17, "18": 18, "19": 19, "20": 20, "21": 21, "22": 22, "23": 23, "24": 24, "25": 25, "26": 26, "27": 27, "28": 28, "29": 29, "30": 30, "31": 31, "32": 32}'::jsonb;
