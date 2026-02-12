/*
  # Fix players.category_id FK from CASCADE to SET NULL

  1. Changes
    - Changes the foreign key constraint on `players.category_id` from
      `ON DELETE CASCADE` to `ON DELETE SET NULL`
    - Previously, deleting a tournament category would delete ALL players
      in that category, causing irreversible data loss
    - Now, deleting a category will set the player's category_id to NULL,
      preserving the player record

  2. Also fixes teams.player1_id and teams.player2_id from CASCADE to SET NULL
    - Previously, deleting a player would cascade-delete the entire team
    - Now, it sets the player reference to NULL instead

  3. Important Notes
    - This is a critical data safety fix
    - No data is modified by this migration, only constraint behavior changes
*/

ALTER TABLE players
  DROP CONSTRAINT IF EXISTS players_category_id_fkey,
  ADD CONSTRAINT players_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES tournament_categories(id)
    ON DELETE SET NULL;

ALTER TABLE teams
  DROP CONSTRAINT IF EXISTS teams_player1_id_fkey,
  ADD CONSTRAINT teams_player1_id_fkey
    FOREIGN KEY (player1_id) REFERENCES players(id)
    ON DELETE SET NULL;

ALTER TABLE teams
  DROP CONSTRAINT IF EXISTS teams_player2_id_fkey,
  ADD CONSTRAINT teams_player2_id_fkey
    FOREIGN KEY (player2_id) REFERENCES players(id)
    ON DELETE SET NULL;
