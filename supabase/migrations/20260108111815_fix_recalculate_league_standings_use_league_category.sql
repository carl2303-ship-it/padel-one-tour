/*
  # Fix recalculate_league_standings to use league_category

  1. Changes
    - Update recalculate_league_standings function to use tournament_leagues.league_category
    - Instead of using tournaments.category (which is often NULL)
    - This ensures the correct category-specific scoring system is used

  2. Impact
    - Fixes scoring calculation for leagues with category-specific scoring systems
    - Players will now get correct points based on the league_category assigned when linking tournament to league
*/

CREATE OR REPLACE FUNCTION recalculate_league_standings(league_uuid UUID)
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
  DELETE FROM league_standings WHERE league_id = league_uuid;

  FOR team_record IN
    SELECT 
      t.id as tournament_id,
      COALESCE(tl.league_category, get_strongest_category(string_to_array(t.category, ','))) as effective_category,
      tm.id as team_id,
      tm.final_position,
      p1.id as player1_id,
      p1.name as player1_name,
      p2.id as player2_id,
      p2.name as player2_name
    FROM tournaments t
    JOIN tournament_leagues tl ON tl.tournament_id = t.id AND tl.league_id = league_uuid
    JOIN teams tm ON tm.tournament_id = t.id
    LEFT JOIN players p1 ON p1.id = tm.player1_id
    LEFT JOIN players p2 ON p2.id = tm.player2_id
    WHERE t.status = 'completed'
    AND tm.final_position IS NOT NULL
  LOOP
    DECLARE
      position_points int;
    BEGIN
      position_points := calculate_league_points_for_category(
        league_uuid, 
        team_record.effective_category, 
        team_record.final_position
      );

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

  FOR player_record IN
    SELECT 
      p.id as player_id,
      p.name as player_name,
      p.final_position,
      COALESCE(tl.league_category, get_strongest_category(string_to_array(t.category, ','))) as effective_category
    FROM tournaments t
    JOIN tournament_leagues tl ON tl.tournament_id = t.id AND tl.league_id = league_uuid
    JOIN players p ON p.tournament_id = t.id
    WHERE t.status = 'completed'
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
