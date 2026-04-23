-- REVERT: remove broken RLS policies that cause 500 errors on tournaments
DROP POLICY IF EXISTS "Invited players can view tournament" ON tournaments;
DROP POLICY IF EXISTS "Invited players can view tournament categories" ON tournament_categories;
DROP POLICY IF EXISTS "Invited players can view tournament players" ON players;
DROP POLICY IF EXISTS "Invited players can view tournament teams" ON teams;
DROP POLICY IF EXISTS "Invited players can view tournament matches" ON matches;
