/*
  # Drop ghost individual_players table

  The individual_players table should have been dropped by migration
  20251215104147_consolidate_players_tables.sql but still exists as an
  empty table with CASCADE DELETE foreign keys.

  1. Changes
    - Drop FK constraints on individual_players
    - Drop the individual_players table
    - Drop associated RLS policies

  2. Important Notes
    - The table is empty (0 rows) so no data is lost
    - Removing it eliminates a ghost table with dangerous CASCADE FKs
*/

-- Drop FK constraints first
ALTER TABLE individual_players DROP CONSTRAINT IF EXISTS individual_players_tournament_id_fkey;
ALTER TABLE individual_players DROP CONSTRAINT IF EXISTS individual_players_category_id_fkey;
ALTER TABLE individual_players DROP CONSTRAINT IF EXISTS individual_players_payment_transaction_id_fkey;

-- Drop the table
DROP TABLE IF EXISTS individual_players;
