# Deploy no Netlify

O site está configurado para Netlify (`netlify.toml` já existe).

## Opção 1: Deploy automático (recomendado)

Se o teu site no Netlify está **ligado ao GitHub**:

1. Entra em [app.netlify.com](https://app.netlify.com)
2. Abre o teu site (padel-one-tour)
3. O deploy é feito **automaticamente** cada vez que fazes **push** para o repositório
4. Como já fizeste push para a branch `test`, verifica no Netlify se há um deploy em curso ou concluído
5. Se o site está ligado à branch `main`, faz **merge** de `test` para `main` no GitHub e o Netlify faz o deploy

## Opção 2: Deploy manual pela consola

Abre um terminal (PowerShell ou CMD) **no teu PC** e executa:

```bash
cd c:\padelone\padel-one-tour
npx netlify login
```

Abre o link que aparecer e faz login no Netlify. Depois:

```bash
npx netlify link
```

Escolhe "Link to existing site" e seleciona o teu site. Por fim:

```bash
npx netlify deploy --prod
```

## Build local (para testar antes)

```bash
npm run build
```

A pasta `dist` é a que o Netlify publica (está em `netlify.toml` como `publish = "dist"`).
