/*
  # Update League Standings for Category-Based Scoring

  1. New Function
    - `calculate_league_points_for_category` - calculates points using category-specific scoring

  2. Updated Function
    - `recalculate_league_standings` - now uses category-specific scoring when available

  3. Logic
    - Determines tournament's effective category (strongest if multiple)
    - Looks up scoring system for that category in league's category_scoring_systems
    - Falls back to league's default scoring_system if not found
    - All standings go into a single unified ranking (no category separation)
*/

-- Function to calculate points using category-specific or default scoring
CREATE OR REPLACE FUNCTION calculate_league_points_for_category(
  league_uuid uuid,
  tournament_category text,
  final_position int
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  league_record RECORD;
  category_systems jsonb;
  scoring_system jsonb;
  points int;
BEGIN
  -- Get league scoring systems
  SELECT l.scoring_system, l.category_scoring_systems 
  INTO league_record
  FROM leagues l 
  WHERE l.id = league_uuid;

  -- Check if we have category-specific scoring
  category_systems := COALESCE(league_record.category_scoring_systems, '{}'::jsonb);
  
  IF tournament_category IS NOT NULL 
     AND category_systems ? tournament_category THEN
    -- Use category-specific scoring
    scoring_system := category_systems -> tournament_category;
  ELSE
    -- Fall back to default scoring system
    scoring_system := league_record.scoring_system;
  END IF;

  -- Get points for position
  points := COALESCE((scoring_system ->> final_position::text)::int, 0);
  
  RETURN points;
END;
$$;

-- Update recalculate function to use unified ranking with category scoring
CREATE OR REPLACE FUNCTION recalculate_league_standings(league_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  team_record RECORD;
  player_record RECORD;
  standing_record RECORD;
BEGIN
  -- Delete all existing standings for this league
  DELETE FROM league_standings WHERE league_id = league_uuid;

  -- Process teams in completed tournaments
  FOR team_record IN
    SELECT 
      t.id as tournament_id,
      get_strongest_category(string_to_array(t.category, ',')) as effective_category,
      tm.id as team_id,
      tm.final_position,
      p1.id as player1_id,
      p1.name as player1_name,
      p2.id as player2_id,
      p2.name as player2_name
    FROM tournaments t
    LEFT JOIN tournament_leagues tl ON tl.tournament_id = t.id AND tl.league_id = league_uuid
    JOIN teams tm ON tm.tournament_id = t.id
    LEFT JOIN players p1 ON p1.id = tm.player1_id
    LEFT JOIN players p2 ON p2.id = tm.player2_id
    WHERE (t.league_id = league_uuid OR tl.league_id = league_uuid)
      AND t.status = 'completed'
      AND tm.final_position IS NOT NULL
  LOOP
    DECLARE
      position_points int;
    BEGIN
      -- Calculate points using category-specific scoring
      position_points := calculate_league_points_for_category(
        league_uuid, 
        team_record.effective_category, 
        team_record.final_position
      );

      -- Add/update standing for player 1 (unified ranking, no category)
      IF team_record.player1_id IS NOT NULL AND team_record.player1_name IS NOT NULL THEN
        SELECT * INTO standing_record
        FROM league_standings
        WHERE league_id = league_uuid
          AND entity_type = 'player'
          AND LOWER(entity_name) = LOWER(team_record.player1_name)
          AND category IS NULL;

        IF FOUND THEN
          UPDATE league_standings
          SET 
            total_points = total_points + position_points,
            tournaments_played = tournaments_played + 1,
            best_position = LEAST(best_position, team_record.final_position),
            updated_at = now()
          WHERE id = standing_record.id;
        ELSE
          INSERT INTO league_standings (
            league_id, entity_type, entity_id, entity_name,
            total_points, tournaments_played, best_position, category
          ) VALUES (
            league_uuid, 'player', team_record.player1_id, team_record.player1_name,
            position_points, 1, team_record.final_position, NULL
          );
        END IF;
      END IF;

      -- Add/update standing for player 2
      IF team_record.player2_id IS NOT NULL AND team_record.player2_name IS NOT NULL THEN
        SELECT * INTO standing_record
        FROM league_standings
        WHERE league_id = league_uuid
          AND entity_type = 'player'
          AND LOWER(entity_name) = LOWER(team_record.player2_name)
          AND category IS NULL;

        IF FOUND THEN
          UPDATE league_standings
          SET 
            total_points = total_points + position_points,
            tournaments_played = tournaments_played + 1,
            best_position = LEAST(best_position, team_record.final_position),
            updated_at = now()
          WHERE id = standing_record.id;
        ELSE
          INSERT INTO league_standings (
            league_id, entity_type, entity_id, entity_name,
            total_points, tournaments_played, best_position, category
          ) VALUES (
            league_uuid, 'player', team_record.player2_id, team_record.player2_name,
            position_points, 1, team_record.final_position, NULL
          );
        END IF;
      END IF;
    END;
  END LOOP;

  -- Process individual players in completed tournaments
  FOR player_record IN
    SELECT 
      p.id as player_id,
      p.name as player_name,
      p.final_position,
      get_strongest_category(string_to_array(t.category, ',')) as effective_category
    FROM tournaments t
    LEFT JOIN tournament_leagues tl ON tl.tournament_id = t.id AND tl.league_id = league_uuid
    JOIN players p ON p.tournament_id = t.id
    WHERE (t.league_id = league_uuid OR tl.league_id = league_uuid)
      AND t.status = 'completed'
      AND p.final_position IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM teams tm 
        WHERE tm.tournament_id = t.id 
        AND (tm.player1_id = p.id OR tm.player2_id = p.id)
      )
  LOOP
    DECLARE
      position_points int;
    BEGIN
      position_points := calculate_league_points_for_category(
        league_uuid, 
        player_record.effective_category, 
        player_record.final_position
      );

      SELECT * INTO standing_record
      FROM league_standings
      WHERE league_id = league_uuid
        AND entity_type = 'player'
        AND LOWER(entity_name) = LOWER(player_record.player_name)
        AND category IS NULL;

      IF FOUND THEN
        UPDATE league_standings
        SET 
          total_points = total_points + position_points,
          tournaments_played = tournaments_played + 1,
          best_position = LEAST(best_position, player_record.final_position),
          updated_at = now()
        WHERE id = standing_record.id;
      ELSE
        INSERT INTO league_standings (
          league_id, entity_type, entity_id, entity_name,
          total_points, tournaments_played, best_position, category
        ) VALUES (
          league_uuid, 'player', player_record.player_id, player_record.player_name,
          position_points, 1, player_record.final_position, NULL
        );
      END IF;
    END;
  END LOOP;
END;
$$;