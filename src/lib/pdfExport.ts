import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Tournament, Player, Match, TournamentCategory, Team } from './supabase';

interface LeagueStanding {
  id: string;
  entity_name: string;
  total_points: number;
  tournaments_played: number;
  best_position: number | null;
  player_category?: string | null;
}

interface LeagueForExport {
  id: string;
  name: string;
  description?: string;
  start_date: string;
  end_date?: string | null;
  categories?: string[];
  category_scoring_systems?: Record<string, Record<string, number>>;
  scoring_system: Record<string, number>;
}

export async function exportLeagueStandingsPDF(
  league: LeagueForExport,
  standings: LeagueStanding[],
  selectedCategory?: string
): Promise<void> {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let yPos = 20;

  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(league.name, pageWidth / 2, yPos, { align: 'center' });
  yPos += 8;

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  let subtitle = 'Classificacao Geral';
  if (selectedCategory && selectedCategory !== 'all') {
    if (selectedCategory === 'none') {
      subtitle = 'Classificacao - Sem Categoria';
    } else {
      subtitle = `Classificacao - Categoria ${selectedCategory}`;
    }
  }
  doc.text(subtitle, pageWidth / 2, yPos, { align: 'center' });
  yPos += 8;

  const startDate = new Date(league.start_date);
  const startStr = `${String(startDate.getDate()).padStart(2, '0')}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${startDate.getFullYear()}`;
  let dateStr = `Inicio: ${startStr}`;
  if (league.end_date) {
    const endDate = new Date(league.end_date);
    const endStr = `${String(endDate.getDate()).padStart(2, '0')}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${endDate.getFullYear()}`;
    dateStr = `${startStr} - ${endStr}`;
  }
  doc.setFontSize(10);
  doc.text(dateStr, pageWidth / 2, yPos, { align: 'center' });
  yPos += 15;

  if (standings.length === 0) {
    doc.setFontSize(12);
    doc.text('Sem classificacoes registadas', pageWidth / 2, yPos, { align: 'center' });
  } else {
    const sortedStandings = [...standings].sort((a, b) => {
      if (b.total_points !== a.total_points) return b.total_points - a.total_points;
      if ((a.best_position || 999) !== (b.best_position || 999)) {
        return (a.best_position || 999) - (b.best_position || 999);
      }
      return b.tournaments_played - a.tournaments_played;
    });

    const tableData = sortedStandings.map((standing, idx) => [
      (idx + 1).toString(),
      standing.entity_name,
      standing.total_points.toString(),
      standing.tournaments_played.toString(),
      standing.best_position ? `${standing.best_position}o` : '-'
    ]);

    autoTable(doc, {
      startY: yPos,
      head: [['#', 'Jogador', 'Pontos', 'Torneios', 'Melhor Pos.']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246], fontSize: 10, fontStyle: 'bold' },
      bodyStyles: { fontSize: 9 },
      columnStyles: {
        0: { cellWidth: 15, halign: 'center' },
        1: { cellWidth: 80 },
        2: { cellWidth: 25, halign: 'center', fontStyle: 'bold' },
        3: { cellWidth: 25, halign: 'center' },
        4: { cellWidth: 30, halign: 'center' }
      },
      margin: { left: 14, right: 14 }
    });
  }

  const now = new Date();
  const timestamp = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
  doc.setFontSize(8);
  doc.setTextColor(128, 128, 128);
  doc.text(`Gerado em ${timestamp}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 10, { align: 'right' });

  const fileName = `${league.name}_classificacao.pdf`.replace(/\s+/g, '_');
  doc.save(fileName);
}

// Types for team with players
type TeamWithPlayers = Team & {
  player1?: Player;
  player2?: Player;
};

type MatchWithTeams = Match & {
  team1?: TeamWithPlayers | null;
  team2?: TeamWithPlayers | null;
};

interface PlayerStats {
  id: string;
  name: string;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  gamesWon: number;
  gamesLost: number;
  final_position?: number | null;
  group_name?: string | null;
  category_id?: string | null;
}

// Main export function that receives data directly
export async function exportTournamentPDF(
  tournament: Tournament,
  teams: TeamWithPlayers[],
  players: Player[],
  matches: MatchWithTeams[],
  categories: TournamentCategory[],
  t: any
): Promise<void> {
  console.log('[PDF] ====================================');
  console.log('[PDF] Starting export for tournament:', tournament.name);
  console.log('[PDF] Format:', tournament.format);
  console.log('[PDF] Round Robin Type:', tournament.round_robin_type);
  console.log('[PDF] Teams:', teams?.length || 0);
  console.log('[PDF] Players:', players?.length || 0);
  console.log('[PDF] Matches (total):', matches?.length || 0);
  console.log('[PDF] Categories:', categories?.length || 0);
  
  // Debug: show team/player groups
  if (teams?.length > 0) {
    const teamGroups = [...new Set(teams.map(t => t.group_name || 'null'))];
    console.log('[PDF] Team groups:', teamGroups);
  }
  if (players?.length > 0) {
    const playerGroups = [...new Set(players.map(p => p.group_name || 'null'))];
    console.log('[PDF] Player groups:', playerGroups);
  }
  
  // Debug: show match statuses
  const matchStatuses = matches?.reduce((acc, m) => {
    acc[m.status || 'undefined'] = (acc[m.status || 'undefined'] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log('[PDF] Match statuses:', matchStatuses);

  const isIndividualTournament = tournament.format === 'individual_groups_knockout' ||
    (tournament.format === 'round_robin' && tournament.round_robin_type === 'individual');
  
  const isAmerican = tournament.format === 'round_robin' && tournament.round_robin_type === 'american';
  const isGroupsKnockout = tournament.format === 'groups_knockout' || tournament.format === 'individual_groups_knockout';
  const isRoundRobinTeams = tournament.format === 'round_robin' && !tournament.round_robin_type;
  
  console.log('[PDF] isIndividualTournament:', isIndividualTournament);
  console.log('[PDF] isAmerican:', isAmerican);
  console.log('[PDF] isGroupsKnockout:', isGroupsKnockout);
  console.log('[PDF] isRoundRobinTeams:', isRoundRobinTeams);

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let yPos = 20;

  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(tournament.name, pageWidth / 2, yPos, { align: 'center' });
  yPos += 8;

  // Date
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const startDate = new Date(tournament.start_date);
  const dateStr = `${String(startDate.getDate()).padStart(2, '0')}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${startDate.getFullYear()}`;
  doc.text(`Data: ${dateStr}`, pageWidth / 2, yPos, { align: 'center' });
  yPos += 5;

  // Format
  let formatLabel = tournament.format;
  if (isIndividualTournament) formatLabel = 'Individual - Grupos + Eliminatorias';
  else if (isAmerican) formatLabel = 'Americano';
  else if (isGroupsKnockout) formatLabel = 'Equipas - Grupos + Eliminatorias';
  else if (tournament.format === 'round_robin') formatLabel = 'Round Robin';
  
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(`Formato: ${formatLabel}`, pageWidth / 2, yPos, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  yPos += 12;

  // Get completed matches
  const completedMatches = matches.filter(m => m.status === 'completed');
  
  // Debug: show all rounds
  const allRounds = [...new Set(matches.map(m => m.round))];
  console.log('[PDF] All rounds in matches:', allRounds);
  
  // Group matches can have round like "group_A", "group_B", "group A", "A", etc.
  const groupMatches = completedMatches.filter(m => {
    const round = m.round || '';
    return round.startsWith('group_') || 
           round.startsWith('group ') || 
           /^[A-Z]$/.test(round) ||  // Single letter like "A", "B"
           round === 'round_robin';
  });
  const knockoutMatches = completedMatches.filter(m => {
    const round = m.round || '';
    return !round.startsWith('group_') && 
           !round.startsWith('group ') && 
           !/^[A-Z]$/.test(round) &&
           round !== 'round_robin';
  });

  console.log('[PDF] Completed matches:', completedMatches.length);
  console.log('[PDF] Group matches:', groupMatches.length);
  console.log('[PDF] Knockout matches:', knockoutMatches.length);
  
  if (completedMatches.length > 0) {
    console.log('[PDF] Sample match:', completedMatches[0]);
  }

  // ============================================================
  // INDIVIDUAL TOURNAMENT (individual_groups_knockout)
  // ============================================================
  if (isIndividualTournament) {
    yPos = exportIndividualTournament(doc, yPos, tournament, players, groupMatches, knockoutMatches, categories);
  }
  // ============================================================
  // AMERICAN TOURNAMENT or ROUND ROBIN TEAMS (no groups)
  // ============================================================
  else if (isAmerican || isRoundRobinTeams) {
    yPos = exportAmericanTournament(doc, yPos, tournament, teams, completedMatches);
  }
  // ============================================================
  // TEAMS TOURNAMENT (groups_knockout)
  // ============================================================
  else if (teams?.length > 0) {
    // Check if teams have groups defined
    const teamsWithGroups = teams.filter(t => t.group_name && t.group_name !== 'null');
    if (teamsWithGroups.length > 0) {
      yPos = exportTeamsTournament(doc, yPos, tournament, teams, groupMatches, knockoutMatches, categories);
    } else {
      // No groups defined, use American/RoundRobin format
      yPos = exportAmericanTournament(doc, yPos, tournament, teams, completedMatches);
    }
  }
  // ============================================================
  // FALLBACK: Just show matches
  // ============================================================
  else {
    console.log('[PDF] Fallback: No specific format detected');
    yPos = exportAmericanTournament(doc, yPos, tournament, teams, completedMatches);
  }

  // Footer
  const now = new Date();
  const timestamp = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  doc.setFontSize(8);
  doc.setTextColor(128, 128, 128);
  doc.text(`Gerado em ${timestamp}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 10, { align: 'right' });
  doc.text('Padel One Tour', 14, doc.internal.pageSize.getHeight() - 10);

  // Save
  const fileName = `${tournament.name}_resultados.pdf`.replace(/\s+/g, '_');
  doc.save(fileName);
  console.log('[PDF] Saved:', fileName);
}

