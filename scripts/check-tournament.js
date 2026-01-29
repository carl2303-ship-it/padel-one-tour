// Script para verificar jogadores de um torneio
// Executar: node scripts/check-tournament.js

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rqiwnxcexsccguruiteq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaXdueGNleHNjY2d1cnVpdGVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3Njc5MzcsImV4cCI6MjA3NTM0MzkzN30.Dl05zPQDtPVpmvn_Y-JokT3wDq0Oh9uF3op5xcHZpkY';

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Erro: VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não definidos no .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const tournamentId = process.argv[2] || '8bdc3e84-2367-48eb-80f2-d3b8e6cd9121';

async function checkTournament() {
  console.log('='.repeat(80));
  console.log('VERIFICAÇÃO DO TORNEIO');
  console.log('Tournament ID:', tournamentId);
  console.log('='.repeat(80));

  // 1. Buscar info do torneio
  const { data: tournament, error: tError } = await supabase
    .from('tournaments')
    .select('id, name, status, start_date')
    .eq('id', tournamentId)
    .single();

  if (tError || !tournament) {
    console.error('❌ Torneio não encontrado:', tError?.message);
    return;
  }

  console.log('\n📋 TORNEIO:', tournament.name);
  console.log('   Status:', tournament.status);
  console.log('   Data:', tournament.start_date);

  // 2. Buscar categorias
  const { data: categories } = await supabase
    .from('tournament_categories')
    .select('id, name, format')
    .eq('tournament_id', tournamentId);

  console.log('\n📁 CATEGORIAS:', categories?.length || 0);
  categories?.forEach(c => console.log(`   - ${c.name} (${c.format})`));

  // 3. Buscar jogadores
  const { data: players, error: pError } = await supabase
    .from('players')
    .select('id, name, email, phone_number, tournament_id, category_id, group_name, user_id')
    .eq('tournament_id', tournamentId)
    .order('name');

  console.log('\n👤 JOGADORES:', players?.length || 0);
  console.log('-'.repeat(80));
  
  if (players && players.length > 0) {
    players.forEach((p, i) => {
      const cat = categories?.find(c => c.id === p.category_id);
      console.log(`${(i+1).toString().padStart(2)}. ${p.name.padEnd(25)} | Tel: ${(p.phone_number || 'N/A').padEnd(15)} | Cat: ${cat?.name || 'NENHUMA'} | Grupo: ${p.group_name || 'N/A'}`);
    });
  }

  // 4. Buscar equipas
  const { data: teams, error: teError } = await supabase
    .from('teams')
    .select(`
      id, name, tournament_id, category_id,
      player1_id, player2_id
    `)
    .eq('tournament_id', tournamentId)
    .order('name');

  console.log('\n🏓 EQUIPAS:', teams?.length || 0);
  console.log('-'.repeat(80));

  if (teams && teams.length > 0) {
    for (const team of teams) {
      // Buscar jogadores da equipa
      const { data: p1 } = await supabase
        .from('players')
        .select('id, name, phone_number, tournament_id')
        .eq('id', team.player1_id)
        .single();

      const { data: p2 } = await supabase
        .from('players')
        .select('id, name, phone_number, tournament_id')
        .eq('id', team.player2_id)
        .single();

      const cat = categories?.find(c => c.id === team.category_id);
      
      console.log(`\n📍 ${team.name} (Cat: ${cat?.name || 'N/A'})`);
      
      if (p1) {
        const p1Status = p1.tournament_id === tournamentId ? '✓' : `❌ ERRADO (${p1.tournament_id})`;
        console.log(`   Jogador 1: ${p1.name} | Tel: ${p1.phone_number || 'N/A'} | TournamentID: ${p1Status}`);
      } else {
        console.log(`   Jogador 1: ❌ NÃO ENCONTRADO (ID: ${team.player1_id})`);
      }

      if (p2) {
        const p2Status = p2.tournament_id === tournamentId ? '✓' : `❌ ERRADO (${p2.tournament_id})`;
        console.log(`   Jogador 2: ${p2.name} | Tel: ${p2.phone_number || 'N/A'} | TournamentID: ${p2Status}`);
      } else {
        console.log(`   Jogador 2: ❌ NÃO ENCONTRADO (ID: ${team.player2_id})`);
      }
    }
  }

  // 5. Verificar jogadores órfãos (sem categoria)
  const orphans = players?.filter(p => !p.category_id) || [];
  if (orphans.length > 0) {
    console.log('\n⚠️ JOGADORES SEM CATEGORIA (órfãos):', orphans.length);
    orphans.forEach(p => console.log(`   - ${p.name} (ID: ${p.id})`));
  }

  // 6. Resumo
  console.log('\n' + '='.repeat(80));
  console.log('RESUMO:');
  console.log(`   Categorias: ${categories?.length || 0}`);
  console.log(`   Jogadores: ${players?.length || 0}`);
  console.log(`   Equipas: ${teams?.length || 0}`);
  console.log(`   Jogadores sem categoria: ${orphans.length}`);
  console.log('='.repeat(80));
}

checkTournament().catch(console.error);
