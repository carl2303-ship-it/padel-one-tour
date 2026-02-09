/**
 * Corrige a classificação de um torneio round_robin por equipas.
 * Uso: node scripts/fix-tournament-standings.mjs "LIGA APC N-S M4-2"
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

async function main() {
  const searchName = process.argv[2] || 'LIGA APC N-S M4-2';

  const { data: tournaments, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, format')
    .ilike('name', `%${searchName}%`);

  if (tErr || !tournaments?.length) {
    console.error('Torneio não encontrado:', tErr?.message);
    process.exit(1);
  }

  const tournament = tournaments[0];
  console.log('\n=== Torneio:', tournament.name, '===');
  console.log('ID:', tournament.id);
  console.log('Formato:', tournament.format);

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, group_name, final_position, created_at, category_id')
    .eq('tournament_id', tournament.id)
    .order('created_at', { ascending: true });

  const { data: allMatches } = await supabase
    .from('matches')
    .select('id, team1_id, team2_id, round, status, category_id, team1_score_set1, team1_score_set2, team1_score_set3, team2_score_set1, team2_score_set2, team2_score_set3')
    .eq('tournament_id', tournament.id);

  console.log('\nEquipas:', teams?.length ?? 0);
  console.log('Total jogos:', allMatches?.length ?? 0);

  const completedMatches = (allMatches || []).filter(m => m.status === 'completed');
  console.log('Jogos completos:', completedMatches.length);

  if (completedMatches.length > 0) {
    const rounds = [...new Set(completedMatches.map(m => m.round))];
    console.log('Rounds nos jogos completos:', rounds.join(', '));
  }

  if (!teams?.length || !completedMatches?.length) {
    console.error('\nSem equipas ou jogos completos. Não é possível calcular.');
    process.exit(1);
  }

  const hasCategories = teams.some(t => t.category_id);
  let matchList = completedMatches;
  const filtered = completedMatches.filter(m => {
    const r = m.round || '';
    return !r || r === 'round_robin' || r.startsWith('group_') || r === 'group' || r === 'group_stage';
  });
  if (filtered.length > 0) {
    matchList = filtered;
  } else {
    console.log('\nUsando todos os jogos completos (sem filtro de round).');
  }
  const teamOrder = new Map(teams.map((t, i) => [t.id, i]));

  const groups = teams.some(t => t.group_name)
    ? [...new Set(teams.map(t => t.group_name || 'Geral').filter(Boolean))]
    : ['Geral'];

  const sql = [];
  console.log('\n--- Classificação calculada (critérios: 1.Vitórias 2.Pontos 3.Confronto direto 4.+/- 5.Jogos 6.Inscrição) ---\n');

  for (const groupName of groups) {
    const groupTeams = teams.filter(t => (t.group_name || 'Geral') === groupName);
    const groupMatches = hasCategories
      ? matchList.filter(m => {
          const t1 = teams.find(t => t.id === m.team1_id);
          const t2 = teams.find(t => t.id === m.team2_id);
          return t1 && t2 && (t1.group_name || 'Geral') === groupName && (t2.group_name || 'Geral') === groupName;
        })
      : matchList.filter(m => {
          const t1 = teams.find(t => t.id === m.team1_id);
          const t2 = teams.find(t => t.id === m.team2_id);
          return t1 && t2;
        });

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
      return { id: team.id, name: team.name, wins, draws, losses, gamesWon, gamesLost };
    });

    const sorted = sortTeamsByTiebreaker(stats, groupMatches, teamOrder);

    const prefix = groups.length > 1 ? `Grupo ${groupName}: ` : '';
    sorted.forEach((s, idx) => {
      const pos = idx + 1;
      const pts = s.wins * 2 + s.draws;
      const diff = s.gamesWon - s.gamesLost;
      const dbTeam = teams.find(t => t.id === s.id);
      const dbPos = dbTeam?.final_position;
      const changed = dbPos !== pos;
      console.log(`${prefix}${pos}º ${s.name} | V:${s.wins} E:${s.draws} D:${s.losses} | +/-:${diff > 0 ? '+' : ''}${diff} | Pts:${pts} ${dbPos !== undefined && changed ? `[BD tinha ${dbPos}º]` : ''}`);
      sql.push(`UPDATE teams SET final_position = ${pos} WHERE id = '${s.id}';`);
    });
    console.log('');
  }

  console.log('--- SQL para executar no Supabase SQL Editor ---\n');
  sql.forEach(s => console.log(s));
  console.log('\n--- Fim ---');
}

main().catch(console.error);