// ============================================================
// INDIVIDUAL TOURNAMENT EXPORT
// ============================================================
function exportIndividualTournament(
  doc: jsPDF,
  yPos: number,
  tournament: Tournament,
  players: Player[],
  groupMatches: MatchWithTeams[],
  knockoutMatches: MatchWithTeams[],
  categories: TournamentCategory[]
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  
  console.log('[PDF-INDIVIDUAL] Players:', players.length);
  console.log('[PDF-INDIVIDUAL] Group matches:', groupMatches.length);

  // Group players by group
  const playersByGroup = new Map<string, Player[]>();
  players.forEach(player => {
    const groupKey = player.group_name || 'Sem Grupo';
    if (!playersByGroup.has(groupKey)) {
      playersByGroup.set(groupKey, []);
    }
    playersByGroup.get(groupKey)!.push(player);
  });

  const sortedGroups = Array.from(playersByGroup.keys()).sort();
  console.log('[PDF-INDIVIDUAL] Groups found:', sortedGroups);

  // For each group
  for (const groupName of sortedGroups) {
    if (yPos > 240) {
      doc.addPage();
      yPos = 20;
    }

    const groupPlayers = playersByGroup.get(groupName) || [];
    
    // Group title
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(59, 130, 246);
    doc.text(`Grupo ${groupName}`, 14, yPos);
    doc.setTextColor(0, 0, 0);
    yPos += 8;

    // Get matches for this group - handle different round formats
    const thisGroupMatches = groupMatches.filter(m => {
      const round = m.round || '';
      return round === `group_${groupName}` || 
             round === `group ${groupName}` || 
             round === groupName ||
             round === 'round_robin';  // For round robin tournaments all matches count
    });
    
    // If still no matches, try to find by player IDs
    let matchesForStats = thisGroupMatches;
    if (matchesForStats.length === 0 && groupPlayers.length > 0) {
      console.log(`[PDF-INDIVIDUAL] No matches found by round, trying by player IDs`);
      const playerIds = new Set(groupPlayers.map(p => p.id));
      matchesForStats = groupMatches.filter(m => 
        playerIds.has(m.player1_individual_id || '') ||
        playerIds.has(m.player2_individual_id || '') ||
        playerIds.has(m.player3_individual_id || '') ||
        playerIds.has(m.player4_individual_id || '')
      );
    }
    
    console.log(`[PDF-INDIVIDUAL] Group ${groupName}: ${groupPlayers.length} players, ${matchesForStats.length} matches (round formats tried: group_${groupName}, group ${groupName}, ${groupName})`);

    // Calculate stats for each player in this group
    const playerStats: PlayerStats[] = groupPlayers.map(player => {
      const stats: PlayerStats = {
        id: player.id,
        name: player.name,
        matchesPlayed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        gamesWon: 0,
        gamesLost: 0,
        final_position: player.final_position,
        group_name: player.group_name,
        category_id: player.category_id
      };

      matchesForStats.forEach(match => {
        const isTeam1 = match.player1_individual_id === player.id || match.player2_individual_id === player.id;
        const isTeam2 = match.player3_individual_id === player.id || match.player4_individual_id === player.id;
        
        if (!isTeam1 && !isTeam2) return;

        const t1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
        const t2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
        const t1Won = t1Games > t2Games;
        const isDraw = t1Games === t2Games;

        stats.matchesPlayed++;
        
        if (isTeam1) {
          stats.gamesWon += t1Games;
          stats.gamesLost += t2Games;
          if (isDraw) stats.draws++;
          else if (t1Won) stats.wins++;
          else stats.losses++;
        } else {
          stats.gamesWon += t2Games;
          stats.gamesLost += t1Games;
          if (isDraw) stats.draws++;
          else if (!t1Won) stats.wins++;
          else stats.losses++;
        }
      });

      return stats;
    });

    // Sort by wins, then game difference, then games won
    playerStats.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      const diffA = a.gamesWon - a.gamesLost;
      const diffB = b.gamesWon - b.gamesLost;
      if (diffB !== diffA) return diffB - diffA;
      return b.gamesWon - a.gamesWon;
    });

    // Group standings table
    const standingsData = playerStats.map((s, idx) => [
      (idx + 1).toString(),
      s.name,
      s.matchesPlayed.toString(),
      s.wins.toString(),
      s.losses.toString(),
      s.gamesWon.toString(),
      s.gamesLost.toString(),
      (s.gamesWon - s.gamesLost).toString()
    ]);

    autoTable(doc, {
      startY: yPos,
      head: [['#', 'Jogador', 'J', 'V', 'D', 'JG', 'JP', 'Dif']],
      body: standingsData,
      theme: 'striped',
      headStyles: { fillColor: [34, 197, 94], fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 50 },
        2: { cellWidth: 15, halign: 'center' },
        3: { cellWidth: 15, halign: 'center' },
        4: { cellWidth: 15, halign: 'center' },
        5: { cellWidth: 15, halign: 'center' },
        6: { cellWidth: 15, halign: 'center' },
        7: { cellWidth: 15, halign: 'center' }
      },
      margin: { left: 14, right: 14 }
    });

    yPos = (doc as any).lastAutoTable.finalY + 5;

    // Group matches
    if (matchesForStats.length > 0) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Jogos:', 14, yPos);
      yPos += 4;

      const matchData = matchesForStats.map(match => {
        const p1 = players.find(p => p.id === match.player1_individual_id);
        const p2 = players.find(p => p.id === match.player2_individual_id);
        const p3 = players.find(p => p.id === match.player3_individual_id);
        const p4 = players.find(p => p.id === match.player4_individual_id);
        
        const team1Name = p1 && p2 ? `${p1.name} / ${p2.name}` : (p1?.name || '-');
        const team2Name = p3 && p4 ? `${p3.name} / ${p4.name}` : (p3?.name || '-');
        
        const scores: string[] = [];
        if (match.team1_score_set1 != null && match.team2_score_set1 != null) {
          scores.push(`${match.team1_score_set1}-${match.team2_score_set1}`);
        }
        if (match.team1_score_set2 != null && match.team2_score_set2 != null) {
          scores.push(`${match.team1_score_set2}-${match.team2_score_set2}`);
        }
        if (match.team1_score_set3 != null && match.team2_score_set3 != null) {
          scores.push(`${match.team1_score_set3}-${match.team2_score_set3}`);
        }

        return [team1Name, scores.join(' / ') || '-', team2Name];
      });

      autoTable(doc, {
        startY: yPos,
        head: [['Dupla 1', 'Resultado', 'Dupla 2']],
        body: matchData,
        theme: 'grid',
        headStyles: { fillColor: [59, 130, 246], fontSize: 8 },
        bodyStyles: { fontSize: 7 },
        columnStyles: {
          0: { cellWidth: 55 },
          1: { cellWidth: 30, halign: 'center' },
          2: { cellWidth: 55 }
        },
        margin: { left: 14, right: 14 }
      });

      yPos = (doc as any).lastAutoTable.finalY + 10;
    }
  }

  // Knockout phase
  if (knockoutMatches.length > 0) {
    yPos = exportKnockoutPhase(doc, yPos, knockoutMatches, players, null, true);
  }

  // Final standings
  const playersWithPosition = players.filter(p => p.final_position != null);
  if (playersWithPosition.length > 0) {
    yPos = exportFinalStandings(doc, yPos, playersWithPosition, true);
  }

  return yPos;
}

