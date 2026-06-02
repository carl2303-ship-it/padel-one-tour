/*
  # Add venue geolocation to tournaments and player discovery

  1. Changes to tournaments:
    - venue_address (text): human-readable address for the tournament venue
    - venue_lat (numeric): latitude of the venue
    - venue_lng (numeric): longitude of the venue
    - visibility_radius_km (integer): radius in km for player discovery (default 25)

  2. Changes to player_accounts:
    - lat (numeric): player latitude
    - lng (numeric): player longitude

  3. New RPC: get_nearby_tournaments - finds tournaments within radius using Haversine formula
  4. New RPC: get_tournaments_for_contact - finds tournaments where organizer has player's phone
*/

-- Tournament venue fields
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS venue_address text,
  ADD COLUMN IF NOT EXISTS venue_lat numeric,
  ADD COLUMN IF NOT EXISTS venue_lng numeric,
  ADD COLUMN IF NOT EXISTS visibility_radius_km integer DEFAULT 25;

-- Player geolocation
ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS lat numeric,
  ADD COLUMN IF NOT EXISTS lng numeric;

-- Index for geo queries on tournaments without clubs
CREATE INDEX IF NOT EXISTS idx_tournaments_venue_geo
  ON tournaments (venue_lat, venue_lng)
  WHERE venue_lat IS NOT NULL AND venue_lng IS NOT NULL;

-- Index for phone lookups in organizer_players
CREATE INDEX IF NOT EXISTS idx_organizer_players_phone
  ON organizer_players (phone_number)
  WHERE phone_number IS NOT NULL;

-- RPC: Find nearby tournaments using Haversine formula (no PostGIS needed)
CREATE OR REPLACE FUNCTION get_nearby_tournaments(p_lat numeric, p_lng numeric)
RETURNS SETOF tournaments
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT t.* FROM tournaments t
  WHERE t.venue_lat IS NOT NULL
    AND t.venue_lng IS NOT NULL
    AND t.club_id IS NULL
    AND t.status IN ('draft', 'active', 'in_progress')
    AND t.end_date >= CURRENT_DATE
    AND t.visibility IS DISTINCT FROM 'invite_only'
    AND (
      6371 * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(p_lat)) * cos(radians(t.venue_lat))
          * cos(radians(t.venue_lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(t.venue_lat))
        ))
      )
    ) <= COALESCE(t.visibility_radius_km, 25)
$$;

-- RPC: Find tournaments where the organizer has the player's phone in their contact list
CREATE OR REPLACE FUNCTION get_tournaments_for_contact(p_phone text)
RETURNS SETOF tournaments
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT DISTINCT t.* FROM tournaments t
  JOIN organizer_players op ON op.organizer_id = t.user_id
  WHERE op.phone_number = p_phone
    AND t.status IN ('draft', 'active', 'in_progress')
    AND t.end_date >= CURRENT_DATE
    AND t.club_id IS NULL
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_nearby_tournaments(numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION get_tournaments_for_contact(text) TO authenticated;
