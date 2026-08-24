-- Remove jogadores órfãos em torneios de equipas (equipa apagada, jogador ficou).
-- Só em torneios que já têm pelo menos uma equipa, para não tocar formatos individuais.
WITH orphan_players AS (
  SELECT p.id, p.name, p.phone_number, p.tournament_id, t.user_id AS owner_id
  FROM players p
  JOIN tournaments t ON t.id = p.tournament_id
  WHERE EXISTS (
      SELECT 1 FROM teams tm WHERE tm.tournament_id = p.tournament_id
    )
    AND p.id NOT IN (
      SELECT player1_id FROM teams WHERE player1_id IS NOT NULL
      UNION
      SELECT player2_id FROM teams WHERE player2_id IS NOT NULL
    )
    AND t.format NOT IN ('individual_groups_knockout', 'mixed_american', 'super_teams', 'mixed_gender')
    AND NOT (t.format = 'round_robin' AND coalesce(t.round_robin_type, '') = 'individual')
),
deleted_tx AS (
  DELETE FROM player_transactions pt
  USING orphan_players op
  WHERE pt.club_owner_id = op.owner_id
    AND pt.reference_id = op.tournament_id
    AND pt.reference_type = 'tournament'
    AND lower(trim(both from pt.player_name)) = lower(trim(both from coalesce(op.name, '')))
  RETURNING pt.id
)
DELETE FROM players p
USING orphan_players op
WHERE p.id = op.id;