// ============================================================
// AMERICAN TOURNAMENT EXPORT
// ============================================================
function exportAmericanTournament(
  doc: jsPDF,
  yPos: number,
  tournament: Tournament,
  teams: TeamWithPlayers[],
  matches: MatchWithTeams[]
): number {
  const pageWidth = doc.internal.pageSize.getWidth();

  console.log('[PDF-AMERICAN] Teams:', teams.length);
  console.log('[PDF-AMERICAN] Matches:', matches.length);

  // Section title
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(249, 115, 22);
  doc.text('Torneio Americano', 14, yPos);
  doc.setTextColor(0, 0, 0);
  yPos += 10;

  // Calculate stats for each team
  const teamStats: PlayerStats[] = teams.map(team => {
    const stats: PlayerStats = {
      id: team.id,
      name: team.name,
      matchesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      gamesWon: 0,
      gamesLost: 0,
      final_position: team.final_position,
      group_name: team.group_name
    };

    matches.forEach(match => {
      const isTeam1 = match.team1_id === team.id;
      const isTeam2 = match.team2_id === team.id;
      
      if (!isTeam1 && !isTeam2) return;

      const t1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
      const t2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
      const t1Won = t1Games > t2Games;
      const isDraw = t1Games === t2Games;

      stats.matchesPlayed++;
      
      if (isTeam1) {
        stats.gamesWon += t1Games;
        stats.gamesLost += t2Games;
        if (isDraw) stats.draws++;
        else if (t1Won) stats.wins++;
        else stats.losses++;
      } else {
        stats.gamesWon += t2Games;
        stats.gamesLost += t1Games;
        if (isDraw) stats.draws++;
        else if (!t1Won) stats.wins++;
        else stats.losses++;
      }
    });

    return stats;
  });

  // Sort
  teamStats.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const diffA = a.gamesWon - a.gamesLost;
    const diffB = b.gamesWon - b.gamesLost;
    if (diffB !== diffA) return diffB - diffA;
    return b.gamesWon - a.gamesWon;
  });

  // Standings table
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Classificacao:', 14, yPos);
  yPos += 5;

  const standingsData = teamStats.map((s, idx) => {
    const playerNames = getTeamPlayerNames(teams.find(t => t.id === s.id));
    return [
      (idx + 1).toString(),
      s.name,
      playerNames,
      s.matchesPlayed.toString(),
      s.wins.toString(),
      s.losses.toString(),
      s.gamesWon.toString(),
      s.gamesLost.toString(),
      (s.gamesWon - s.gamesLost).toString()
    ];
  });

  autoTable(doc, {
    startY: yPos,
    head: [['#', 'Equipa', 'Jogadores', 'J', 'V', 'D', 'JG', 'JP', 'Dif']],
    body: standingsData,
    theme: 'striped',
    headStyles: { fillColor: [249, 115, 22], fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 30 },
      2: { cellWidth: 45 },
      3: { cellWidth: 12, halign: 'center' },
      4: { cellWidth: 12, halign: 'center' },
      5: { cellWidth: 12, halign: 'center' },
      6: { cellWidth: 12, halign: 'center' },
      7: { cellWidth: 12, halign: 'center' },
      8: { cellWidth: 12, halign: 'center' }
    },
    margin: { left: 14, right: 14 }
  });

  yPos = (doc as any).lastAutoTable.finalY + 10;

  // Matches
  if (matches.length > 0) {
    if (yPos > 200) {
      doc.addPage();
      yPos = 20;
    }

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Jogos:', 14, yPos);
    yPos += 5;

    const matchData = matches.map(match => {
      const team1 = teams.find(t => t.id === match.team1_id);
      const team2 = teams.find(t => t.id === match.team2_id);
      
      const scores: string[] = [];
      if (match.team1_score_set1 != null && match.team2_score_set1 != null) {
        scores.push(`${match.team1_score_set1}-${match.team2_score_set1}`);
      }
      if (match.team1_score_set2 != null && match.team2_score_set2 != null) {
        scores.push(`${match.team1_score_set2}-${match.team2_score_set2}`);
      }
      if (match.team1_score_set3 != null && match.team2_score_set3 != null) {
        scores.push(`${match.team1_score_set3}-${match.team2_score_set3}`);
      }

      return [
        team1?.name || '-',
        scores.join(' / ') || '-',
        team2?.name || '-'
      ];
    });

    autoTable(doc, {
      startY: yPos,
      head: [['Equipa 1', 'Resultado', 'Equipa 2']],
      body: matchData,
      theme: 'grid',
      headStyles: { fillColor: [59, 130, 246], fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 55 },
        1: { cellWidth: 35, halign: 'center' },
        2: { cellWidth: 55 }
      },
      margin: { left: 14, right: 14 }
    });

    yPos = (doc as any).lastAutoTable.finalY + 10;
  }

  // ============================================================
  // INDIVIDUAL STANDINGS FOR AMERICAN TOURNAMENT
  // ============================================================
  // Get all unique players from teams
  const playerMap = new Map<string, { id: string; name: string; wins: number; losses: number; draws: number; gamesWon: number; gamesLost: number; matchesPlayed: number }>();
  
  teams.forEach(team => {
    if (team.player1?.id && team.player1?.name) {
      if (!playerMap.has(team.player1.id)) {
        playerMap.set(team.player1.id, { 
          id: team.player1.id, 
          name: team.player1.name, 
          wins: 0, losses: 0, draws: 0, gamesWon: 0, gamesLost: 0, matchesPlayed: 0 
        });
      }
    }
    if (team.player2?.id && team.player2?.name) {
      if (!playerMap.has(team.player2.id)) {
        playerMap.set(team.player2.id, { 
          id: team.player2.id, 
          name: team.player2.name, 
          wins: 0, losses: 0, draws: 0, gamesWon: 0, gamesLost: 0, matchesPlayed: 0 
        });
      }
    }
  });

  console.log('[PDF-AMERICAN] Unique players found:', playerMap.size);

  // Calculate individual stats
  matches.forEach(match => {
    const team1 = teams.find(t => t.id === match.team1_id);
    const team2 = teams.find(t => t.id === match.team2_id);
    
    if (!team1 || !team2) return;

    const t1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
    const t2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
    const t1Won = t1Games > t2Games;
    const isDraw = t1Games === t2Games;

    // Team 1 players
    [team1.player1?.id, team1.player2?.id].forEach(playerId => {
      if (playerId && playerMap.has(playerId)) {
        const stats = playerMap.get(playerId)!;
        stats.matchesPlayed++;
        stats.gamesWon += t1Games;
        stats.gamesLost += t2Games;
        if (isDraw) stats.draws++;
        else if (t1Won) stats.wins++;
        else stats.losses++;
      }
    });

    // Team 2 players
    [team2.player1?.id, team2.player2?.id].forEach(playerId => {
      if (playerId && playerMap.has(playerId)) {
        const stats = playerMap.get(playerId)!;
        stats.matchesPlayed++;
        stats.gamesWon += t2Games;
        stats.gamesLost += t1Games;
        if (isDraw) stats.draws++;
        else if (!t1Won) stats.wins++;
        else stats.losses++;
      }
    });
  });

  // Sort players
  const individualStats = Array.from(playerMap.values()).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const diffA = a.gamesWon - a.gamesLost;
    const diffB = b.gamesWon - b.gamesLost;
    if (diffB !== diffA) return diffB - diffA;
    return b.gamesWon - a.gamesWon;
  });

  if (individualStats.length > 0) {
    if (yPos > 180) {
      doc.addPage();
      yPos = 20;
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(139, 92, 246);
    doc.text('Classificacao Individual', 14, yPos);
    doc.setTextColor(0, 0, 0);
    yPos += 8;

    const individualData = individualStats.map((s, idx) => {
      let posLabel = `${idx + 1}o`;
      if (idx === 0) posLabel = '1o';
      else if (idx === 1) posLabel = '2o';
      else if (idx === 2) posLabel = '3o';
      
      const diff = s.gamesWon - s.gamesLost;
      return [
        posLabel,
        s.name,
        s.matchesPlayed.toString(),
        s.wins.toString(),
        s.losses.toString(),
        s.gamesWon.toString(),
        s.gamesLost.toString(),
        (diff >= 0 ? '+' : '') + diff.toString()
      ];
    });

    autoTable(doc, {
      startY: yPos,
      head: [['#', 'Jogador', 'J', 'V', 'D', 'JG', 'JP', 'Dif']],
      body: individualData,
      theme: 'striped',
      headStyles: { fillColor: [139, 92, 246], fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        1: { cellWidth: 50 },
        2: { cellWidth: 15, halign: 'center' },
        3: { cellWidth: 15, halign: 'center' },
        4: { cellWidth: 15, halign: 'center' },
        5: { cellWidth: 15, halign: 'center' },
        6: { cellWidth: 15, halign: 'center' },
        7: { cellWidth: 18, halign: 'center' }
      },
      margin: { left: 14, right: 14 }
    });

    yPos = (doc as any).lastAutoTable.finalY + 10;
  }

  return yPos;
}

