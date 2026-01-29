/*
  # Fix Function Search Path Security Issues

  1. Security Updates
    - Set explicit search_path for all SECURITY DEFINER functions
    - This prevents potential security vulnerabilities from search_path manipulation
    
  2. Changes
    - Update `delete_matches_by_category` function with secure search_path
    - Update `delete_matches_by_tournament` function with secure search_path
*/

-- Function to delete matches by category (with secure search_path)
CREATE OR REPLACE FUNCTION delete_matches_by_category(
  p_tournament_id uuid,
  p_category_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- Function to delete all matches for a tournament (with secure search_path)
CREATE OR REPLACE FUNCTION delete_matches_by_tournament(
  p_tournament_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
