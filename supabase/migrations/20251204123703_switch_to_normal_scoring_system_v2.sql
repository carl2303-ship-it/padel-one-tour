/*
  # Switch to Normal Scoring System (More Points = Better)

  1. Changes
    - Updates calculate_league_points function to award points based on placement
    - Point distribution:
      * 1st place = 25 points
      * 2nd place = 20 points
      * 3rd place = 16 points
      * 4th place = 13 points
      * 5th place = 12 points
      * 6th-16th = 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1 points respectively
    - Recalculates all existing league_standings with new scoring

  2. Notes
    - This rewards consistent participation and winning
    - Players/teams who compete more and win more accumulate more points
    - Podium positions have significant point gaps to emphasize their importance
*/

-- Drop existing function
DROP FUNCTION IF EXISTS calculate_league_points(int);

-- Recreate function with normal scoring (more points = better)
CREATE OR REPLACE FUNCTION calculate_league_points(placement_position int)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Award points based on placement (more points for better placements)
  RETURN CASE
    WHEN placement_position = 1 THEN 25
    WHEN placement_position = 2 THEN 20
    WHEN placement_position = 3 THEN 16
    WHEN placement_position = 4 THEN 13
    WHEN placement_position = 5 THEN 12
    WHEN placement_position = 6 THEN 11
    WHEN placement_position = 7 THEN 10
    WHEN placement_position = 8 THEN 9
    WHEN placement_position = 9 THEN 8
    WHEN placement_position = 10 THEN 7
    WHEN placement_position = 11 THEN 6
    WHEN placement_position = 12 THEN 5
    WHEN placement_position = 13 THEN 4
    WHEN placement_position = 14 THEN 3
    WHEN placement_position = 15 THEN 2
    WHEN placement_position = 16 THEN 1
    ELSE 0
  END;
END;
$$;

-- Recalculate all league standings with new scoring system
DO $$
DECLARE
  standing_record RECORD;
  new_points int;
BEGIN
  -- Loop through all league standings
  FOR standing_record IN 
    SELECT ls.id, ls.entity_id, ls.entity_type, ls.league_id
    FROM league_standings ls
  LOOP
    -- Calculate total points for this entity in this league
    SELECT COALESCE(SUM(calculate_league_points(
      CASE 
        WHEN standing_record.entity_type = 'team' THEN t.placement
        WHEN standing_record.entity_type = 'player' THEN ip.final_position
      END
    )), 0)
    INTO new_points
    FROM tournaments tour
    LEFT JOIN teams t ON t.tournament_id = tour.id 
      AND t.id = standing_record.entity_id 
      AND standing_record.entity_type = 'team'
    LEFT JOIN individual_players ip ON ip.tournament_id = tour.id 
      AND ip.id = standing_record.entity_id 
      AND standing_record.entity_type = 'player'
    WHERE tour.league_id = standing_record.league_id
      AND (
        (standing_record.entity_type = 'team' AND t.placement IS NOT NULL)
        OR (standing_record.entity_type = 'player' AND ip.final_position IS NOT NULL)
      );

    -- Update the standing with new total_points
    UPDATE league_standings
    SET 
      total_points = new_points,
      updated_at = now()
    WHERE id = standing_record.id;
  END LOOP;
END $$;
