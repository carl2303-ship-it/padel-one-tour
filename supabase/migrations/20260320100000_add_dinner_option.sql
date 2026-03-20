-- Adicionar opção de jantar aos torneios
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS has_dinner_option boolean DEFAULT false;

-- Adicionar preferência de jantar aos jogadores
ALTER TABLE players ADD COLUMN IF NOT EXISTS wants_dinner boolean DEFAULT false;
