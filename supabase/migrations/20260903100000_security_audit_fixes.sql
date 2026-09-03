/*
  # Security audit fixes (2026-09-03)

  Corrige 4 falhas críticas confirmadas em produção durante auditoria de
  segurança multi-tenant. Todos os fixes foram validados contra o código
  cliente antes de aplicar, para não quebrar fluxos legítimos:

  1. `player_accounts`: remove policy "Anon can update player accounts"
     (USING true / WITH CHECK true para role anon). Nenhum código cliente
     faz UPDATE anónimo a esta tabela — todas as escritas de nível/categoria
     passam pelos RPCs SECURITY DEFINER (que corremos noutro ponto desta
     migration) ou pela policy "Players can update own account" (auth.uid()).
     Sem esta policy, qualquer pessoa com a anon key conseguia reescrever
     nome, telefone, nível, user_id, etc. de qualquer jogador.

  2. `organizer_players`: remove policy duplicada "Public read organizer_players"
     (SELECT USING true para role public). A policy "Organizers can view own
     players" (auth.uid() = organizer_id) já cobre o uso legítimo. A policy
     pública expunha nome/email/telefone/categoria de TODOS os organizadores
     a qualquer visitante anónimo.

  3. `open_games`: corrige a policy "Anyone can view open games", que tinha
     um `OR true` no fim a anular todas as condições de segurança anteriores
     (creator / participante confirmado). Substituído por
     `is_private = false AND status = 'open'`, que é exactamente a condição
     que o cliente já assume (ver src/lib/openGames.ts: `if (!g.is_private)
     return true`) — preserva a funcionalidade "Encontrar Jogo" e esconde
     jogos privados/de grupo de utilizadores não participantes.

  4. RPCs SECURITY DEFINER de rating/reward: por omissão do Postgres, toda
     função ganha EXECUTE para PUBLIC (inclui `anon`) a menos que seja
     revogado explicitamente. Isto permitia a qualquer cliente NÃO autenticado
     (só com a anon key pública) chamar `update_player_rating`,
     `update_player_account_level`, `reverse_rating_for_source`,
     `reverse_player_rating`, `mark_match_rating_processed` e
     `award_reward_points` para reescrever o nível/pontos de QUALQUER
     jogador. Revogamos `anon`/`PUBLIC` e mantemos apenas `authenticated`,
     que é como o código cliente already invoca estas funções (utilizador
     tem de ter sessão para submeter resultado de jogo).
*/

-- ── 1. player_accounts: remover UPDATE anónimo sem filtro ──────────────────
DROP POLICY IF EXISTS "Anon can update player accounts" ON player_accounts;

-- ── 2. organizer_players: remover SELECT público duplicado ─────────────────
DROP POLICY IF EXISTS "Public read organizer_players" ON organizer_players;

-- ── 3. open_games: substituir "OR true" por condição real de privacidade ───
DROP POLICY IF EXISTS "Anyone can view open games" ON open_games;

CREATE POLICY "Anyone can view open games"
  ON open_games
  FOR SELECT
  TO authenticated
  USING (
    creator_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM open_game_players
      WHERE open_game_players.game_id = open_games.id
        AND open_game_players.status = 'confirmed'
        AND open_game_players.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM open_game_players
      JOIN player_accounts ON player_accounts.id = open_game_players.player_account_id
      WHERE open_game_players.game_id = open_games.id
        AND open_game_players.status = 'confirmed'
        AND player_accounts.user_id = auth.uid()
    )
    OR (COALESCE(is_private, false) = false AND status = 'open')
  );

-- ── 4. Revogar EXECUTE de anon/PUBLIC nos RPCs privilegiados de rating ─────
REVOKE EXECUTE ON FUNCTION public.update_player_rating(uuid, numeric, numeric, boolean, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_player_rating(uuid, numeric, numeric, boolean, uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_player_rating(uuid, numeric, numeric, boolean, uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_player_account_level(text, uuid, text, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_player_account_level(text, uuid, text, numeric, numeric) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_player_account_level(text, uuid, text, numeric, numeric) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.mark_match_rating_processed(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_match_rating_processed(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.mark_match_rating_processed(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.award_reward_points(uuid, uuid, text, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.award_reward_points(uuid, uuid, text, uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.award_reward_points(uuid, uuid, text, uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.reverse_rating_for_source(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reverse_rating_for_source(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.reverse_rating_for_source(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.reverse_player_rating(uuid, numeric, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reverse_player_rating(uuid, numeric, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.reverse_player_rating(uuid, numeric, boolean) TO authenticated;