// ============================================================
// TEAMS TOURNAMENT EXPORT (groups_knockout)
// ============================================================
function exportTeamsTournament(
  doc: jsPDF,
  yPos: number,
  tournament: Tournament,
  teams: TeamWithPlayers[],
  groupMatches: MatchWithTeams[],
  knockoutMatches: MatchWithTeams[],
  categories: TournamentCategory[]
): number {
  const pageWidth = doc.internal.pageSize.getWidth();

  console.log('[PDF-TEAMS] Teams:', teams.length);
  console.log('[PDF-TEAMS] Group matches:', groupMatches.length);

  // Group teams by group
  const teamsByGroup = new Map<string, TeamWithPlayers[]>();
  teams.forEach(team => {
    const groupKey = team.group_name || 'Sem Grupo';
    if (!teamsByGroup.has(groupKey)) {
      teamsByGroup.set(groupKey, []);
    }
    teamsByGroup.get(groupKey)!.push(team);
  });

  const sortedGroups = Array.from(teamsByGroup.keys()).sort();
  console.log('[PDF-TEAMS] Groups found:', sortedGroups);

  // For each group
  for (const groupName of sortedGroups) {
    if (yPos > 240) {
      doc.addPage();
      yPos = 20;
    }

    const groupTeams = teamsByGroup.get(groupName) || [];
    
    // Group title
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(59, 130, 246);
    doc.text(`Grupo ${groupName}`, 14, yPos);
    doc.setTextColor(0, 0, 0);
    yPos += 8;

    // Get matches for this group - handle different round formats
    const thisGroupMatches = groupMatches.filter(m => {
      const round = m.round || '';
      return round === `group_${groupName}` || 
             round === `group ${groupName}` || 
             round === groupName ||
             round === 'round_robin';
    });
    
    // If still no matches, try to find by team IDs
    let matchesForStats = thisGroupMatches;
    if (matchesForStats.length === 0 && groupTeams.length > 0) {
      console.log(`[PDF-TEAMS] No matches found by round, trying by team IDs`);
      const teamIds = new Set(groupTeams.map(t => t.id));
      matchesForStats = groupMatches.filter(m => 
        teamIds.has(m.team1_id || '') || teamIds.has(m.team2_id || '')
      );
    }
    
    console.log(`[PDF-TEAMS] Group ${groupName}: ${groupTeams.length} teams, ${matchesForStats.length} matches`);

    // Calculate stats for each team in this group
    const teamStats: PlayerStats[] = groupTeams.map(team => {
      const stats: PlayerStats = {
        id: team.id,
        name: team.name,
        matchesPlayed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        gamesWon: 0,
        gamesLost: 0,
        final_position: team.final_position,
        group_name: team.group_name
      };

      matchesForStats.forEach(match => {
        const isTeam1 = match.team1_id === team.id;
        const isTeam2 = match.team2_id === team.id;
        
        if (!isTeam1 && !isTeam2) return;

        const t1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
        const t2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
        const t1Won = t1Games > t2Games;
        const isDraw = t1Games === t2Games;

        stats.matchesPlayed++;
        
        if (isTeam1) {
          stats.gamesWon += t1Games;
          stats.gamesLost += t2Games;
          if (isDraw) stats.draws++;
          else if (t1Won) stats.wins++;
          else stats.losses++;
        } else {
          stats.gamesWon += t2Games;
          stats.gamesLost += t1Games;
          if (isDraw) stats.draws++;
          else if (!t1Won) stats.wins++;
          else stats.losses++;
        }
      });

      return stats;
    });

    // Sort
    teamStats.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      const diffA = a.gamesWon - a.gamesLost;
      const diffB = b.gamesWon - b.gamesLost;
      if (diffB !== diffA) return diffB - diffA;
      return b.gamesWon - a.gamesWon;
    });

    // Group standings table
    const standingsData = teamStats.map((s, idx) => {
      const team = groupTeams.find(t => t.id === s.id);
      const playerNames = getTeamPlayerNames(team);
      return [
        (idx + 1).toString(),
        s.name,
        playerNames,
        s.matchesPlayed.toString(),
        s.wins.toString(),
        s.losses.toString(),
        s.gamesWon.toString(),
        s.gamesLost.toString(),
        (s.gamesWon - s.gamesLost).toString()
      ];
    });

    autoTable(doc, {
      startY: yPos,
      head: [['#', 'Equipa', 'Jogadores', 'J', 'V', 'D', 'JG', 'JP', 'Dif']],
      body: standingsData,
      theme: 'striped',
      headStyles: { fillColor: [34, 197, 94], fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 28 },
        2: { cellWidth: 42 },
        3: { cellWidth: 12, halign: 'center' },
        4: { cellWidth: 12, halign: 'center' },
        5: { cellWidth: 12, halign: 'center' },
        6: { cellWidth: 12, halign: 'center' },
        7: { cellWidth: 12, halign: 'center' },
        8: { cellWidth: 12, halign: 'center' }
      },
      margin: { left: 14, right: 14 }
    });

    yPos = (doc as any).lastAutoTable.finalY + 5;

    // Group matches
    if (matchesForStats.length > 0) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Jogos:', 14, yPos);
      yPos += 4;

      const matchData = matchesForStats.map(match => {
        const team1 = teams.find(t => t.id === match.team1_id);
        const team2 = teams.find(t => t.id === match.team2_id);
        
        const scores: string[] = [];
        if (match.team1_score_set1 != null && match.team2_score_set1 != null) {
          scores.push(`${match.team1_score_set1}-${match.team2_score_set1}`);
        }
        if (match.team1_score_set2 != null && match.team2_score_set2 != null) {
          scores.push(`${match.team1_score_set2}-${match.team2_score_set2}`);
        }
        if (match.team1_score_set3 != null && match.team2_score_set3 != null) {
          scores.push(`${match.team1_score_set3}-${match.team2_score_set3}`);
        }

        return [team1?.name || '-', scores.join(' / ') || '-', team2?.name || '-'];
      });

      autoTable(doc, {
        startY: yPos,
        head: [['Equipa 1', 'Resultado', 'Equipa 2']],
        body: matchData,
        theme: 'grid',
        headStyles: { fillColor: [59, 130, 246], fontSize: 8 },
        bodyStyles: { fontSize: 7 },
        columnStyles: {
          0: { cellWidth: 55 },
          1: { cellWidth: 30, halign: 'center' },
          2: { cellWidth: 55 }
        },
        margin: { left: 14, right: 14 }
      });

      yPos = (doc as any).lastAutoTable.finalY + 10;
    }
  }

  // Knockout phase
  if (knockoutMatches.length > 0) {
    yPos = exportKnockoutPhase(doc, yPos, knockoutMatches, null, teams, false);
  }

  // Final standings
  const teamsWithPosition = teams.filter(t => t.final_position != null);
  if (teamsWithPosition.length > 0) {
    yPos = exportFinalStandingsTeams(doc, yPos, teamsWithPosition, teams);
  }

  return yPos;
}

