
/*
  # Adjust Inverse Scoring System with Podium Emphasis
  
  Updates the scoring system to give more importance to podium positions:
  - 1st place = 1 point
  - 2nd place = 3 points
  - 3rd place = 5 points
  - 4th place = 6 points
  - 5th place = 7 points
  - etc. (increases by 1 from 4th onwards)
  
  This creates bigger gaps between podium positions while keeping the rest simple.
*/

-- Generate new scoring system with podium emphasis
DO $$
DECLARE
  new_scoring jsonb;
  i integer;
BEGIN
  -- Start with empty object
  new_scoring := '{}'::jsonb;
  
  -- Special podium positions
  new_scoring := new_scoring || '{"1": 1, "2": 3, "3": 5}'::jsonb;
  
  -- From 4th onwards: 6, 7, 8, 9, ... up to 100
  FOR i IN 4..100 LOOP
    new_scoring := new_scoring || jsonb_build_object(i::text, i + 2);
  END LOOP;
  
  -- Update all existing leagues
  UPDATE leagues 
  SET scoring_system = new_scoring,
      updated_at = now();
END $$;

-- Update default for new leagues
ALTER TABLE leagues 
ALTER COLUMN scoring_system 
SET DEFAULT '{"1": 1, "2": 3, "3": 5, "4": 6, "5": 7, "6": 8, "7": 9, "8": 10, "9": 11, "10": 12, "11": 13, "12": 14, "13": 15, "14": 16, "15": 17, "16": 18, "17": 19, "18": 20, "19": 21, "20": 22, "21": 23, "22": 24, "23": 25, "24": 26, "25": 27, "26": 28, "27": 29, "28": 30, "29": 31, "30": 32, "31": 33, "32": 34}'::jsonb;

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
