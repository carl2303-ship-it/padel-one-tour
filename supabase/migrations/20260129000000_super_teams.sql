-- Super Teams Format Migration
-- Torneios com 4 jogadores por equipa, fase de grupos + eliminatórias

ALTER TABLE tournaments 
DROP CONSTRAINT IF EXISTS tournaments_format_check;

ALTER TABLE tournaments 
ADD CONSTRAINT tournaments_format_check 
CHECK (format IN ('single_elimination', 'round_robin', 'groups_knockout', 'individual_groups_knockout', 'super_teams', 'crossed_playoffs', 'mixed_gender'));

ALTER TABLE tournament_categories 
DROP CONSTRAINT IF EXISTS tournament_categories_format_check;

ALTER TABLE tournament_categories 
ADD CONSTRAINT tournament_categories_format_check 
CHECK (format IN ('single_elimination', 'round_robin', 'groups_knockout', 'individual_groups_knockout', 'super_teams', 'crossed_playoffs', 'mixed_gender'));

-- Tabela principal de Super Equipas
CREATE TABLE IF NOT EXISTS super_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id UUID REFERENCES tournament_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  captain_player_id UUID, -- Referência ao jogador que é capitão
  group_name TEXT, -- A, B, C, etc.
  registration_order INTEGER, -- Ordem de inscrição (para desempate)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Jogadores de cada Super Equipa (4 por equipa)
CREATE TABLE IF NOT EXISTS super_team_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  super_team_id UUID NOT NULL REFERENCES super_teams(id) ON DELETE CASCADE,
  player_account_id UUID REFERENCES player_accounts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone_number TEXT,
  is_captain BOOLEAN DEFAULT FALSE,
  player_order INTEGER DEFAULT 1, -- 1, 2, 3, 4
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Confrontos entre Super Equipas (contém os 2-3 jogos de cada confronto)
CREATE TABLE IF NOT EXISTS super_team_confrontations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id UUID REFERENCES tournament_categories(id) ON DELETE SET NULL, -- Categoria do confronto
  super_team_1_id UUID REFERENCES super_teams(id) ON DELETE SET NULL,
  super_team_2_id UUID REFERENCES super_teams(id) ON DELETE SET NULL,
  round TEXT, -- 'group', 'round_of_16', 'quarterfinal', 'semifinal', 'final'
  group_name TEXT, -- Para jogos de grupo
  scheduled_time TIMESTAMPTZ,
  court_name TEXT,
  status TEXT DEFAULT 'scheduled', -- 'scheduled', 'in_progress', 'completed'
  winner_super_team_id UUID REFERENCES super_teams(id) ON DELETE SET NULL,
  -- Resultado agregado
  team1_matches_won INTEGER DEFAULT 0, -- 0, 1 ou 2
  team2_matches_won INTEGER DEFAULT 0, -- 0, 1 ou 2
  has_super_tiebreak BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lineups definidas pelo capitão para cada confronto (2 duplas por equipa)