// ============================================================
// KNOCKOUT PHASE EXPORT
// ============================================================
function exportKnockoutPhase(
  doc: jsPDF,
  yPos: number,
  knockoutMatches: MatchWithTeams[],
  players: Player[] | null,
  teams: TeamWithPlayers[] | null,
  isIndividual: boolean
): number {
  if (yPos > 200) {
    doc.addPage();
    yPos = 20;
  }

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(249, 115, 22);
  doc.text('Fase Eliminatoria', 14, yPos);
  doc.setTextColor(0, 0, 0);
  yPos += 10;

  const roundOrder = [
    'round_of_16', 'quarter_final', 'quarterfinals', 
    'semi_final', 'semifinal', 'semifinals',
    'mixed_semifinal1', 'mixed_semifinal2',
    'crossed_r1_j1', 'crossed_r1_j2', 'crossed_r1_j3',
    'crossed_r2_semifinal1', 'crossed_r2_semifinal2', 'crossed_r2_5th_place',
    'crossed_r3_3rd_place', 'crossed_r3_final',
    'mixed_3rd_place', 'mixed_final',
    '5th_place', '3rd_place', 'final'
  ];

  const roundNames: { [key: string]: string } = {
    'round_of_16': 'Oitavos de Final',
    'quarter_final': 'Quartos de Final',
    'quarterfinals': 'Quartos de Final',
    'semi_final': 'Meias-Finais',
    'semifinal': 'Meias-Finais',
    'semifinals': 'Meias-Finais',
    'mixed_semifinal1': 'Meia-Final 1',
    'mixed_semifinal2': 'Meia-Final 2',
    'crossed_r1_j1': 'Playoffs - Jogo 1',
    'crossed_r1_j2': 'Playoffs - Jogo 2',
    'crossed_r1_j3': 'Playoffs - Jogo 3',
    'crossed_r2_semifinal1': 'Playoff - Meia-Final 1',
    'crossed_r2_semifinal2': 'Playoff - Meia-Final 2',
    'crossed_r2_5th_place': '5o/6o Lugar',
    'crossed_r3_3rd_place': '3o/4o Lugar',
    'crossed_r3_final': 'FINAL',
    'mixed_3rd_place': '3o/4o Lugar',
    'mixed_final': 'FINAL',
    '5th_place': '5o/6o Lugar',
    '3rd_place': '3o/4o Lugar',
    'final': 'FINAL'
  };

  // Group by round
  const matchesByRound = new Map<string, MatchWithTeams[]>();
  knockoutMatches.forEach(match => {
    const round = match.round || 'other';
    if (!matchesByRound.has(round)) {
      matchesByRound.set(round, []);
    }
    matchesByRound.get(round)!.push(match);
  });

  const sortedRounds = Array.from(matchesByRound.keys()).sort((a, b) => {
    const aIdx = roundOrder.indexOf(a);
    const bIdx = roundOrder.indexOf(b);
    if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  for (const round of sortedRounds) {
    if (yPos > 260) {
      doc.addPage();
      yPos = 20;
    }

    const roundMatches = matchesByRound.get(round) || [];
    const roundName = roundNames[round] || round;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(roundName, 14, yPos);
    yPos += 5;

    const matchData = roundMatches.map(match => {
      let team1Name: string;
      let team2Name: string;

      if (isIndividual && players) {
        const p1 = players.find(p => p.id === match.player1_individual_id);
        const p2 = players.find(p => p.id === match.player2_individual_id);
        const p3 = players.find(p => p.id === match.player3_individual_id);
        const p4 = players.find(p => p.id === match.player4_individual_id);
        team1Name = p1 && p2 ? `${p1.name} / ${p2.name}` : (p1?.name || 'TBD');
        team2Name = p3 && p4 ? `${p3.name} / ${p4.name}` : (p3?.name || 'TBD');
      } else if (teams) {
        const team1 = teams.find(t => t.id === match.team1_id);
        const team2 = teams.find(t => t.id === match.team2_id);
        team1Name = team1?.name || 'TBD';
        team2Name = team2?.name || 'TBD';
      } else {
        team1Name = 'TBD';
        team2Name = 'TBD';
      }

      const scores: string[] = [];
      if (match.team1_score_set1 != null && match.team2_score_set1 != null) {
        scores.push(`${match.team1_score_set1}-${match.team2_score_set1}`);
      }
      if (match.team1_score_set2 != null && match.team2_score_set2 != null) {
        scores.push(`${match.team1_score_set2}-${match.team2_score_set2}`);
      }
      if (match.team1_score_set3 != null && match.team2_score_set3 != null) {
        scores.push(`${match.team1_score_set3}-${match.team2_score_set3}`);
      }

      return [team1Name, scores.join(' / ') || '-', team2Name];
    });

    autoTable(doc, {
      startY: yPos,
      head: [[isIndividual ? 'Dupla 1' : 'Equipa 1', 'Resultado', isIndividual ? 'Dupla 2' : 'Equipa 2']],
      body: matchData,
      theme: 'grid',
      headStyles: { fillColor: [249, 115, 22], fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      columnStyles: {
        0: { cellWidth: 55 },
        1: { cellWidth: 30, halign: 'center' },
        2: { cellWidth: 55 }
      },
      margin: { left: 14, right: 14 }
    });

    yPos = (doc as any).lastAutoTable.finalY + 8;
  }

  return yPos;
}

// ============================================================
// FINAL STANDINGS EXPORT (Individual)
// ============================================================
function exportFinalStandings(
  doc: jsPDF,
  yPos: number,
  playersWithPosition: Player[],
  isIndividual: boolean
): number {
  if (yPos > 200) {
    doc.addPage();
    yPos = 20;
  }

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(139, 92, 246);
  doc.text('Classificacao Final', 14, yPos);
  doc.setTextColor(0, 0, 0);
  yPos += 8;

  playersWithPosition.sort((a, b) => (a.final_position || 999) - (b.final_position || 999));

  const finalData = playersWithPosition.map(player => {
    let posLabel = `${player.final_position}o`;
    if (player.final_position === 1) posLabel = '1o - Campeao';
    else if (player.final_position === 2) posLabel = '2o - Finalista';
    else if (player.final_position === 3) posLabel = '3o';

    return [posLabel, player.name, player.group_name || '-'];
  });

  autoTable(doc, {
    startY: yPos,
    head: [['Posicao', 'Jogador', 'Grupo']],
    body: finalData,
    theme: 'striped',
    headStyles: { fillColor: [139, 92, 246], fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 35 },
      1: { cellWidth: 80 },
      2: { cellWidth: 25, halign: 'center' }
    },
    margin: { left: 14, right: 14 }
  });

  return (doc as any).lastAutoTable.finalY + 10;
}

// ============================================================
// FINAL STANDINGS EXPORT (Teams)
// ============================================================
function exportFinalStandingsTeams(
  doc: jsPDF,
  yPos: number,
  teamsWithPosition: TeamWithPlayers[],
  allTeams: TeamWithPlayers[]
): number {
  if (yPos > 200) {
    doc.addPage();
    yPos = 20;
  }

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(139, 92, 246);
  doc.text('Classificacao Final', 14, yPos);
  doc.setTextColor(0, 0, 0);
  yPos += 8;

  teamsWithPosition.sort((a, b) => (a.final_position || 999) - (b.final_position || 999));

  const finalData = teamsWithPosition.map(team => {
    let posLabel = `${team.final_position}o`;
    if (team.final_position === 1) posLabel = '1o - Campeao';
    else if (team.final_position === 2) posLabel = '2o - Finalista';
    else if (team.final_position === 3) posLabel = '3o';

    const playerNames = getTeamPlayerNames(team);

    return [posLabel, team.name, playerNames, team.group_name || '-'];
  });

  autoTable(doc, {
    startY: yPos,
    head: [['Posicao', 'Equipa', 'Jogadores', 'Grupo']],
    body: finalData,
    theme: 'striped',
    headStyles: { fillColor: [139, 92, 246], fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 40 },
      2: { cellWidth: 55 },
      3: { cellWidth: 20, halign: 'center' }
    },
    margin: { left: 14, right: 14 }
  });

  return (doc as any).lastAutoTable.finalY + 10;
}

// Helper function to get team player names
function getTeamPlayerNames(team?: TeamWithPlayers | null): string {
  if (!team) return '';
  
  const names: string[] = [];
  if (team.player1?.name) names.push(team.player1.name);
  if (team.player2?.name) names.push(team.player2.name);
  
  if (names.length > 0) return names.join(' / ');
  
  // Fallback: check if team name contains player names
  if (team.name?.includes(' / ')) return '';
  if (team.name?.includes(' e ')) return team.name.replace(' e ', ' / ');
  if (team.name?.includes(' & ')) return team.name.replace(' & ', ' / ');
  
  return '';
}
