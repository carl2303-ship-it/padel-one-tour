-- =====================================================
-- Fix RLS policies for open_games and open_game_players
-- Garante que jogadores autenticados podem criar/juntar jogos
-- =====================================================

-- Ativar RLS (se não estiver ativo)
ALTER TABLE open_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_game_players ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- open_games: Políticas
-- =====================================================

-- SELECT: qualquer autenticado pode ver todos os jogos abertos
DROP POLICY IF EXISTS "Anyone can view open games" ON open_games;
CREATE POLICY "Anyone can view open games" ON open_games
  FOR SELECT TO authenticated
  USING (true);

-- INSERT: qualquer autenticado pode criar um jogo
DROP POLICY IF EXISTS "Authenticated users can create open games" ON open_games;
CREATE POLICY "Authenticated users can create open games" ON open_games
  FOR INSERT TO authenticated
  WITH CHECK (creator_user_id = auth.uid());

-- UPDATE: o criador pode atualizar o jogo (status, etc.)
DROP POLICY IF EXISTS "Creator can update their open games" ON open_games;
CREATE POLICY "Creator can update their open games" ON open_games
  FOR UPDATE TO authenticated
  USING (creator_user_id = auth.uid())
  WITH CHECK (creator_user_id = auth.uid());

-- UPDATE: qualquer autenticado pode alterar o status (para full, etc.)
DROP POLICY IF EXISTS "Any authenticated user can update game status" ON open_games;
CREATE POLICY "Any authenticated user can update game status" ON open_games
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- DELETE: o criador pode apagar
DROP POLICY IF EXISTS "Creator can delete their open games" ON open_games;
CREATE POLICY "Creator can delete their open games" ON open_games
  FOR DELETE TO authenticated
  USING (creator_user_id = auth.uid());

-- =====================================================
-- open_game_players: Políticas
-- =====================================================

-- SELECT: qualquer autenticado pode ver os jogadores
DROP POLICY IF EXISTS "Anyone can view open game players" ON open_game_players;
CREATE POLICY "Anyone can view open game players" ON open_game_players
  FOR SELECT TO authenticated
  USING (true);

-- INSERT: qualquer autenticado pode juntar-se (o user_id deve ser auth.uid())
DROP POLICY IF EXISTS "Authenticated users can join games" ON open_game_players;
CREATE POLICY "Authenticated users can join games" ON open_game_players
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- UPDATE: o próprio jogador pode atualizar a sua entrada
DROP POLICY IF EXISTS "Players can update their own entries" ON open_game_players;
CREATE POLICY "Players can update their own entries" ON open_game_players
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE: o próprio jogador pode sair do jogo
DROP POLICY IF EXISTS "Players can leave games" ON open_game_players;
CREATE POLICY "Players can leave games" ON open_game_players
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- INSERT: o criador do jogo pode adicionar outros jogadores
DROP POLICY IF EXISTS "Game creator can add players" ON open_game_players;
CREATE POLICY "Game creator can add players" ON open_game_players
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM open_games 
      WHERE id = game_id 
      AND creator_user_id = auth.uid()
    )
  );

-- =====================================================
-- court_bookings: Permitir inserts de jogos abertos
-- (criados por jogadores, não apenas pelo owner do clube)
-- =====================================================

-- Verificar se a tabela existe antes de tentar criar policies
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'court_bookings') THEN
    -- Permitir qualquer autenticado inserir bookings (jogos abertos)
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can create bookings from open games" ON court_bookings';
    EXECUTE 'CREATE POLICY "Authenticated users can create bookings from open games" ON court_bookings
      FOR INSERT TO authenticated
      WITH CHECK (event_type = ''open_game'')';
    
    -- Permitir qualquer autenticado atualizar bookings de jogos abertos
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can update open game bookings" ON court_bookings';
    EXECUTE 'CREATE POLICY "Authenticated users can update open game bookings" ON court_bookings
      FOR UPDATE TO authenticated
      USING (event_type = ''open_game'')
      WITH CHECK (event_type = ''open_game'')';
  END IF;
END;
$$;
