# Como criar os ícones para PWA e Favicon

## Problema
Os ícones necessários para o PWA e favicon não existem na pasta `public/`:
- `favicon.png` ou `favicon.ico`
- `icon-192.png` (192x192 pixels)
- `icon-512.png` (512x512 pixels)

## Solução

### Passo 1: Exportar/Descarregar a imagem do favicon
Tens a imagem do favicon (P azul com raquete de padel). Precisas de:
1. **Exportar a imagem** no formato PNG, preferencialmente em 512x512 pixels ou maior
2. Se a imagem for menor, redimensiona para pelo menos 512x512 pixels mantendo a qualidade

### Passo 2: Gerar os ícones (Opção mais fácil - Recomendado)
1. Vai a **https://realfavicongenerator.net/**
2. Faz upload da imagem do favicon (PNG, 512x512 ou maior)
3. O gerador vai criar automaticamente:
   - `favicon.ico` (vários tamanhos)
   - `favicon.png` (32x32)
   - `icon-192.png` (192x192)
   - `icon-512.png` (512x512)
4. Descarrega o pacote completo
5. Extrai os ficheiros e coloca na pasta `public/`:
   - `favicon.ico` ou `favicon.png`
   - `icon-192.png`
   - `icon-512.png`

### Alternativa: Criar manualmente com ferramentas online
1. Vai a **https://www.iloveimg.com/resize-image** ou **https://www.resizepixel.com/**
2. Faz upload da imagem do favicon
3. Redimensiona para cada tamanho:
   - **512x512** → salva como `icon-512.png`
   - **192x192** → salva como `icon-192.png`
   - **32x32** → salva como `favicon.png`
4. Coloca todos os ficheiros na pasta `public/`

### Opção 3: Usar imagem do Supabase (se disponível)
Se a imagem do Supabase estiver acessível, podes descarregá-la:
- URL: https://rqiwnxcexsccguruiteq.supabase.co/storage/v1/object/public/tournament-images/padel-hub-favicon.png
- Depois redimensiona usando uma das opções acima

## Verificação
Depois de adicionar os ícones:
1. Recarrega a página
2. Verifica se o favicon aparece no Chrome
3. Verifica se aparece a opção "Instalar app" no Chrome (menu de 3 pontos → "Instalar PADEL ONE Tour")

## Requisitos PWA
Para a opção de instalação aparecer, é necessário:
- ✅ HTTPS (já tens no Netlify)
- ✅ manifest.json (já existe)
- ✅ service-worker.js (já existe)
- ❌ Ícones (precisam ser criados)
- ✅ start_url no manifest (já existe)
- ✅ display: "standalone" (já existe)
