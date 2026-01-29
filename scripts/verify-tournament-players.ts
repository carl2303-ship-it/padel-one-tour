/**
 * Script para verificar jogadores de um torneio
 * Execute com: npx tsx scripts/verify-tournament-players.ts
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://rqiwnxcexsccguruiteq.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyTournamentPlayers(tournamentName: string) {
  console.log('='.repeat(80));
  console.log(`VERIFICAÇÃO DO TORNEIO: ${tournamentName}`);
  console.log('='.repeat(80));

  // 1. Encontrar o torneio
  const { data: tournaments, error: tError } = await supabase
    .from('tournaments')
    .select('id, name, status, start_date')
    .ilike('name', `%${tournamentName}%`);

  if (tError || !tournaments || tournaments.length === 0) {
    console.log('❌ Torneio não encontrado!');
    return;
  }

  const tournament = tournaments[0];
  console.log(`\n✅ Torneio encontrado: ${tournament.name}`);
  console.log(`   ID: ${tournament.id}`);
  console.log(`   Status: ${tournament.status}`);
  console.log(`   Data: ${tournament.start_date}`);

  // 2. Obter jogadores do torneio
  const { data: players, error: pError } = await supabase
    .from('players')
    .select('id, name, email, phone_number, user_id, category_id, group_name')
    .eq('tournament_id', tournament.id)
    .order('name');

  if (pError) {
    console.log(`❌ Erro ao obter jogadores: ${pError.message}`);
    return;
  }

  console.log(`\n📊 JOGADORES NO TORNEIO: ${players?.length || 0}`);
  console.log('-'.repeat(80));

  if (!players || players.length === 0) {
    console.log('⚠️ Nenhum jogador encontrado neste torneio!');
    return;
  }

  // 3. Verificar cada jogador
  let problemCount = 0;
  let okCount = 0;

  for (const player of players) {
    console.log(`\n👤 ${player.name}`);
    console.log(`   Email: ${player.email || '(vazio)'}`);
    console.log(`   Telefone: ${player.phone_number || '(vazio)'}`);
    console.log(`   User ID: ${player.user_id || 'null (correto)'}`);
    console.log(`   Grupo: ${player.group_name || '(não atribuído)'}`);

    // Verificar se tem player_account correspondente
    let hasMatchingAccount = false;
    let accountInfo = '';

    if (player.phone_number) {
      const { data: accountByPhone } = await supabase
        .from('player_accounts')
        .select('id, name, user_id, phone_number')
        .eq('phone_number', player.phone_number)
        .maybeSingle();

      if (accountByPhone) {
        hasMatchingAccount = true;
        accountInfo = `Por telefone: ${accountByPhone.name} (user_id: ${accountByPhone.user_id || 'null'})`;
      }
    }

    if (!hasMatchingAccount && player.name) {
      const { data: accountByName } = await supabase
        .from('player_accounts')
        .select('id, name, user_id, phone_number')
        .ilike('name', player.name)
        .maybeSingle();

      if (accountByName) {
        hasMatchingAccount = true;
        accountInfo = `Por nome: ${accountByName.name} (user_id: ${accountByName.user_id || 'null'})`;
      }
    }

    if (hasMatchingAccount) {
      console.log(`   ✅ Player Account encontrado: ${accountInfo}`);
      console.log(`   → Este jogador VERÁ o torneio no dashboard`);
      okCount++;
    } else {
      console.log(`   ⚠️ Sem Player Account correspondente`);
      console.log(`   → Este jogador NÃO verá o torneio no dashboard (precisa criar conta)`);
      problemCount++;
    }
  }

  // 4. Resumo
  console.log('\n' + '='.repeat(80));
  console.log('RESUMO:');
  console.log(`   Total jogadores: ${players.length}`);
  console.log(`   ✅ Com conta (verão o torneio): ${okCount}`);
  console.log(`   ⚠️ Sem conta (não verão): ${problemCount}`);
  console.log('='.repeat(80));

  // 5. Verificar equipas também
  const { data: teams } = await supabase
    .from('teams')
    .select(`
      id, name,
      player1:players!teams_player1_id_fkey(id, name, phone_number),
      player2:players!teams_player2_id_fkey(id, name, phone_number)
    `)
    .eq('tournament_id', tournament.id);

  if (teams && teams.length > 0) {
    console.log(`\n📊 EQUIPAS NO TORNEIO: ${teams.length}`);
    console.log('-'.repeat(80));
    
    for (const team of teams) {
      const p1 = (team as any).player1;
      const p2 = (team as any).player2;
      console.log(`\n🏓 ${team.name}`);
      console.log(`   Jogador 1: ${p1?.name || 'N/A'} (tel: ${p1?.phone_number || 'N/A'})`);
      console.log(`   Jogador 2: ${p2?.name || 'N/A'} (tel: ${p2?.phone_number || 'N/A'})`);
    }
  }
}

// Executar
const tournamentName = process.argv[2] || 'Non Stop M3 - M4';
verifyTournamentPlayers(tournamentName);
