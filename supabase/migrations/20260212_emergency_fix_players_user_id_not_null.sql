/*
  # EMERGENCY FIX: Remove NOT NULL constraint on players.user_id
  
  The migration 20251112123950_add_user_id_to_players_and_fix_rls_v2.sql 
  set user_id as NOT NULL. This prevents:
  - Anonymous player registration (public tournaments)
  - Organizer adding players manually (user_id = null)
  - Individual tournament player registration
  
  This migration:
  1. Drops the NOT NULL constraint on players.user_id
  2. Ensures the DEFAULT is removed (individual players should have user_id = NULL)
  3. Does NOT delete any data
*/

-- Step 1: Remove NOT NULL constraint
ALTER TABLE players ALTER COLUMN user_id DROP NOT NULL;

-- Step 2: Remove the DEFAULT auth.uid() — individual players should explicitly set user_id or leave NULL
ALTER TABLE players ALTER COLUMN user_id DROP DEFAULT;

-- Step 3: Ensure the foreign key still exists (ON DELETE CASCADE)
-- This is just a safety check — if it already exists, the DO block does nothing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'players_user_id_fkey' 
    AND table_name = 'players'
  ) THEN
    ALTER TABLE players ADD CONSTRAINT players_user_id_fkey 
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;