CREATE TABLE IF NOT EXISTS super_team_lineups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confrontation_id UUID NOT NULL REFERENCES super_team_confrontations(id) ON DELETE CASCADE,
  super_team_id UUID NOT NULL REFERENCES super_teams(id) ON DELETE CASCADE,
  -- Dupla 1
  duo1_player1_id UUID REFERENCES super_team_players(id) ON DELETE SET NULL,
  duo1_player2_id UUID REFERENCES super_team_players(id) ON DELETE SET NULL,
  -- Dupla 2
  duo2_player1_id UUID REFERENCES super_team_players(id) ON DELETE SET NULL,
  duo2_player2_id UUID REFERENCES super_team_players(id) ON DELETE SET NULL,
  -- Jogadores para Super Tie-Break (1 de cada dupla)
  super_tiebreak_player1_id UUID REFERENCES super_team_players(id) ON DELETE SET NULL, -- Da Dupla 1
  super_tiebreak_player2_id UUID REFERENCES super_team_players(id) ON DELETE SET NULL, -- Da Dupla 2
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Jogos individuais dentro de cada confronto (até 3 jogos: duo1 vs duo1, duo2 vs duo2, super tiebreak)
CREATE TABLE IF NOT EXISTS super_team_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confrontation_id UUID NOT NULL REFERENCES super_team_confrontations(id) ON DELETE CASCADE,
  game_type TEXT NOT NULL, -- 'duo1', 'duo2', 'super_tiebreak'
  game_order INTEGER DEFAULT 1, -- 1, 2, 3
  -- IDs das duplas/jogadores (determinados pelos lineups)
  team1_lineup_id UUID REFERENCES super_team_lineups(id) ON DELETE SET NULL,
  team2_lineup_id UUID REFERENCES super_team_lineups(id) ON DELETE SET NULL,
  -- Resultado
  team1_score TEXT, -- '6-4' ou '10-7' para super tiebreak
  team2_score TEXT,
  winner_super_team_id UUID REFERENCES super_teams(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'scheduled', -- 'scheduled', 'in_progress', 'completed'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Classificação de grupos para Super Equipas
CREATE TABLE IF NOT EXISTS super_team_standings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id UUID REFERENCES tournament_categories(id) ON DELETE SET NULL,
  super_team_id UUID NOT NULL REFERENCES super_teams(id) ON DELETE CASCADE,
  group_name TEXT,
  -- Estatísticas de confrontos
  confrontations_played INTEGER DEFAULT 0,
  confrontations_won INTEGER DEFAULT 0,
  confrontations_lost INTEGER DEFAULT 0,
  -- Estatísticas de jogos (sets)
  games_won INTEGER DEFAULT 0,
  games_lost INTEGER DEFAULT 0,
  games_diff INTEGER DEFAULT 0,
  -- Pontos (3 por vitória de confronto, 0 por derrota)
  points INTEGER DEFAULT 0,
  position INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tournament_id, super_team_id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_super_teams_tournament ON super_teams(tournament_id);
CREATE INDEX IF NOT EXISTS idx_super_teams_category ON super_teams(category_id);
CREATE INDEX IF NOT EXISTS idx_super_teams_group ON super_teams(group_name);
CREATE INDEX IF NOT EXISTS idx_super_team_players_team ON super_team_players(super_team_id);
CREATE INDEX IF NOT EXISTS idx_super_team_confrontations_tournament ON super_team_confrontations(tournament_id);
CREATE INDEX IF NOT EXISTS idx_super_team_confrontations_category ON super_team_confrontations(category_id);
CREATE INDEX IF NOT EXISTS idx_super_team_games_confrontation ON super_team_games(confrontation_id);
CREATE INDEX IF NOT EXISTS idx_super_team_standings_tournament ON super_team_standings(tournament_id);

-- RLS Policies
ALTER TABLE super_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE super_team_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE super_team_confrontations ENABLE ROW LEVEL SECURITY;
ALTER TABLE super_team_lineups ENABLE ROW LEVEL SECURITY;
ALTER TABLE super_team_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE super_team_standings ENABLE ROW LEVEL SECURITY;

-- Políticas de leitura pública (para inscrições e visualização)
CREATE POLICY "super_teams_select_all" ON super_teams FOR SELECT USING (true);
CREATE POLICY "super_team_players_select_all" ON super_team_players FOR SELECT USING (true);
CREATE POLICY "super_team_confrontations_select_all" ON super_team_confrontations FOR SELECT USING (true);
CREATE POLICY "super_team_lineups_select_all" ON super_team_lineups FOR SELECT USING (true);
CREATE POLICY "super_team_games_select_all" ON super_team_games FOR SELECT USING (true);
CREATE POLICY "super_team_standings_select_all" ON super_team_standings FOR SELECT USING (true);

-- Políticas de escrita para utilizadores autenticados
CREATE POLICY "super_teams_insert_auth" ON super_teams FOR INSERT WITH CHECK (true);
CREATE POLICY "super_teams_update_auth" ON super_teams FOR UPDATE USING (true);
CREATE POLICY "super_teams_delete_auth" ON super_teams FOR DELETE USING (true);

CREATE POLICY "super_team_players_insert_auth" ON super_team_players FOR INSERT WITH CHECK (true);
CREATE POLICY "super_team_players_update_auth" ON super_team_players FOR UPDATE USING (true);
CREATE POLICY "super_team_players_delete_auth" ON super_team_players FOR DELETE USING (true);

CREATE POLICY "super_team_confrontations_insert_auth" ON super_team_confrontations FOR INSERT WITH CHECK (true);
CREATE POLICY "super_team_confrontations_update_auth" ON super_team_confrontations FOR UPDATE USING (true);
CREATE POLICY "super_team_confrontations_delete_auth" ON super_team_confrontations FOR DELETE USING (true);

CREATE POLICY "super_team_lineups_insert_auth" ON super_team_lineups FOR INSERT WITH CHECK (true);
CREATE POLICY "super_team_lineups_update_auth" ON super_team_lineups FOR UPDATE USING (true);
CREATE POLICY "super_team_lineups_delete_auth" ON super_team_lineups FOR DELETE USING (true);

CREATE POLICY "super_team_games_insert_auth" ON super_team_games FOR INSERT WITH CHECK (true);
CREATE POLICY "super_team_games_update_auth" ON super_team_games FOR UPDATE USING (true);
CREATE POLICY "super_team_games_delete_auth" ON super_team_games FOR DELETE USING (true);

CREATE POLICY "super_team_standings_insert_auth" ON super_team_standings FOR INSERT WITH CHECK (true);
CREATE POLICY "super_team_standings_update_auth" ON super_team_standings FOR UPDATE USING (true);
CREATE POLICY "super_team_standings_delete_auth" ON super_team_standings FOR DELETE USING (true);
