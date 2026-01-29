/*
  # Recalculate all league standings v2
  
  1. Purpose
    - Recalculate league standings based on corrected tournament final positions
    - Process all completed tournaments in the league
    
  2. Method
    - Clear existing standings
    - Recalculate from teams and individual players with final positions
    - Apply scoring system to determine points
*/

DO $$
DECLARE
  league_uuid uuid := '47ea3ff2-7709-4b9b-add2-9fce1ce1af00';
  scoring_sys jsonb;
  tournament_rec RECORD;
  team_rec RECORD;
  player_rec RECORD;
  points_earned int;
  actual_player_id uuid;
BEGIN
  -- Get the league scoring system
  SELECT scoring_system INTO scoring_sys
  FROM leagues
  WHERE id = league_uuid;

  -- Process all completed tournaments
  FOR tournament_rec IN 
    SELECT id, format, round_robin_type
    FROM tournaments
    WHERE league_id = league_uuid AND status = 'completed'
  LOOP
    -- Process teams (for team tournaments)
    IF tournament_rec.round_robin_type IS NULL OR tournament_rec.round_robin_type != 'individual' THEN
      FOR team_rec IN
        SELECT 
          t.final_position,
          p1.id as player1_id,
          p1.name as player1_name,
          p2.id as player2_id,
          p2.name as player2_name
        FROM teams t
        LEFT JOIN players p1 ON p1.id = t.player1_id
        LEFT JOIN players p2 ON p2.id = t.player2_id
        WHERE t.tournament_id = tournament_rec.id
          AND t.final_position IS NOT NULL
      LOOP
        -- Calculate points based on position
        points_earned := COALESCE((scoring_sys->>team_rec.final_position::text)::int, 0);
        
        -- Update player1
        IF team_rec.player1_id IS NOT NULL THEN
          INSERT INTO league_standings (
            league_id, entity_type, entity_id, entity_name,
            total_points, tournaments_played, best_position
          )
          VALUES (
            league_uuid, 'player', team_rec.player1_id, team_rec.player1_name,
            points_earned, 1, team_rec.final_position
          )
          ON CONFLICT ON CONSTRAINT league_standings_league_id_entity_type_entity_id_key
          DO UPDATE SET
            total_points = league_standings.total_points + points_earned,
            tournaments_played = league_standings.tournaments_played + 1,
            best_position = LEAST(league_standings.best_position, team_rec.final_position),
            updated_at = NOW();
        END IF;

        -- Update player2
        IF team_rec.player2_id IS NOT NULL THEN
          INSERT INTO league_standings (
            league_id, entity_type, entity_id, entity_name,
            total_points, tournaments_played, best_position
          )
          VALUES (
            league_uuid, 'player', team_rec.player2_id, team_rec.player2_name,
            points_earned, 1, team_rec.final_position
          )
          ON CONFLICT ON CONSTRAINT league_standings_league_id_entity_type_entity_id_key
          DO UPDATE SET
            total_points = league_standings.total_points + points_earned,
            tournaments_played = league_standings.tournaments_played + 1,
            best_position = LEAST(league_standings.best_position, team_rec.final_position),
            updated_at = NOW();
        END IF;
      END LOOP;
    END IF;

    -- Process individual players (for individual tournaments)
    IF tournament_rec.round_robin_type = 'individual' THEN
      FOR player_rec IN
        SELECT 
          ip.id as player_id,
          ip.name as player_name,
          ip.final_position
        FROM individual_players ip
        WHERE ip.tournament_id = tournament_rec.id
          AND ip.final_position IS NOT NULL
      LOOP
        -- Calculate points based on position
        points_earned := COALESCE((scoring_sys->>player_rec.final_position::text)::int, 0);
        
        -- Find existing player by name
        SELECT id INTO actual_player_id
        FROM players
        WHERE name ILIKE player_rec.player_name
        LIMIT 1;
        
        -- If no player found, try to match by individual_player id
        IF actual_player_id IS NULL THEN
          SELECT p.id INTO actual_player_id
          FROM players p
          WHERE p.id = player_rec.player_id;
        END IF;
        
        -- Create player if still not found
        IF actual_player_id IS NULL THEN
          INSERT INTO players (name)
          VALUES (player_rec.player_name)
          RETURNING id INTO actual_player_id;
        END IF;
        
        IF actual_player_id IS NOT NULL THEN
          INSERT INTO league_standings (
            league_id, entity_type, entity_id, entity_name,
            total_points, tournaments_played, best_position
          )
          VALUES (
            league_uuid, 'player', actual_player_id, player_rec.player_name,
            points_earned, 1, player_rec.final_position
          )
          ON CONFLICT ON CONSTRAINT league_standings_league_id_entity_type_entity_id_key
          DO UPDATE SET
            total_points = league_standings.total_points + points_earned,
            tournaments_played = league_standings.tournaments_played + 1,
            best_position = LEAST(league_standings.best_position, player_rec.final_position),
            updated_at = NOW();
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;
