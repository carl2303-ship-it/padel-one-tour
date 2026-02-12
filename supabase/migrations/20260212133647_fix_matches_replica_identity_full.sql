/*
  # Fix matches table replica identity for Realtime

  1. Changes
    - Sets REPLICA IDENTITY FULL on `matches` table
    - This ensures all columns are available in Realtime change events
    - Without this, UPDATE events only contain the primary key, so filters
      like `tournament_id=eq.X` cannot be evaluated server-side

  2. Important Notes
    - Required for Supabase Realtime postgres_changes subscriptions with filters
    - The Live TV page depends on filtering by tournament_id
*/

ALTER TABLE matches REPLICA IDENTITY FULL;
