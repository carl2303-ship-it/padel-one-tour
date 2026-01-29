/*
  # Add helper functions for deleting matches
  
  1. Functions
    - `delete_matches_by_category` - Deletes all matches for a specific tournament and category
    - `delete_matches_by_tournament` - Deletes all matches for a tournament
  
  2. Purpose
    - Ensure match deletions work properly by using PostgreSQL functions
    - Bypass any potential client-side caching or query building issues
*/

-- Function to delete matches by category
CREATE OR REPLACE FUNCTION delete_matches_by_category(
  p_tournament_id uuid,
  p_category_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM matches 
  WHERE tournament_id = p_tournament_id 
    AND category_id = p_category_id;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Function to delete all matches for a tournament
CREATE OR REPLACE FUNCTION delete_matches_by_tournament(
  p_tournament_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM matches 
  WHERE tournament_id = p_tournament_id;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
