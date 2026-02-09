/**
 * Script para verificar e corrigir LIGA APC N-S M4-2
 * 1. Verifica final_position atual na BD
 * 2. Se errado, gera SQL
 * 3. Encontra a liga e indica como recalcular
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://rqiwnxcexsccguruiteq.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaXdueGNleHNjY2d1cnVpdGVxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTc2NzkzNywiZXhwIjoyMDc1MzQzOTM3fQ._zCjHZa15WhZBcf7lmTGct1lcu0Qtf4OnnwUy2EsJTA'
);

const TOURNAMENT_ID = 'd5c73082-0ee5-49e5-9f64-31c3b9fbc748';
const PAULOS_ID = '64be17ca-1463-40e5-bebe-a8261361c8b7';
const DAVID_JOAO_ID = '24268fb0-339c-4311-99b8-7f229c9faee4';

async function main() {
  console.log('\n=== VERIFICAÇÃO LIGA APC N-S M4-2 ===\n');

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, final_position')
    .eq('tournament_id', TOURNAMENT_ID)
    .in('id', [PAULOS_ID, DAVID_JOAO_ID]);

  console.log('Estado atual na BD:');
  teams?.forEach(t => console.log(`  ${t.name}: final_position = ${t.final_position}`));

  const paulos = teams?.find(t => t.id === PAULOS_ID);
  const davidJoao = teams?.find(t => t.id === DAVID_JOAO_ID);

  if (paulos?.final_position === 3 && davidJoao?.final_position === 4) {
    console.log('\n✓ final_position já está correto (Paulo\'s 3º, David - João 4º).');
  } else {
    console.log('\n⚠️ final_position INCORRETO. Executa no Supabase SQL Editor:');
    console.log('\nUPDATE teams SET final_position = 3 WHERE id = \'64be17ca-1463-40e5-bebe-a8261361c8b7\';  -- Paulo\'s');
    console.log('UPDATE teams SET final_position = 4 WHERE id = \'24268fb0-339c-4311-99b8-7f229c9faee4\';  -- David - João\n');
  }

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name, league_id')
    .eq('id', TOURNAMENT_ID)
    .single();

  if (tournament?.league_id) {
    const { data: league } = await supabase
      .from('leagues')
      .select('id, name')
      .eq('id', tournament.league_id)
      .single();

    console.log('\n--- RECALCULAR LIGA ---');
    console.log(`Torneio está na liga: ${league?.name || tournament.league_id}`);
    console.log('\nPara atualizar a liga:');
    console.log('1. Abre o Padel One Tour');
    console.log('2. Liga → escolhe a liga');
    console.log('3. Clica em "Recalcular" ou "Atualizar classificações"');
    console.log('\nOu executa no Supabase SQL Editor:');
    console.log(`SELECT recalculate_league_standings_for_league('${tournament.league_id}');\n`);
  } else {
    console.log('\nTorneio não está associado a nenhuma liga.');
  }

  console.log('--- ONDE VER A CLASSIFICAÇÃO ---');
  console.log('• Player app: Classificação do torneio dentro de "Histórico"');
  console.log('• Liga: Classificação geral da liga (precisa recalcular)');
  console.log('• Tour: Ver torneio → Classificação');
  console.log('\nSe ainda mostra errado: limpa cache do browser (Ctrl+Shift+R) ou testa em janela anónima.\n');
}

main().catch(console.error);
