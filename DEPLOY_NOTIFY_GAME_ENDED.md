# Como fazer deploy da Edge Function `notify-game-ended`

## Passo 1: Deploy da Edge Function

No terminal, dentro da pasta `padel-one-tour`:

```bash
cd C:\padelone\padel-one-tour
supabase functions deploy notify-game-ended
```

**Nota**: Se não tiveres o Supabase CLI instalado:
1. Instala: `npm install -g supabase`
2. Faz login: `supabase login`
3. Liga ao teu projeto: `supabase link --project-ref rqiwnxcexsccguruiteq`

## Passo 2: Aplicar a Migration (configura o cron)

A migration `20260225100000_notify_game_ended_cron.sql` já está criada e vai configurar automaticamente o cron job.

Para aplicar:

### Opção A: Via Supabase Dashboard
1. Vai ao Supabase Dashboard: https://supabase.com/dashboard/project/rqiwnxcexsccguruiteq
2. Vai a **Database** > **Migrations**
3. A migration deve aparecer como pendente
4. Clica em **Apply** ou **Run migration**

### Opção B: Via Supabase CLI
```bash
supabase db push
```

### Opção C: Manualmente (SQL Editor)
1. Vai ao Supabase Dashboard > **SQL Editor**
2. Copia o conteúdo de `supabase/migrations/20260225100000_notify_game_ended_cron.sql`
3. Cola e executa

## Passo 3: Verificar que está a funcionar

1. Vai ao Supabase Dashboard > **Database** > **Cron Jobs**
2. Deves ver `notify-game-ended` agendado para correr a cada 15 minutos (`*/15 * * * *`)
3. Podes verificar os logs em **Edge Functions** > **notify-game-ended** > **Logs**

## Como funciona

- A função corre **a cada 15 minutos**
- Procura jogos que terminaram nas **últimas 2 horas**
- Envia push notification a todos os jogadores confirmados do jogo
- Só envia se o jogo **ainda não tiver resultado** submetido
- Usa a tabela `open_game_notifications_sent` para evitar notificações duplicadas

## Troubleshooting

Se não receberes notificações:
1. Verifica que o cron job está ativo no dashboard
2. Verifica os logs da edge function para erros
3. Verifica que os jogadores têm push subscriptions ativas
4. Verifica que o jogo terminou há menos de 2 horas
