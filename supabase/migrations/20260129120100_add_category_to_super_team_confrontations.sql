-- Adicionar coluna category_id à tabela super_team_confrontations
ALTER TABLE super_team_confrontations 
ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES tournament_categories(id) ON DELETE SET NULL;

-- Criar índice para performance
CREATE INDEX IF NOT EXISTS idx_super_team_confrontations_category 
ON super_team_confrontations(category_id);

-- Eliminar confrontos antigos do torneio de teste
DELETE FROM super_team_confrontations 
WHERE tournament_id = 'ea9cd1e7-b0eb-4817-97f2-8ff3a4d26138';
