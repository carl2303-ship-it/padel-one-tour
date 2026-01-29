// Script para verificar conta de jogador
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rqiwnxcexsccguruiteq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaXdueGNleHNjY2d1cnVpdGVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3Njc5MzcsImV4cCI6MjA3NTM0MzkzN30.Dl05zPQDtPVpmvn_Y-JokT3wDq0Oh9uF3op5xcHZpkY';

const supabase = createClient(supabaseUrl, supabaseKey);

const phoneNumber = process.argv[2] || '+351964289868';

// Normalizar número de telefone (remover espaços)
const normalizedPhone = phoneNumber.replace(/\s+/g, '');
const phoneVariants = [
  phoneNumber,
  normalizedPhone,
  normalizedPhone.replace('+351', ''),
  '351' + normalizedPhone.replace('+351', ''),
];

async function checkPlayerAccount() {
  console.log('='.repeat(80));
  console.log('VERIFICAÇÃO DE CONTA DE JOGADOR');
  console.log('Telefone:', phoneNumber);
  console.log('Variantes a procurar:', phoneVariants);
  console.log('='.repeat(80));

  // 1. Procurar na tabela players
  console.log('\n📋 1. TABELA PLAYERS:');
  
  for (const variant of phoneVariants) {
    const { data: players, error } = await supabase
      .from('players')
      .select('id, name, email, phone_number, tournament_id, user_id')
      .or(`phone_number.eq.${variant},phone_number.ilike.%${variant.replace('+', '')}%`);

    if (players && players.length > 0) {
      console.log(`   Encontrado com variante "${variant}":`);
      players.forEach(p => {
        console.log(`   - ${p.name} | Tel: ${p.phone_number} | Email: ${p.email || 'N/A'}`);
        console.log(`     Tournament ID: ${p.tournament_id}`);
        console.log(`     User ID: ${p.user_id || 'NULL'}`);
      });
    }
  }

  // Buscar de forma mais ampla
  const { data: allMatches } = await supabase
    .from('players')
    .select('id, name, email, phone_number, tournament_id, user_id')
    .ilike('phone_number', `%964289868%`);

  if (allMatches && allMatches.length > 0) {
    console.log('\n   Busca ampla (contém 964289868):');
    allMatches.forEach(p => {
      console.log(`   - ${p.name} | Tel: ${p.phone_number} | Email: ${p.email || 'N/A'}`);
      console.log(`     Tournament ID: ${p.tournament_id}`);
      console.log(`     User ID: ${p.user_id || 'NULL'}`);
    });
  } else {
    console.log('\n   ❌ Nenhum jogador encontrado com este telefone na tabela players');
  }

  // 2. Procurar na tabela player_accounts
  console.log('\n📋 2. TABELA PLAYER_ACCOUNTS:');
  
  const { data: accounts } = await supabase
    .from('player_accounts')
    .select('id, name, email, phone_number, user_id')
    .ilike('phone_number', `%964289868%`);

  if (accounts && accounts.length > 0) {
    console.log('   Contas encontradas:');
    accounts.forEach(a => {
      console.log(`   - ${a.name} | Tel: ${a.phone_number} | Email: ${a.email || 'N/A'}`);
      console.log(`     User ID: ${a.user_id || 'NULL (sem conta de login)'}`);
    });
  } else {
    console.log('   ❌ Nenhuma player_account encontrada com este telefone');
  }

  // 3. Verificar torneios onde participa
  console.log('\n📋 3. TORNEIOS ONDE PARTICIPA:');
  
  if (allMatches && allMatches.length > 0) {
    const tournamentIds = [...new Set(allMatches.map(p => p.tournament_id))];
    
    const { data: tournaments } = await supabase
      .from('tournaments')
      .select('id, name, status, start_date')
      .in('id', tournamentIds);

    if (tournaments) {
      tournaments.forEach(t => {
        console.log(`   - ${t.name} (${t.status}) - ${t.start_date}`);
      });
    }
  }

  // 4. Verificar equipas
  console.log('\n📋 4. EQUIPAS:');
  
  if (allMatches && allMatches.length > 0) {
    const playerIds = allMatches.map(p => p.id);
    
    const { data: teams } = await supabase
      .from('teams')
      .select('id, name, tournament_id, player1_id, player2_id')
      .or(`player1_id.in.(${playerIds.join(',')}),player2_id.in.(${playerIds.join(',')})`);

    if (teams && teams.length > 0) {
      console.log('   Equipas encontradas:');
      for (const team of teams) {
        const { data: tournament } = await supabase
          .from('tournaments')
          .select('name')
          .eq('id', team.tournament_id)
          .single();
        
        console.log(`   - ${team.name} (Torneio: ${tournament?.name || team.tournament_id})`);
      }
    } else {
      console.log('   Nenhuma equipa encontrada');
    }
  }

  // Resumo
  console.log('\n' + '='.repeat(80));
  console.log('DIAGNÓSTICO:');
  
  if (!allMatches || allMatches.length === 0) {
    console.log('❌ Este telefone NÃO está registado em nenhum torneio');
    console.log('   O jogador precisa se inscrever num torneio primeiro.');
  } else if (!accounts || accounts.length === 0) {
    console.log('⚠️ O jogador está inscrito em torneios, mas NÃO tem conta de login');
    console.log('   Precisa CRIAR CONTA no sistema (não fazer login, mas registar-se)');
  } else if (accounts[0].user_id === null) {
    console.log('⚠️ Existe player_account mas SEM user_id associado');
    console.log('   Conta incompleta - precisa completar o registo');
  } else {
    console.log('✅ Jogador tem conta. Problema pode ser:');
    console.log('   - Password incorreta');
    console.log('   - Email errado no login');
    console.log('   - Conta não verificada por email');
  }
  console.log('='.repeat(80));
}

checkPlayerAccount();
