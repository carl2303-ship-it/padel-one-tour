/**
 * Adiciona jogos de knockout aos torneios TEST2026 Groups+Knockout existentes
 * que foram criados sem as fases finais.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function main() {
  console.log('🎾 Adicionando jogos de knockout aos torneios TEST2026 Groups+Knockout...\n');

  // Buscar todos os torneios TEST2026 com formato groups_knockout
  const { data: tournaments, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, format')
    .like('name', 'TEST2026%')
    .eq('format', 'groups_knockout');

  if (tErr || !tournaments?.length) {
    console.log('❌ Nenhum torneio TEST2026 groups_knockout encontrado.');
    return;
  }

  let fixed = 0;
  let skipped = 0;

  for (const t of tournaments) {
    console.log(`\n📌 ${t.name}...`);

    // Verificar se já tem jogos de knockout
    const { data: existingKnockout } = await supabase
      .from('matches')
      .select('id, round')
      .eq('tournament_id', t.id)
      .in('round', ['semifinal', 'final', '3rd_place']);

    if (existingKnockout && existingKnockout.length > 0) {
      console.log(`   ⏭️  Já tem ${existingKnockout.length} jogos de knockout, a saltar.`);
      skipped++;
      continue;
    }

    // Obter o match_number mais alto
    const { data: allMatches } = await supabase
      .from('matches')
      .select('match_number')
      .eq('tournament_id', t.id)
      .order('match_number', { ascending: false })
      .limit(1);

    const lastMatchNumber = allMatches?.[0]?.match_number || 0;
    let matchNumber = lastMatchNumber + 1;

    // Obter a última data/hora agendada para calcular horários
    const { data: lastScheduled } = await supabase
      .from('matches')
      .select('scheduled_time')
      .eq('tournament_id', t.id)
      .not('scheduled_time', 'is', null)
      .order('scheduled_time', { ascending: false })
      .limit(1);

    const lastTime = lastScheduled?.[0]?.scheduled_time 
      ? new Date(lastScheduled[0].scheduled_time)
      : new Date();

    // Adicionar 60 minutos à última partida (duração padrão)
    const matchDuration = 60; // minutos
    let currentTime = new Date(lastTime.getTime() + matchDuration * 60000);

    // Criar jogos de knockout (TBD teams)
    const knockoutMatches = [
      { round: 'semifinal', label: 'Semifinal 1' },
      { round: 'semifinal', label: 'Semifinal 2' },
      { round: 'final', label: 'Final' },
      { round: '3rd_place', label: '3º Lugar' },
    ];

    for (const ko of knockoutMatches) {
      const { error } = await supabase
        .from('matches')
        .insert({
          tournament_id: t.id,
          category_id: null, // Pode ser null ou buscar a primeira categoria
          round: ko.round,
          match_number: matchNumber++,
          team1_id: null,
          team2_id: null,
          scheduled_time: currentTime.toISOString(),
          court: '1',
          status: 'scheduled',
          team1_score_set1: 0,
          team2_score_set1: 0,
          team1_score_set2: 0,
          team2_score_set2: 0,
          team1_score_set3: 0,
          team2_score_set3: 0,
        });

      if (error) {
        console.error(`   ❌ Erro ao criar ${ko.label}:`, error.message);
      } else {
        console.log(`   ✅ ${ko.label} criada (match #${matchNumber - 1})`);
      }

      // Avançar tempo para próximo jogo (60 min)
      currentTime = new Date(currentTime.getTime() + matchDuration * 60000);
    }

    fixed++;
  }

  console.log(`\n📊 Resumo:`);
  console.log(`   ✅ Torneios corrigidos: ${fixed}`);
  console.log(`   ⏭️  Torneios já com knockout: ${skipped}`);
  console.log(`\n🎉 Concluído!`);
}

main().catch(console.error);
