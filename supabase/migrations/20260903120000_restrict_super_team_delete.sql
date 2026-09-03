/*
  # Restringir DELETE em super_teams / super_team_players (2026-09-03)

  As policies "super_teams_delete_auth" e "super_team_players_delete_auth"
  tinham `USING (true)` para role `public` — qualquer pessoa (autenticada ou
  até anónima, já que `public` inclui `anon`) conseguia apagar equipas ou
  jogadores de QUALQUER torneio de QUALQUER organizador, bastando saber o id.

  Verificado no código cliente (padel-one-tour):
  - Não existe nenhuma chamada `.from('super_teams').delete()` — logo
    restringir esta tabela não quebra nada.
  - A única chamada `.from('super_team_players').delete()` está em
    `EditSuperTeamModal.tsx`, um ecrã só acessível ao organizador autenticado
    do torneio (gestão de plantel de Super Equipas).
  - O fluxo de inscrição pública (`SuperTeamRegistration.tsx` /
    `PublicRegistrationPage.tsx`) nunca apaga registos, só insere/atualiza —
    não depende desta policy.

  Novo comportamento: só o organizador dono do torneio (tournaments.user_id)
  pode apagar super_teams / super_team_players desse torneio. INSERT/UPDATE/
  SELECT ficam inalterados (necessários para a inscrição pública e desafios
  de ladder, que não têm um mecanismo de identidade próprio nestas tabelas).
*/

DROP POLICY IF EXISTS "super_teams_delete_auth" ON super_teams;

CREATE POLICY "super_teams_delete_owner"
  ON super_teams
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tournaments
      WHERE tournaments.id = super_teams.tournament_id
        AND tournaments.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "super_team_players_delete_auth" ON super_team_players;

CREATE POLICY "super_team_players_delete_owner"
  ON super_team_players
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM super_teams
      JOIN tournaments ON tournaments.id = super_teams.tournament_id
      WHERE super_teams.id = super_team_players.super_team_id
        AND tournaments.user_id = auth.uid()
    )
  );
