-- Fix function to repair user_id for players in a specific game
-- This can be called manually to fix games where players don't see them

CREATE OR REPLACE FUNCTION fix_game_players_user_id(p_game_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_count INT := 0;
  v_player_record RECORD;
BEGIN
  -- Loop through all players in the game
  FOR v_player_record IN
    SELECT ogp.id, ogp.player_account_id, ogp.user_id, pa.user_id as account_user_id
    FROM open_game_players ogp
    LEFT JOIN player_accounts pa ON pa.id = ogp.player_account_id
    WHERE ogp.game_id = p_game_id
      AND ogp.status = 'confirmed'
  LOOP
    -- If player_account has user_id but open_game_players doesn't, update it
    IF v_player_record.account_user_id IS NOT NULL 
       AND (v_player_record.user_id IS NULL OR v_player_record.user_id != v_player_record.account_user_id) THEN
      
      UPDATE open_game_players
      SET user_id = v_player_record.account_user_id
      WHERE id = v_player_record.id;
      
      v_updated_count := v_updated_count + 1;
    END IF;
  END LOOP;
  
  RETURN json_build_object(
    'success', true,
    'updated_count', v_updated_count,
    'message', format('Updated %s player records', v_updated_count)
  );
END;
$$;

COMMENT ON FUNCTION fix_game_players_user_id(UUID) IS 'Repairs user_id for all players in a game by matching player_account_id to player_accounts.user_id';

GRANT EXECUTE ON FUNCTION fix_game_players_user_id(UUID) TO authenticated;

-- Example usage:
-- SELECT fix_game_players_user_id('4943c90e-5fb6-4477-a945-c3edfab60219');
