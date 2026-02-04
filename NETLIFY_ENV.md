# Variáveis de ambiente no Netlify (obrigatório)

O ecrã fica branco se estas variáveis **não estiverem definidas** no Netlify.

## Passos

1. Entra em **https://app.netlify.com**
2. Abre o teu site (padel-one-tour)
3. Vai a **Site configuration** → **Environment variables**
4. Clica em **Add a variable** → **Add a single variable**
5. Adiciona:

| Nome | Valor |
|------|--------|
| `VITE_SUPABASE_URL` | A URL do teu projeto Supabase (ex: `https://xxxxx.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | A chave anónima (anon key) do Supabase |

Os valores estão no teu ficheiro `.env` local ou no painel do Supabase: **Project Settings** → **API** → **Project URL** e **anon public**.

6. Guarda e faz **Trigger deploy** (Deploys → Trigger deploy → Deploy site).

Sem estas variáveis, a app falha ao carregar e o ecrã fica branco.
