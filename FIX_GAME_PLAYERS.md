# Como corrigir jogadores que não veem o jogo no dashboard

## Problema
Jogadores adicionados a um jogo não veem o jogo no seu dashboard porque o `user_id` não está preenchido ou está incorreto na tabela `open_game_players`.

## Solução Rápida (para o jogo específico)

1. Vai ao **Supabase Dashboard** > **SQL Editor**
2. Executa esta query para corrigir o jogo específico:

```sql
SELECT fix_game_players_user_id('4943c90e-5fb6-4477-a945-c3edfab60219');
```

Isto vai:
- Verificar todos os jogadores confirmados neste jogo
- Atualizar o `user_id` de cada jogador baseado no `player_accounts.user_id`
- Retornar quantos registos foram atualizados

## Verificar o estado atual

Para ver o estado atual dos jogadores neste jogo:

```sql
SELECT 
  ogp.id,
  ogp.user_id,
  ogp.player_account_id,
  ogp.status,
  ogp.position,
  pa.name as player_name,
  pa.user_id as account_user_id,
  CASE 
    WHEN ogp.user_id IS NULL THEN '❌ user_id NULL'
    WHEN ogp.user_id != pa.user_id THEN '⚠️ user_id MISMATCH'
    ELSE '✅ OK'
  END as status_check
FROM open_game_players ogp
LEFT JOIN player_accounts pa ON pa.id = ogp.player_account_id
WHERE ogp.game_id = '4943c90e-5fb6-4477-a945-c3edfab60219'
ORDER BY ogp.position;
```

## Solução Automática (para todos os jogos)

Para corrigir todos os jogos de uma vez:

```sql
-- Fix all games
DO $$
DECLARE
  v_game_id UUID;
  v_result JSON;
BEGIN
  FOR v_game_id IN SELECT DISTINCT game_id FROM open_game_players WHERE status = 'confirmed' LOOP
    SELECT fix_game_players_user_id(v_game_id) INTO v_result;
    RAISE NOTICE 'Game %: %', v_game_id, v_result;
  END LOOP;
END $$;
```

## Prevenir no futuro

A migration `20260225100001_fix_add_player_user_id.sql` já corrige o problema na função `add_player_to_open_game` para que não aconteça novamente.

A função `fix_game_players_user_id` pode ser chamada sempre que necessário para reparar jogos existentes.
