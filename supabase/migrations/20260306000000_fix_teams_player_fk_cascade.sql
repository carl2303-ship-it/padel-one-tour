/*
  # Fix teams.player1_id and teams.player2_id FK to ON DELETE CASCADE

  Problem:
    - Migration 20260212150016 changed the FK from ON DELETE CASCADE to ON DELETE SET NULL
    - But player1_id and player2_id have NOT NULL constraints
    - This causes: "null value in column player1_id of relation teams violates not-null constraint"
      whenever a player is deleted

  Fix:
    - Change the FK back to ON DELETE CASCADE
    - When a player is deleted, teams referencing that player are automatically deleted
    - Matches referencing those teams are also automatically deleted (matches has ON DELETE CASCADE for team FKs)
*/

-- Fix teams.player1_id FK: ON DELETE SET NULL → ON DELETE CASCADE
ALTER TABLE teams
  DROP CONSTRAINT IF EXISTS teams_player1_id_fkey,
  ADD CONSTRAINT teams_player1_id_fkey
    FOREIGN KEY (player1_id) REFERENCES players(id)
    ON DELETE CASCADE;

-- Fix teams.player2_id FK: ON DELETE SET NULL → ON DELETE CASCADE  
ALTER TABLE teams
  DROP CONSTRAINT IF EXISTS teams_player2_id_fkey,
  ADD CONSTRAINT teams_player2_id_fkey
    FOREIGN KEY (player2_id) REFERENCES players(id)
    ON DELETE CASCADE;
