/*
  # Update League Standings Function for Multi-Category Support

  1. Changes
    - Modified recalculate_league_standings to handle multi-category leagues
    - When league has categories defined, standings are separated by category
    - Each tournament's contribution goes to its assigned league_category
    - Backwards compatible: leagues without categories work as before

  2. Logic for Category Assignment
    - If tournament_leagues.league_category is set, use that
    - Otherwise, determine from tournament's category field using strongest category rule
    - Single-category leagues (categories = '{}') work without category column
*/

-- Drop and recreate the function with category support
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
  league_record RECORD;
  is_multi_category boolean;
  target_category text;
BEGIN
  -- Get league info to check if multi-category
  SELECT * INTO league_record FROM leagues WHERE id = league_uuid;
  is_multi_category := league_record.categories IS NOT NULL 
                       AND array_length(league_record.categories, 1) > 0;

  -- Delete all existing standings for this league
  DELETE FROM league_standings WHERE league_id = league_uuid;

  -- Process teams in completed tournaments
  FOR team_record IN
    SELECT 
      t.id as tournament_id,
      t.category as tournament_category,
      tm.id as team_id,
      tm.final_position,
      p1.id as player1_id,
      p1.name as player1_name,
      p2.id as player2_id,
      p2.name as player2_name,
      COALESCE(tl.league_category, get_strongest_category(string_to_array(t.category, ','))) as effective_category
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
      position_points := calculate_league_points(team_record.final_position);
      
      -- Determine target category for this standing
      IF is_multi_category THEN
        target_category := team_record.effective_category;
      ELSE
        target_category := NULL;
      END IF;

      -- Add/update standing for player 1
      IF team_record.player1_id IS NOT NULL AND team_record.player1_name IS NOT NULL THEN
        SELECT * INTO standing_record
        FROM league_standings
        WHERE league_id = league_uuid
          AND entity_type = 'player'
          AND LOWER(entity_name) = LOWER(team_record.player1_name)
          AND (category IS NOT DISTINCT FROM target_category);

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
            position_points, 1, team_record.final_position, target_category
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
          AND (category IS NOT DISTINCT FROM target_category);

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
            position_points, 1, team_record.final_position, target_category
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
      t.category as tournament_category,
      COALESCE(tl.league_category, get_strongest_category(string_to_array(t.category, ','))) as effective_category
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
      position_points := calculate_league_points(player_record.final_position);
      
      IF is_multi_category THEN
        target_category := player_record.effective_category;
      ELSE
        target_category := NULL;
      END IF;

      SELECT * INTO standing_record
      FROM league_standings
      WHERE league_id = league_uuid
        AND entity_type = 'player'
        AND LOWER(entity_name) = LOWER(player_record.player_name)
        AND (category IS NOT DISTINCT FROM target_category);

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
          position_points, 1, player_record.final_position, target_category
        );
      END IF;
    END;
  END LOOP;
END;
$$;