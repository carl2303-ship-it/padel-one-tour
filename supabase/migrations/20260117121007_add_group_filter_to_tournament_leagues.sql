/*
  # Add Group Filter for Mixed Tournaments
  
  1. Changes
    - Add `group_filter` column to tournament_leagues table
    - This allows filtering which players from a tournament contribute to a league
    - For mixed tournaments: group A (women) -> female league, group B (men) -> male league
  
  2. Usage
    - When group_filter is NULL: all players from tournament contribute to league
    - When group_filter is set (e.g., 'A'): only players from that group contribute
*/

ALTER TABLE tournament_leagues
ADD COLUMN IF NOT EXISTS group_filter text DEFAULT NULL;

COMMENT ON COLUMN tournament_leagues.group_filter IS 'Filter players by group_name. NULL means all players, "A" means only group A players contribute to this league.';