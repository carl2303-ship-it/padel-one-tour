/**
 * Script para verificar a classificação de um torneio.
 * Compara a classificação calculada (critérios corretos) com final_position na BD.
 * 
 * Uso: node scripts/verify-standings.mjs [nome do torneio]
 * Ex: node scripts/verify-standings.mjs "LIGA APC"
 *     node scripts/verify-standings.mjs "F4-F5"
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rqiwnxcexsccguruiteq.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaXdueGNleHNjY2d1cnVpdGVxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTc2NzkzNywiZXhwIjoyMDc1MzQzOTM3fQ._zCjHZa15WhZBcf7lmTGct1lcu0Qtf4OnnwUy2EsJTA';

const supabase = createClient(supabaseUrl, supabaseKey);

function getHeadToHeadWinner(team1Id, team2Id, matches) {
  const directMatch = matches.find(m =>
    (m.team1_id === team1Id && m.team2_id === team2Id) ||
    (m.team1_id === team2Id && m.team2_id === team1Id)
  );
  if (!directMatch) return null;
  const t1Games = (directMatch.team1_score_set1 || 0) + (directMatch.team1_score_set2 || 0) + (directMatch.team1_score_set3 || 0);
  const t2Games = (directMatch.team2_score_set1 || 0) + (directMatch.team2_score_set2 || 0) + (directMatch.team2_score_set3 || 0);
  if (t1Games === t2Games) return null;
  if (directMatch.team1_id === team1Id) return t1Games > t2Games ? team1Id : team2Id;
  return t2Games > t1Games ? team1Id : team2Id;
}

function sortTeamsByTiebreaker(teams, matches, teamOrder = new Map()) {
  return [...teams].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const ptsA = a.wins * 2 + (a.draws || 0);
    const ptsB = b.wins * 2 + (b.draws || 0);
    if (ptsB !== ptsA) return ptsB - ptsA;
    const h2hWinner = getHeadToHeadWinner(a.id, b.id, matches);
    if (h2hWinner === a.id) return -1;
    if (h2hWinner === b.id) return 1;
    const diffA = a.gamesWon - a.gamesLost;
    const diffB = b.gamesWon - b.gamesLost;
    if (diffB !== diffA) return diffB - diffA;
    if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;
    const orderA = teamOrder.get(a.id) ?? 999;
    const orderB = teamOrder.get(b.id) ?? 999;
    return orderA - orderB;
  });
}

async function verifyTournament(tournament, verbose = false) {
  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, group_name, final_position, created_at')
    .eq('tournament_id', tournament.id);

  const { data: allMatches } = await supabase
    .from('matches')
    .select('team1_id, team2_id, group_name, round, status, team1_score_set1, team1_score_set2, team1_score_set3, team2_score_set1, team2_score_set2, team2_score_set3')
    .eq('tournament_id', tournament.id);

  const completedMatches = (allMatches || []).filter(m => m.status === 'completed');
  const matches = completedMatches.filter(m => {
    const r = m.round || '';
    return r === 'round_robin' || r === 'group' || r === 'group_stage' || r.startsWith('group_');
  });

  const totalMatches = allMatches?.length ?? 0;
  const completedCount = completedMatches?.length ?? 0;
  if (!teams?.length || !matches?.length) {
    if (verbose && teams?.length > 0) {
      const rounds = [...new Set((allMatches || []).map(m => m.round))];
      const statuses = [...new Set((allMatches || []).map(m => m.status))];
      console.log(`   [DEBUG] ${tournament.name} (id: ${tournament.id})`);
      console.log(`   [DEBUG] Total matches: ${totalMatches}, rounds: [${rounds.join(', ')}], statuses: [${statuses.join(', ')}]`);
      if (allMatches?.length > 0) {
        console.log(`   [DEBUG] Exemplo match: round=${allMatches[0].round}, status=${allMatches[0].status}`);
      }
    }
    console.log(`   Equipas: ${teams?.length ?? 0}, Jogos fase grupos: ${matches?.length ?? 0} (total: ${totalMatches}, completos: ${completedCount})`);
    return { discrepancies: [], sql: [] };
  }

  const teamOrder = new Map(teams.map((t, i) => [t.id, i]));
  const hasGroups = teams.some(t => t.group_name);
  const groups = hasGroups
    ? [...new Set(teams.map(t => t.group_name).filter(Boolean))]
    : ['Geral'];

  const correctPositions = new Map();

  for (const groupName of groups) {
    const groupTeams = teams.filter(t => (t.group_name || 'Geral') === groupName);
    const groupMatches = hasGroups
      ? matches.filter(m => m.round === `group_${groupName}` || m.group_name === groupName)
      : matches;

    const stats = groupTeams.map(team => {
      let wins = 0, draws = 0, losses = 0, gamesWon = 0, gamesLost = 0;
      groupMatches.forEach(match => {
        const isT1 = match.team1_id === team.id;
        const isT2 = match.team2_id === team.id;
        if (!isT1 && !isT2) return;
        const t1Score = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
        const t2Score = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
        const isDraw = t1Score === t2Score;
        const t1Won = t1Score > t2Score;
        if (isT1) {
          gamesWon += t1Score;
          gamesLost += t2Score;
          if (isDraw) draws++;
          else if (t1Won) wins++;
          else losses++;
        } else {
          gamesWon += t2Score;
          gamesLost += t1Score;
          if (isDraw) draws++;
          else if (!t1Won) wins++;
          else losses++;
        }
      });
      return {
        id: team.id,
        name: team.name,
        group_name: groupName,
        wins,
        draws,
        losses,
        gamesWon,
        gamesLost,
        created_at: team.created_at
      };
    });

    const sorted = sortTeamsByTiebreaker(stats, groupMatches, teamOrder);
    sorted.forEach((s, idx) => {
      correctPositions.set(s.id, { position: idx + 1, group: groupName });
    });
  }

  const discrepancies = [];
  const sql = [];

  for (const team of teams) {
    const correct = correctPositions.get(team.id);
    if (!correct) continue;
    const dbPos = team.final_position;
    if (dbPos !== correct.position) {
      discrepancies.push({
        team: team.name,
        group: correct.group,
        dbPosition: dbPos,
        correctPosition: correct.position
      });
      sql.push(`UPDATE teams SET final_position = ${correct.position} WHERE id = '${team.id}';`);
    }
  }

  return { discrepancies, sql };
}

async function main() {
  const search = process.argv.slice(2).join(' ').trim();

  let query = supabase
    .from('tournaments')
    .select('id, name, status, format, round_robin_type, start_date')
    .eq('status', 'completed')
    .in('format', ['round_robin', 'groups_knockout'])
    .order('start_date', { ascending: false })
    .limit(50);

  if (search) {
    query = query.ilike('name', `%${search}%`);
  }

  const { data: tournaments, error } = await query;

  if (error) {
    console.error('Erro ao buscar torneios:', error.message);
    process.exit(1);
  }

  if (!tournaments?.length) {
    console.log(search ? `Nenhum torneio encontrado com "${search}"` : 'Nenhum torneio concluído.');
    process.exit(0);
  }

  console.log('\n' + '='.repeat(80));
  console.log('VERIFICAÇÃO DE CLASSIFICAÇÃO DE TORNEIOS');
  console.log('='.repeat(80));
  console.log(`\nTorneios a verificar: ${tournaments.length}\n`);

  let foundIssues = false;

  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  for (const t of tournaments) {
    const { discrepancies, sql } = await verifyTournament(t, verbose && !foundIssues);
    if (discrepancies.length > 0) {
      foundIssues = true;
      console.log(`\n⚠️  ${t.name} (${t.start_date})`);
      console.log('   Problemas encontrados:');
      discrepancies.forEach(d => {
        console.log(`   - ${d.team} (Grupo ${d.group}): BD=${d.dbPosition ?? 'NULL'} → Correto=${d.correctPosition}`);
      });
      console.log('\n   SQL para corrigir:');
      sql.forEach(s => console.log('   ' + s));
    }
  }

  if (!foundIssues) {
    console.log('\n✓ Nenhuma discrepância encontrada nos torneios verificados.');
  }

  console.log('\n' + '='.repeat(80));
}

main().catch(console.error);
