/*
  # Consolidate duplicate player standings
  
  1. Changes
    - Merge duplicate player standings with the same name
    - Sum total points and tournaments played
    - Keep the best position (lowest number)
    - Delete duplicate records
  
  2. Notes
    - This fixes the issue where the same player appears multiple times
    - Future updates will prevent this through improved upsert logic
*/

-- Create temp table with consolidated data
CREATE TEMP TABLE consolidated_standings AS
WITH ranked_standings AS (
  SELECT 
    *,
    ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(entity_name)), league_id ORDER BY created_at ASC) as rn
  FROM league_standings
  WHERE entity_type = 'player'
),
aggregated_data AS (
  SELECT 
    LOWER(TRIM(entity_name)) as normalized_name,
    league_id,
    SUM(total_points) as sum_points,
    SUM(tournaments_played) as sum_tournaments,
    MIN(best_position) as min_position
  FROM league_standings
  WHERE entity_type = 'player'
  GROUP BY LOWER(TRIM(entity_name)), league_id
)
SELECT 
  rs.id as keep_id,
  rs.entity_id,
  rs.entity_name,
  rs.league_id,
  ad.sum_points,
  ad.sum_tournaments,
  ad.min_position
FROM ranked_standings rs
JOIN aggregated_data ad 
  ON LOWER(TRIM(rs.entity_name)) = ad.normalized_name 
  AND rs.league_id = ad.league_id
WHERE rs.rn = 1;

-- Update the records we're keeping with consolidated data
UPDATE league_standings ls
SET 
  total_points = cs.sum_points,
  tournaments_played = cs.sum_tournaments,
  best_position = cs.min_position,
  updated_at = NOW()
FROM consolidated_standings cs
WHERE ls.id = cs.keep_id;

-- Delete duplicate records (keep only the ones in consolidated_standings)
DELETE FROM league_standings
WHERE entity_type = 'player'
  AND id NOT IN (SELECT keep_id FROM consolidated_standings);

DROP TABLE consolidated_standings;
