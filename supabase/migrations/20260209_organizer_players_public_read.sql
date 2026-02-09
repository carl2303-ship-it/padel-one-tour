-- Allow public read on organizer_players so player app can fetch player_category
DROP POLICY IF EXISTS "Public read organizer_players" ON organizer_players;
CREATE POLICY "Public read organizer_players" ON organizer_players FOR SELECT USING (true);
