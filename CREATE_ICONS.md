# Como criar os ícones para PWA e Favicon

## Problema
Os ícones necessários para o PWA e favicon não existem na pasta `public/`:
- `favicon.png` ou `favicon.ico`
- `icon-192.png` (192x192 pixels)
- `icon-512.png` (512x512 pixels)

## Solução

### Opção 1: Gerador online (Recomendado)
1. Vai a https://realfavicongenerator.net/ ou https://www.pwabuilder.com/imageGenerator
2. Faz upload de uma imagem (mínimo 512x512 pixels)
3. Gera os ícones necessários
4. Descarrega e coloca na pasta `public/`:
   - `favicon.ico` ou `favicon.png`
   - `icon-192.png`
   - `icon-512.png`

### Opção 2: Criar manualmente
1. Cria uma imagem quadrada (512x512 pixels) com o logo da PADEL ONE Tour
2. Redimensiona para:
   - 192x192 → `icon-192.png`
   - 512x512 → `icon-512.png`
   - 32x32 ou 16x16 → `favicon.png` ou `favicon.ico`

### Opção 3: Usar imagem do Supabase
Se a imagem do Supabase estiver acessível, podes descarregá-la e usar como base:
- URL: https://rqiwnxcexsccguruiteq.supabase.co/storage/v1/object/public/tournament-images/padel-hub-favicon.png

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
