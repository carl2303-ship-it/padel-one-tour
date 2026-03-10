-- Adicionar formato crossed_playoffs_teams (Playoffs Cruzados para Equipas) aos torneios e categorias

ALTER TABLE tournaments
DROP CONSTRAINT IF EXISTS tournaments_format_check;

ALTER TABLE tournaments
ADD CONSTRAINT tournaments_format_check
CHECK (format IN (
  'single_elimination', 'round_robin', 'groups_knockout',
  'individual_groups_knockout', 'super_teams', 'crossed_playoffs', 'crossed_playoffs_teams', 'mixed_gender',
  'mixed_american'
));

ALTER TABLE tournament_categories
DROP CONSTRAINT IF EXISTS tournament_categories_format_check;

ALTER TABLE tournament_categories
ADD CONSTRAINT tournament_categories_format_check
CHECK (format IN (
  'single_elimination', 'round_robin', 'groups_knockout',
  'individual_groups_knockout', 'super_teams', 'crossed_playoffs', 'crossed_playoffs_teams', 'mixed_gender',
  'mixed_american'
));
