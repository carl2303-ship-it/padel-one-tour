import { supabase } from './supabase';

export type Team = {
  id: string;
  name: string;
  group_name?: string;
  wins?: number;
  losses?: number;
  points_for?: number;
  points_against?: number;
};

export type TeamStats = {
  id: string;
  name?: string;
  group_name: string;
  wins: number;
  draws?: number;
  gamesWon: number;
  gamesLost: number;
  created_at?: string;
};

export type MatchData = {
  team1_id: string;
  team2_id: string;
  winner_id?: string | null;
  team1_score_set1?: number;
  team2_score_set1?: number;
  team1_score_set2?: number;
  team2_score_set2?: number;
  team1_score_set3?: number;
  team2_score_set3?: number;
};

function getHeadToHeadWinner(team1Id: string, team2Id: string, matches: MatchData[]): string | null {
  const directMatch = matches.find(m =>
    (m.team1_id === team1Id && m.team2_id === team2Id) ||
    (m.team1_id === team2Id && m.team2_id === team1Id)
  );

  if (!directMatch) return null;

  const team1Games = (directMatch.team1_score_set1 || 0) + (directMatch.team1_score_set2 || 0) + (directMatch.team1_score_set3 || 0);
  const team2Games = (directMatch.team2_score_set1 || 0) + (directMatch.team2_score_set2 || 0) + (directMatch.team2_score_set3 || 0);

  if (team1Games === team2Games) return null;

  if (directMatch.team1_id === team1Id) {
    return team1Games > team2Games ? team1Id : team2Id;
  } else {
    return team2Games > team1Games ? team1Id : team2Id;
  }
}

export function sortTeamsByTiebreaker(
  teams: TeamStats[],
  matches: MatchData[],
  teamOrder?: Map<string, number>
): TeamStats[] {
  return [...teams].sort((a, b) => {
    // 1° Número de vitórias
    if (b.wins !== a.wins) return b.wins - a.wins;

    // 2° Pontos (V=2, E=1, D=0)
    const ptsA = a.wins * 2 + (a.draws || 0);
    const ptsB = b.wins * 2 + (b.draws || 0);
    if (ptsB !== ptsA) return ptsB - ptsA;

    // 3° Confronto direto (apenas aplicável quando comparamos 2 equipas)
    const h2hWinner = getHeadToHeadWinner(a.id, b.id, matches);
    if (h2hWinner === a.id) return -1;
    if (h2hWinner === b.id) return 1;

    // 4° Diferença de jogos
    const diffA = a.gamesWon - a.gamesLost;
    const diffB = b.gamesWon - b.gamesLost;
    if (diffB !== diffA) return diffB - diffA;

    // 5° Maior número de jogos ganhos
    if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;

    // 6° Data de inscrição (quem se inscreveu primeiro)
    if (teamOrder) {
      const orderA = teamOrder.get(a.id) ?? 999;
      const orderB = teamOrder.get(b.id) ?? 999;
      return orderA - orderB;
    }

    if (a.created_at && b.created_at) {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }

    return 0;
  });
}

/**
 * Randomly assigns teams to groups
 * @param teams - Array of teams to assign
 * @param numberOfGroups - Number of groups to create
 * @returns Array of teams with group_name assigned (A, B, C, etc.)
 */
export function assignTeamsToGroups(teams: Team[], numberOfGroups: number): Team[] {
  console.log('[ASSIGN GROUPS] Input - Teams:', teams.length, 'Number of groups:', numberOfGroups);

  // Shuffle teams randomly
  const shuffled = [...teams].sort(() => Math.random() - 0.5);

  const groupNames = Array.from({ length: numberOfGroups }, (_, i) =>
    String.fromCharCode(65 + i) // A, B, C, D, etc.
  );

  console.log('[ASSIGN GROUPS] Group names created:', groupNames);

  // Distribute teams round-robin to ensure balance
  // Example: 12 teams, 3 groups -> 4,4,4 (perfect balance)
  // Example: 13 teams, 3 groups -> 5,4,4 (as balanced as possible)
  const result = shuffled.map((team, index) => ({
    ...team,
    group_name: groupNames[index % numberOfGroups]
  }));

  console.log('[ASSIGN GROUPS] Result - Groups distribution:',
    groupNames.map(g => ({ group: g, count: result.filter(t => t.group_name === g).length }))
  );

  return result;
}

/**
 * Saves group assignments to the database
 */
export async function saveGroupAssignments(tournamentId: string, teams: Team[]) {
  for (const team of teams) {
    const { error } = await supabase
      .from('teams')
      .update({ group_name: team.group_name })
      .eq('id', team.id);

    if (error) {
      console.error('Error updating team group:', error);
      throw error;
    }
  }
}

/**
 * Gets teams organized by group
 */
export function getTeamsByGroup(teams: Team[]): Map<string, Team[]> {
  const grouped = new Map<string, Team[]>();

  teams.forEach(team => {
    if (team.group_name) {
      if (!grouped.has(team.group_name)) {
        grouped.set(team.group_name, []);
      }
      grouped.get(team.group_name)!.push(team);
    }
  });

  return grouped;
}

/**
 * Gets individual players organized by group
 */
export function getPlayersByGroup(players: IndividualPlayer[]): Map<string, IndividualPlayer[]> {
  const grouped = new Map<string, IndividualPlayer[]>();

  players.forEach(player => {
    if (player.group_name) {
      if (!grouped.has(player.group_name)) {
        grouped.set(player.group_name, []);
      }
      grouped.get(player.group_name)!.push(player);
    }
  });

  return grouped;
}

/**
 * Gets qualified teams based on knockout stage target
 * @param tournamentId - Tournament ID
 * @param knockoutStage - Target knockout stage ('semifinals', 'quarterfinals', 'round_of_16')
 * @param categoryId - Optional category ID to filter teams
 * @returns Array of qualified team IDs
 */
export async function getQualifiedTeamsByKnockoutStage(
  tournamentId: string,
  knockoutStage: 'semifinals' | 'quarterfinals' | 'round_of_16',
  categoryId?: string
): Promise<string[]> {
  const targetTeams = knockoutStage === 'semifinals' ? 4 : knockoutStage === 'quarterfinals' ? 8 : 16;

  // Get all teams with their group assignments
  let teamsQuery = supabase
    .from('teams')
    .select('id, group_name, category_id')
    .eq('tournament_id', tournamentId)
    .not('group_name', 'is', null);

  if (categoryId) {
    teamsQuery = teamsQuery.eq('category_id', categoryId);
  }

  const { data: teams, error: teamsError } = await teamsQuery;

  if (teamsError || !teams) {
    console.error('Error fetching teams:', teamsError);
    return [];
  }

  // Get number of groups
  const groups = new Set(teams.map(t => t.group_name));
  const numGroups = groups.size;

  // Calculate how many from each group (minimum is top 2, then add best 3rds)
  const guaranteedPerGroup = Math.floor(targetTeams / numGroups);
  const needBestThirds = targetTeams - (guaranteedPerGroup * numGroups);

  console.log('[KNOCKOUT] Target:', targetTeams, 'Groups:', numGroups, 'Per group:', guaranteedPerGroup, 'Best 3rds needed:', needBestThirds);

  // Get all completed matches
  const { data: matches, error: matchesError } = await supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed');

  if (matchesError) {
    console.error('Error fetching matches:', matchesError);
    return [];
  }

  // Calculate stats for each team
  const teamStats = new Map<string, { id: string; group_name: string; wins: number; gamesWon: number; gamesLost: number }>();

  teams.forEach(team => {
    teamStats.set(team.id, { id: team.id, group_name: team.group_name!, wins: 0, gamesWon: 0, gamesLost: 0 });
  });

  matches?.forEach(match => {
    const team1Stats = teamStats.get(match.team1_id);
    const team2Stats = teamStats.get(match.team2_id);

    if (team1Stats && team2Stats) {
      const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
      const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);

      team1Stats.gamesWon += team1Games;
      team1Stats.gamesLost += team2Games;
      team2Stats.gamesWon += team2Games;
      team2Stats.gamesLost += team1Games;

      if (team1Games > team2Games) {
        team1Stats.wins++;
      } else if (team2Games > team1Games) {
        team2Stats.wins++;
      }
    }
  });

  // Group teams by their group_name
  const teamsByGroup = new Map<string, Array<{ id: string; group_name: string; wins: number; gamesWon: number; gamesLost: number }>>();

  Array.from(teamStats.values()).forEach(team => {
    if (!teamsByGroup.has(team.group_name)) {
      teamsByGroup.set(team.group_name, []);
    }
    teamsByGroup.get(team.group_name)!.push(team);
  });

  const qualified: string[] = [];
  const thirdPlaceTeams: Array<{ id: string; stats: any }> = [];

  // Sort groups alphabetically
  const sortedGroups = Array.from(teamsByGroup.keys()).sort();

  sortedGroups.forEach((groupName) => {
    const groupTeams = teamsByGroup.get(groupName)!;

    // Sort by wins then goal differential
    const sorted = groupTeams.sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      const diffA = a.gamesWon - a.gamesLost;
      const diffB = b.gamesWon - b.gamesLost;
      return diffB - diffA;
    });

    // Take guaranteed spots per group
    sorted.slice(0, guaranteedPerGroup).forEach(team => {
      qualified.push(team.id);
    });

    // Collect 3rd place teams if we need them
    if (needBestThirds > 0 && sorted.length >= 3 && guaranteedPerGroup === 2) {
      thirdPlaceTeams.push({ id: sorted[2].id, stats: sorted[2] });
    }
  });

  // Add best third-place teams if needed
  if (needBestThirds > 0) {
    thirdPlaceTeams.sort((a, b) => {
      if (a.stats.wins !== b.stats.wins) return b.stats.wins - a.stats.wins;
      const diffA = a.stats.gamesWon - a.stats.gamesLost;
      const diffB = b.stats.gamesWon - b.stats.gamesLost;
      return diffB - diffA;
    });

    const bestThirds = thirdPlaceTeams.slice(0, needBestThirds);
    qualified.push(...bestThirds.map(t => t.id));
    console.log('[KNOCKOUT] Added best 3rd place teams:', bestThirds.map(t => t.id));
  }

  console.log('[KNOCKOUT] Final qualified teams:', qualified);
  return qualified;
}

/**
 * Gets qualified teams from each group based on standings
 * @param tournamentId - Tournament ID
 * @param qualifiedPerGroup - Number of teams to qualify from each group
 * @param categoryId - Optional category ID to filter teams
 * @returns Array of qualified team IDs sorted by group and rank
 */
export async function getQualifiedTeamsFromGroups(
  tournamentId: string,
  qualifiedPerGroup: number,
  categoryId?: string
): Promise<string[]> {
  let teamsQuery = supabase
    .from('teams')
    .select('id, group_name, category_id, created_at')
    .eq('tournament_id', tournamentId)
    .not('group_name', 'is', null)
    .order('created_at', { ascending: true });

  if (categoryId) {
    teamsQuery = teamsQuery.eq('category_id', categoryId);
  }

  const { data: teams, error: teamsError } = await teamsQuery;

  if (teamsError || !teams) {
    console.error('Error fetching teams:', teamsError);
    return [];
  }

  let matchesQuery = supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('round', 'group_stage')
    .eq('status', 'completed');

  if (categoryId) {
    matchesQuery = matchesQuery.eq('category_id', categoryId);
  }

  const { data: matches, error: matchesError } = await matchesQuery;

  if (matchesError) {
    console.error('Error fetching matches:', matchesError);
    return [];
  }

  const teamOrder = new Map<string, number>();
  teams.forEach((team, index) => {
    teamOrder.set(team.id, index);
  });

  const teamStats = new Map<string, TeamStats>();

  teams.forEach(team => {
    teamStats.set(team.id, {
      id: team.id,
      group_name: team.group_name!,
      wins: 0,
      gamesWon: 0,
      gamesLost: 0,
      created_at: team.created_at
    });
  });

  matches?.forEach(match => {
    const team1Stats = teamStats.get(match.team1_id);
    const team2Stats = teamStats.get(match.team2_id);

    if (team1Stats && team2Stats) {
      const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
      const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);

      team1Stats.gamesWon += team1Games;
      team1Stats.gamesLost += team2Games;
      team2Stats.gamesWon += team2Games;
      team2Stats.gamesLost += team1Games;

      if (team1Games > team2Games) {
        team1Stats.wins++;
      } else if (team2Games > team1Games) {
        team2Stats.wins++;
      }
    }
  });

  const teamsByGroup = new Map<string, TeamStats[]>();

  Array.from(teamStats.values()).forEach(team => {
    if (!teamsByGroup.has(team.group_name)) {
      teamsByGroup.set(team.group_name, []);
    }
    teamsByGroup.get(team.group_name)!.push(team);
  });

  console.log('[KNOCKOUT] Found', teamsByGroup.size, 'groups');

  const qualified: Array<{ id: string; group: string; rank: number }> = [];
  const sortedGroups = Array.from(teamsByGroup.keys()).sort();

  const matchData: MatchData[] = (matches || []).map(m => ({
    team1_id: m.team1_id,
    team2_id: m.team2_id,
    winner_id: m.winner_id,
    team1_score_set1: m.team1_score_set1,
    team2_score_set1: m.team2_score_set1,
    team1_score_set2: m.team1_score_set2,
    team2_score_set2: m.team2_score_set2,
    team1_score_set3: m.team1_score_set3,
    team2_score_set3: m.team2_score_set3
  }));

  sortedGroups.forEach((groupName) => {
    const groupTeams = teamsByGroup.get(groupName)!;
    const groupMatches = matchData.filter(m =>
      groupTeams.some(t => t.id === m.team1_id) && groupTeams.some(t => t.id === m.team2_id)
    );

    const sorted = sortTeamsByTiebreaker(groupTeams, groupMatches, teamOrder);

    console.log(`[KNOCKOUT] Group ${groupName} standings (with tiebreaker):`, sorted.map(t => ({
      id: t.id,
      wins: t.wins,
      diff: t.gamesWon - t.gamesLost,
      gamesWon: t.gamesWon
    })));

    sorted.slice(0, qualifiedPerGroup).forEach((team, rank) => {
      qualified.push({ id: team.id, group: groupName, rank: rank + 1 });
      console.log(`[KNOCKOUT] Group ${groupName} - Rank ${rank + 1}: ${team.id}`);
    });
  });

  const orderedQualified: string[] = [];
  for (let rank = 1; rank <= qualifiedPerGroup; rank++) {
    const teamsAtRank = qualified.filter(q => q.rank === rank);
    orderedQualified.push(...teamsAtRank.map(q => q.id));
  }

  const totalQualified = orderedQualified.length;
  const nextPowerOf2 = Math.pow(2, Math.ceil(Math.log2(totalQualified)));

  console.log('[KNOCKOUT] Total qualified:', totalQualified, 'Next power of 2:', nextPowerOf2);

  if (totalQualified < nextPowerOf2 && qualifiedPerGroup === 2) {
    const thirdPlaceTeams: Array<{ id: string; stats: TeamStats }> = [];

    sortedGroups.forEach((groupName) => {
      const groupTeams = teamsByGroup.get(groupName)!;
      const groupMatches = matchData.filter(m =>
        groupTeams.some(t => t.id === m.team1_id) && groupTeams.some(t => t.id === m.team2_id)
      );
      const sorted = sortTeamsByTiebreaker(groupTeams, groupMatches, teamOrder);

      if (sorted.length >= 3) {
        thirdPlaceTeams.push({ id: sorted[2].id, stats: sorted[2] });
      }
    });

    const allThirds = thirdPlaceTeams.map(t => t.stats);
    const sortedThirds = sortTeamsByTiebreaker(allThirds, matchData, teamOrder);

    const teamsNeeded = nextPowerOf2 - totalQualified;
    const bestThirds = sortedThirds.slice(0, teamsNeeded);

    console.log('[KNOCKOUT] Adding', teamsNeeded, 'best third-place teams:', bestThirds.map(t => t.id));
    orderedQualified.push(...bestThirds.map(t => t.id));
  }

  console.log('[KNOCKOUT] Final qualified teams:', orderedQualified);
  return orderedQualified;
}

/**
 * Updates team placement after group stage
 */
export type IndividualPlayer = {
  id: string;
  name: string;
  group_name?: string;
};

export function assignPlayersToGroups(players: IndividualPlayer[], numberOfGroups: number): IndividualPlayer[] {
  console.log('[ASSIGN PLAYERS TO GROUPS] Input - Players:', players.length, 'Number of groups:', numberOfGroups);

  const shuffled = [...players].sort(() => Math.random() - 0.5);

  const groupNames = Array.from({ length: numberOfGroups }, (_, i) =>
    String.fromCharCode(65 + i)
  );

  console.log('[ASSIGN PLAYERS TO GROUPS] Group names created:', groupNames);

  const result = shuffled.map((player, index) => ({
    ...player,
    group_name: groupNames[index % numberOfGroups]
  }));

  console.log('[ASSIGN PLAYERS TO GROUPS] Result - Groups distribution:',
    groupNames.map(g => ({ group: g, count: result.filter(p => p.group_name === g).length }))
  );

  return result;
}

export async function savePlayerGroupAssignments(players: IndividualPlayer[]) {
  for (const player of players) {
    const { error } = await supabase
      .from('players')
      .update({ group_name: player.group_name })
      .eq('id', player.id);

    if (error) {
      console.error('Error updating player group:', error);
      throw error;
    }
  }
}

export async function getQualifiedPlayersFromGroups(
  tournamentId: string,
  qualifiedPerGroup: number,
  categoryId?: string,
  extraBestNeeded: number = 0
): Promise<string[]> {
  let playersQuery = supabase
    .from('players')
    .select('id, name, group_name, category_id')
    .eq('tournament_id', tournamentId)
    .not('group_name', 'is', null);

  if (categoryId) {
    playersQuery = playersQuery.eq('category_id', categoryId);
  }

  const { data: players, error: playersError } = await playersQuery;

  if (playersError || !players) {
    console.error('Error fetching players:', playersError);
    return [];
  }

  let matchesQuery = supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed')
    .not('player1_individual_id', 'is', null);

  if (categoryId) {
    matchesQuery = matchesQuery.eq('category_id', categoryId);
  }

  const { data: matches, error: matchesError } = await matchesQuery;

  if (matchesError) {
    console.error('Error fetching matches:', matchesError);
    return [];
  }

  const playerStats = new Map<string, { id: string; group_name: string; wins: number; gamesWon: number; gamesLost: number; matchesPlayed: number }>();

  players.forEach(player => {
    playerStats.set(player.id, {
      id: player.id,
      group_name: player.group_name!,
      wins: 0,
      gamesWon: 0,
      gamesLost: 0,
      matchesPlayed: 0
    });
  });

  matches?.forEach(match => {
    const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
    const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
    const team1Won = team1Games > team2Games;

    const player1Stats = playerStats.get(match.player1_individual_id);
    const player2Stats = playerStats.get(match.player2_individual_id);
    const player3Stats = playerStats.get(match.player3_individual_id);
    const player4Stats = playerStats.get(match.player4_individual_id);

    if (player1Stats) {
      player1Stats.matchesPlayed++;
      player1Stats.gamesWon += team1Games;
      player1Stats.gamesLost += team2Games;
      if (team1Won) player1Stats.wins++;
    }
    if (player2Stats) {
      player2Stats.matchesPlayed++;
      player2Stats.gamesWon += team1Games;
      player2Stats.gamesLost += team2Games;
      if (team1Won) player2Stats.wins++;
    }
    if (player3Stats) {
      player3Stats.matchesPlayed++;
      player3Stats.gamesWon += team2Games;
      player3Stats.gamesLost += team1Games;
      if (!team1Won) player3Stats.wins++;
    }
    if (player4Stats) {
      player4Stats.matchesPlayed++;
      player4Stats.gamesWon += team2Games;
      player4Stats.gamesLost += team1Games;
      if (!team1Won) player4Stats.wins++;
    }
  });

  const playersByGroup = new Map<string, Array<{ id: string; group_name: string; wins: number; gamesWon: number; gamesLost: number; matchesPlayed: number }>>();

  Array.from(playerStats.values()).forEach(player => {
    if (!playersByGroup.has(player.group_name)) {
      playersByGroup.set(player.group_name, []);
    }
    playersByGroup.get(player.group_name)!.push(player);
  });

  console.log('[INDIVIDUAL KNOCKOUT] Found', playersByGroup.size, 'groups');

  const qualified: Array<{ id: string; group: string; rank: number }> = [];
  const sortedGroups = Array.from(playersByGroup.keys()).sort();

  sortedGroups.forEach((groupName) => {
    const groupPlayers = playersByGroup.get(groupName)!;

    const sorted = groupPlayers.sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      const diffA = a.gamesWon - a.gamesLost;
      const diffB = b.gamesWon - b.gamesLost;
      if (diffA !== diffB) return diffB - diffA;
      return b.gamesWon - a.gamesWon;
    });

    console.log(`[INDIVIDUAL KNOCKOUT] Group ${groupName} standings:`, sorted.map(p => ({ id: p.id, wins: p.wins, diff: p.gamesWon - p.gamesLost })));

    sorted.slice(0, qualifiedPerGroup).forEach((player, rank) => {
      qualified.push({ id: player.id, group: groupName, rank: rank + 1 });
      console.log(`[INDIVIDUAL KNOCKOUT] Group ${groupName} - Rank ${rank + 1}: ${player.id}`);
    });
  });

  const orderedQualified: string[] = [];
  for (let rank = 1; rank <= qualifiedPerGroup; rank++) {
    const playersAtRank = qualified.filter(q => q.rank === rank);
    orderedQualified.push(...playersAtRank.map(q => q.id));
  }

  const numGroups = sortedGroups.length;
  const totalQualified = orderedQualified.length;

  console.log('[INDIVIDUAL KNOCKOUT] Total qualified:', totalQualified, 'Extra best needed:', extraBestNeeded);

  if (extraBestNeeded > 0) {
    const extraPosition = qualifiedPerGroup + 1;
    const extraPlacePlayers: Array<{ id: string; stats: any }> = [];

    sortedGroups.forEach((groupName) => {
      const groupPlayers = playersByGroup.get(groupName)!;
      const sorted = groupPlayers.sort((a, b) => {
        if (a.wins !== b.wins) return b.wins - a.wins;
        const diffA = a.gamesWon - a.gamesLost;
        const diffB = b.gamesWon - b.gamesLost;
        return diffB - diffA;
      });

      if (sorted.length >= extraPosition) {
        extraPlacePlayers.push({ id: sorted[extraPosition - 1].id, stats: sorted[extraPosition - 1] });
      }
    });

    extraPlacePlayers.sort((a, b) => {
      if (a.stats.wins !== b.stats.wins) return b.stats.wins - a.stats.wins;
      const diffA = a.stats.gamesWon - a.stats.gamesLost;
      const diffB = b.stats.gamesWon - b.stats.gamesLost;
      return diffB - diffA;
    });

    const bestExtra = extraPlacePlayers.slice(0, extraBestNeeded);

    console.log(`[INDIVIDUAL KNOCKOUT] Adding ${extraBestNeeded} best ${extraPosition}th-place players:`, bestExtra.map(p => p.id));
    orderedQualified.push(...bestExtra.map(p => p.id));
  }

  console.log('[INDIVIDUAL KNOCKOUT] Final qualified players:', orderedQualified);
  return orderedQualified;
}

export async function updateTeamPlacements(tournamentId: string, qualifiedPerGroup: number) {
  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('id, group_name')
    .eq('tournament_id', tournamentId)
    .not('group_name', 'is', null);

  if (teamsError || !teams) {
    console.error('Error fetching teams:', teamsError);
    return;
  }

  // Get all completed matches
  const { data: matches, error: matchesError } = await supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed');

  if (matchesError) {
    console.error('Error fetching matches:', matchesError);
    return;
  }

  // Calculate stats for each team
  const teamStats = new Map<string, { id: string; group_name: string; wins: number; gamesWon: number; gamesLost: number }>();

  teams.forEach(team => {
    teamStats.set(team.id, { id: team.id, group_name: team.group_name!, wins: 0, gamesWon: 0, gamesLost: 0 });
  });

  matches?.forEach(match => {
    const team1Stats = teamStats.get(match.team1_id);
    const team2Stats = teamStats.get(match.team2_id);

    if (team1Stats && team2Stats) {
      const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
      const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);

      team1Stats.gamesWon += team1Games;
      team1Stats.gamesLost += team2Games;
      team2Stats.gamesWon += team2Games;
      team2Stats.gamesLost += team1Games;

      if (team1Games > team2Games) {
        team1Stats.wins++;
      } else if (team2Games > team1Games) {
        team2Stats.wins++;
      }
    }
  });

  // Group teams by their group_name
  const teamsByGroup = new Map<string, Array<{ id: string; group_name: string; wins: number; gamesWon: number; gamesLost: number }>>();

  Array.from(teamStats.values()).forEach(team => {
    if (!teamsByGroup.has(team.group_name)) {
      teamsByGroup.set(team.group_name, []);
    }
    teamsByGroup.get(team.group_name)!.push(team);
  });

  // Update placement for each team
  for (const [groupName, groupTeams] of teamsByGroup.entries()) {
    // Sort by wins, then game differential
    const sorted = groupTeams.sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      const diffA = a.gamesWon - a.gamesLost;
      const diffB = b.gamesWon - b.gamesLost;
      return diffB - diffA;
    });

    // Update placement and status
    for (let i = 0; i < sorted.length; i++) {
      const placement = i + 1;
      const status = placement <= qualifiedPerGroup ? 'qualified' : 'eliminated';

      await supabase
        .from('teams')
        .update({ placement, status })
        .eq('id', sorted[i].id);
    }
  }
}

async function populateDirectFinals(
  tournamentId: string,
  allMatches: any[],
  categoryId?: string
): Promise<void> {
  const directFinalRounds = allMatches
    .filter(m => m.round === 'final' || m.round.endsWith('_place'))
    .sort((a, b) => a.match_number - b.match_number);

  if (directFinalRounds.length === 0) {
    console.log('[POPULATE_DIRECT_FINALS] No direct final/placement matches found');
    return;
  }

  const alreadyPopulated = directFinalRounds.every(m =>
    m.player1_individual_id && m.player1_individual_id !== 'TBD' &&
    m.player3_individual_id && m.player3_individual_id !== 'TBD'
  );
  if (alreadyPopulated) {
    console.log('[POPULATE_DIRECT_FINALS] Already populated, skipping');
    return;
  }

  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('id, name, group_name, category_id')
    .eq('tournament_id', tournamentId)
    .not('group_name', 'is', null);

  if (playersError || !players) {
    console.error('[POPULATE_DIRECT_FINALS] Error fetching players:', playersError);
    return;
  }

  const groupMatches = allMatches.filter(m => m.round.startsWith('group_') && m.status === 'completed');

  const playerStats = new Map<string, { id: string; name: string; group_name: string; wins: number; gamesWon: number; gamesLost: number }>();

  players.forEach(player => {
    playerStats.set(player.id, {
      id: player.id,
      name: player.name,
      group_name: player.group_name!,
      wins: 0,
      gamesWon: 0,
      gamesLost: 0
    });
  });

  groupMatches.forEach(match => {
    const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
    const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
    const team1Won = team1Games > team2Games;

    const p1Stats = playerStats.get(match.player1_individual_id);
    const p2Stats = playerStats.get(match.player2_individual_id);
    const p3Stats = playerStats.get(match.player3_individual_id);
    const p4Stats = playerStats.get(match.player4_individual_id);

    if (p1Stats) { p1Stats.gamesWon += team1Games; p1Stats.gamesLost += team2Games; if (team1Won) p1Stats.wins++; }
    if (p2Stats) { p2Stats.gamesWon += team1Games; p2Stats.gamesLost += team2Games; if (team1Won) p2Stats.wins++; }
    if (p3Stats) { p3Stats.gamesWon += team2Games; p3Stats.gamesLost += team1Games; if (!team1Won) p3Stats.wins++; }
    if (p4Stats) { p4Stats.gamesWon += team2Games; p4Stats.gamesLost += team1Games; if (!team1Won) p4Stats.wins++; }
  });

  const playersByGroup = new Map<string, Array<{ id: string; name: string; group_name: string; wins: number; gamesWon: number; gamesLost: number }>>();

  Array.from(playerStats.values()).forEach(player => {
    if (!playersByGroup.has(player.group_name)) {
      playersByGroup.set(player.group_name, []);
    }
    playersByGroup.get(player.group_name)!.push(player);
  });

  const sortedGroups = Array.from(playersByGroup.keys()).sort();

  const rankedByGroup = new Map<string, string[]>();
  sortedGroups.forEach((groupName) => {
    const groupPlayers = playersByGroup.get(groupName)!;
    const sorted = [...groupPlayers].sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      const diffA = a.gamesWon - a.gamesLost;
      const diffB = b.gamesWon - b.gamesLost;
      return diffB - diffA;
    });
    rankedByGroup.set(groupName, sorted.map(p => p.id));
    console.log(`[POPULATE_DIRECT_FINALS] Group ${groupName} ranking:`, sorted.map((p, i) => `${i + 1}. ${p.name}`));
  });

  const maxPlayersPerGroup = Math.max(...Array.from(rankedByGroup.values()).map(g => g.length));

  for (let matchIdx = 0; matchIdx < directFinalRounds.length; matchIdx++) {
    const match = directFinalRounds[matchIdx];
    const startRank = matchIdx * 2;

    if (startRank >= maxPlayersPerGroup) break;

    if (match.player1_individual_id && match.player1_individual_id !== 'TBD') {
      console.log(`[POPULATE_DIRECT_FINALS] Match ${match.round} already populated, skipping`);
      continue;
    }

    if (sortedGroups.length === 2) {
      const groupA = sortedGroups[0];
      const groupB = sortedGroups[1];
      const rankingA = rankedByGroup.get(groupA)!;
      const rankingB = rankedByGroup.get(groupB)!;

      const a1 = rankingA[startRank];
      const a2 = rankingA[startRank + 1];
      const b1 = rankingB[startRank];
      const b2 = rankingB[startRank + 1];

      if (!a1 || !b1) continue;

      const updateData: any = {
        player1_individual_id: a1,
        player2_individual_id: b2 || a1,
        player3_individual_id: b1,
        player4_individual_id: a2 || b1,
      };

      const { error } = await supabase
        .from('matches')
        .update(updateData)
        .eq('id', match.id);

      if (error) {
        console.error(`[POPULATE_DIRECT_FINALS] Error updating ${match.round}:`, error);
      } else {
        console.log(`[POPULATE_DIRECT_FINALS] ${match.round}: ${groupA}${startRank + 1}+${groupB}${startRank + 2} vs ${groupB}${startRank + 1}+${groupA}${startRank + 2}`);
      }
    } else {
      const neededPlayers: string[] = [];
      for (const groupName of sortedGroups) {
        const groupRanking = rankedByGroup.get(groupName)!;
        for (let r = startRank; r < startRank + 2 && r < groupRanking.length; r++) {
          neededPlayers.push(groupRanking[r]);
        }
      }

      if (neededPlayers.length < 4) continue;

      const shuffled = [...neededPlayers].sort(() => Math.random() - 0.5);

      const { error } = await supabase
        .from('matches')
        .update({
          player1_individual_id: shuffled[0],
          player2_individual_id: shuffled[1],
          player3_individual_id: shuffled[2],
          player4_individual_id: shuffled[3],
        })
        .eq('id', match.id);

      if (error) {
        console.error(`[POPULATE_DIRECT_FINALS] Error updating ${match.round}:`, error);
      } else {
        console.log(`[POPULATE_DIRECT_FINALS] ${match.round}: populated with shuffled players`);
      }
    }
  }

  console.log('[POPULATE_DIRECT_FINALS] Done populating direct finals');
}

export async function populatePlacementMatches(
  tournamentId: string,
  categoryId?: string
): Promise<void> {
  console.log('[POPULATE_PLACEMENT] Starting for tournament:', tournamentId, 'category:', categoryId);

  const { data: allMatches, error: matchesError } = await supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId);

  if (matchesError || !allMatches) {
    console.error('[POPULATE_PLACEMENT] Error fetching matches:', matchesError);
    return;
  }

  // ====================================================================
  // QUARTERFINALS: Check if there are quarterfinal matches to populate
  // ====================================================================
  const allQuarterfinalRounds = ['quarterfinal', 'quarter_final'];
  const allQuarterfinals = allMatches
    .filter(m => allQuarterfinalRounds.includes(m.round))
    .sort((a, b) => a.match_number - b.match_number);
  
  const hasUnpopulatedQF = allQuarterfinals.some(m =>
    !m.player1_individual_id && !m.player3_individual_id
  );

  console.log(`[POPULATE_PLACEMENT] Found ${allQuarterfinals.length} quarterfinal matches, unpopulated: ${hasUnpopulatedQF}`);

  const tierPrefixes = ['1st', '5th', '9th', '13th', '17th', '21st'];
  const allSemifinalRounds = [
    'semifinal', 'semi_final',
    ...tierPrefixes.map(p => `${p}_semifinal`)
  ];

  const allSemis = allMatches
    .filter(m => allSemifinalRounds.includes(m.round))
    .sort((a, b) => a.match_number - b.match_number);

  console.log('[POPULATE_PLACEMENT] Found', allSemis.length, 'total semifinal matches across all tiers');

  if (allSemis.length === 0 && allQuarterfinals.length === 0) {
    console.log('[POPULATE_PLACEMENT] No semifinal or quarterfinal matches found, checking for direct finals/placement matches');
    await populateDirectFinals(tournamentId, allMatches, categoryId);
    return;
  }

  let { data: players, error: playersError } = await supabase
    .from('players')
    .select('id, name, group_name, category_id')
    .eq('tournament_id', tournamentId)
    .not('group_name', 'is', null);

  if (playersError) {
    console.error('[POPULATE_PLACEMENT] Error fetching players:', playersError);
    return;
  }

  // If no players with group_name found, fetch ALL players and assign them to a default group "A"
  // This handles mixed_american and other single-group formats where group assignment was skipped
  if (!players || players.length === 0) {
    console.log('[POPULATE_PLACEMENT] No players with group_name, fetching ALL players and treating as single group');
    const { data: allPlayers, error: allPlayersError } = await supabase
      .from('players')
      .select('id, name, group_name, category_id')
      .eq('tournament_id', tournamentId);

    if (allPlayersError || !allPlayers || allPlayers.length === 0) {
      console.error('[POPULATE_PLACEMENT] No players found at all:', allPlayersError);
      return;
    }

    // Auto-assign group "A" to all players in the DB so future calls work
    const playerIds = allPlayers.map(p => p.id);
    await supabase
      .from('players')
      .update({ group_name: 'A' })
      .in('id', playerIds);

    players = allPlayers.map(p => ({ ...p, group_name: 'A' }));
    console.log(`[POPULATE_PLACEMENT] Auto-assigned group "A" to ${players.length} players`);
  }

  const groupMatches = allMatches.filter(m => m.round.startsWith('group_') && m.status === 'completed');

  const playerStats = new Map<string, { id: string; name: string; group_name: string; wins: number; gamesWon: number; gamesLost: number }>();

  players.forEach(player => {
    playerStats.set(player.id, {
      id: player.id,
      name: player.name,
      group_name: player.group_name!,
      wins: 0,
      gamesWon: 0,
      gamesLost: 0
    });
  });

  groupMatches.forEach(match => {
    const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
    const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
    const team1Won = team1Games > team2Games;

    const p1Stats = playerStats.get(match.player1_individual_id);
    const p2Stats = playerStats.get(match.player2_individual_id);
    const p3Stats = playerStats.get(match.player3_individual_id);
    const p4Stats = playerStats.get(match.player4_individual_id);

    if (p1Stats) {
      p1Stats.gamesWon += team1Games;
      p1Stats.gamesLost += team2Games;
      if (team1Won) p1Stats.wins++;
    }
    if (p2Stats) {
      p2Stats.gamesWon += team1Games;
      p2Stats.gamesLost += team2Games;
      if (team1Won) p2Stats.wins++;
    }
    if (p3Stats) {
      p3Stats.gamesWon += team2Games;
      p3Stats.gamesLost += team1Games;
      if (!team1Won) p3Stats.wins++;
    }
    if (p4Stats) {
      p4Stats.gamesWon += team2Games;
      p4Stats.gamesLost += team1Games;
      if (!team1Won) p4Stats.wins++;
    }
  });

  const playersByGroup = new Map<string, Array<{ id: string; name: string; group_name: string; wins: number; gamesWon: number; gamesLost: number }>>();

  Array.from(playerStats.values()).forEach(player => {
    if (!playersByGroup.has(player.group_name)) {
      playersByGroup.set(player.group_name, []);
    }
    playersByGroup.get(player.group_name)!.push(player);
  });

  const sortedGroups = Array.from(playersByGroup.keys()).sort();
  const isSingleGroup = sortedGroups.length === 1;

  const rankedByGroup = new Map<string, string[]>();
  sortedGroups.forEach((groupName) => {
    const groupPlayers = playersByGroup.get(groupName)!;
    const sorted = groupPlayers.sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      const diffA = a.gamesWon - a.gamesLost;
      const diffB = b.gamesWon - b.gamesLost;
      if (diffB !== diffA) return diffB - diffA;
      return b.gamesWon - a.gamesWon;
    });
    rankedByGroup.set(groupName, sorted.map(p => p.id));
    console.log(`[POPULATE_PLACEMENT] Group ${groupName} ranking:`, sorted.map((p, i) => `${i + 1}. ${p.name}`));
  });

  const maxPlayersPerGroup = Math.max(...Array.from(rankedByGroup.values()).map(g => g.length));
  const totalPlayers = players.length;

  console.log(`[POPULATE_PLACEMENT] ${sortedGroups.length} groups, max ${maxPlayersPerGroup} per group, ${totalPlayers} total`);

  // ====================================================================
  // QUARTERFINALS POPULATION: If quarterfinals exist and are unpopulated
  // ====================================================================
  if (allQuarterfinals.length > 0 && hasUnpopulatedQF) {
    console.log('[POPULATE_PLACEMENT] Populating quarterfinal matches...');
    
    const unpopulatedQFs = allQuarterfinals
      .filter(m => !m.player1_individual_id && !m.player3_individual_id)
      .sort((a, b) => a.match_number - b.match_number);

    if (isSingleGroup) {
      // Single group: populate QFs with ranked players
      const ranking = rankedByGroup.get(sortedGroups[0])!;
      const numQFsNeeded = Math.min(unpopulatedQFs.length, Math.floor(ranking.length / 4));
      
      for (let i = 0; i < numQFsNeeded; i++) {
        const base = i * 4;
        if (base + 3 >= ranking.length) break;
        // QF seeding: 1+8 vs 4+5, 2+7 vs 3+6, etc.
        const topIdx = base;
        const bottomIdx = ranking.length - 1 - base;
        const midHigh = base + 1;
        const midLow = ranking.length - 2 - base;
        
        await supabase.from('matches').update({
          player1_individual_id: ranking[topIdx],
          player2_individual_id: ranking[bottomIdx] || ranking[topIdx],
          player3_individual_id: ranking[midHigh],
          player4_individual_id: ranking[midLow] || ranking[midHigh],
        }).eq('id', unpopulatedQFs[i].id);
        console.log(`[POPULATE_PLACEMENT] QF${i + 1}: ${topIdx + 1}°+${(bottomIdx || topIdx) + 1}° vs ${midHigh + 1}°+${(midLow || midHigh) + 1}°`);
      }
    } else if (sortedGroups.length === 2) {
      // 2 groups: cross-group quarterfinal matchups
      const groupA = sortedGroups[0];
      const groupB = sortedGroups[1];
      const rankingA = rankedByGroup.get(groupA)!;
      const rankingB = rankedByGroup.get(groupB)!;
      
      // Calculate how many QFs we can fill (need 4 players per QF, 2 from each group)
      const maxQFs = Math.min(unpopulatedQFs.length, Math.floor(Math.min(rankingA.length, rankingB.length) / 2));
      
      for (let i = 0; i < maxQFs; i++) {
        const startRank = i * 2;
        const a1 = rankingA[startRank];
        const a2 = rankingA[startRank + 1];
        const b1 = rankingB[startRank];
        const b2 = rankingB[startRank + 1];
        
        if (!a1 || !a2 || !b1 || !b2) break;
        
        // Cross-group: A-top + B-bottom vs B-top + A-bottom
        await supabase.from('matches').update({
          player1_individual_id: a1,
          player2_individual_id: b2,
          player3_individual_id: b1,
          player4_individual_id: a2,
        }).eq('id', unpopulatedQFs[i].id);
        console.log(`[POPULATE_PLACEMENT] QF${i + 1}: ${groupA}${startRank + 1}+${groupB}${startRank + 2} vs ${groupB}${startRank + 1}+${groupA}${startRank + 2}`);
      }
    } else {
      // 3+ groups: proper cross-group seeding for QFs
      // Build global seeding by interleaving positions across groups
      // e.g. 3 groups: A1, B1, C1, A2, B2, C2, A3, B3, C3, A4, B4, C4
      // Within same position tier, sort by stats (wins, game diff, games won)
      const globalSeeding: string[] = [];
      const maxPos = Math.max(...Array.from(rankedByGroup.values()).map(g => g.length));

      for (let pos = 0; pos < maxPos; pos++) {
        const playersAtPos: Array<{ id: string; wins: number; gamesWon: number; gamesLost: number }> = [];
        for (const groupName of sortedGroups) {
          const ranking = rankedByGroup.get(groupName)!;
          if (pos < ranking.length) {
            const playerId = ranking[pos];
            const stats = playerStats.get(playerId);
            playersAtPos.push({
              id: playerId,
              wins: stats?.wins || 0,
              gamesWon: stats?.gamesWon || 0,
              gamesLost: stats?.gamesLost || 0,
            });
          }
        }
        // Sort within same position by wins, then game diff, then games won
        playersAtPos.sort((a, b) => {
          if (a.wins !== b.wins) return b.wins - a.wins;
          const diffA = a.gamesWon - a.gamesLost;
          const diffB = b.gamesWon - b.gamesLost;
          if (diffA !== diffB) return diffB - diffA;
          return b.gamesWon - a.gamesWon;
        });
        playersAtPos.forEach(p => globalSeeding.push(p.id));
      }

      console.log(`[POPULATE_PLACEMENT] Global seeding (${globalSeeding.length} players):`, globalSeeding.map((id, i) => `${i + 1}°`));

      // Assign to QFs using bracket seeding: top+bottom vs mid seeds
      // For 12 players (seeds 0-11), 3 QFs:
      //   QF1: Seed0 + Seed11 vs Seed5 + Seed6
      //   QF2: Seed1 + Seed10 vs Seed4 + Seed7
      //   QF3: Seed2 + Seed9  vs Seed3 + Seed8
      const n = globalSeeding.length;
      const half = Math.floor(n / 2);

      for (let i = 0; i < unpopulatedQFs.length && i < Math.floor(n / 4); i++) {
        const p1 = globalSeeding[i];             // top seed
        const p2 = globalSeeding[n - 1 - i];     // bottom seed (partner)
        const p3 = globalSeeding[half - 1 - i];  // mid-high seed
        const p4 = globalSeeding[half + i];       // mid-low seed (partner)

        if (!p1 || !p2 || !p3 || !p4) break;

        await supabase.from('matches').update({
          player1_individual_id: p1,
          player2_individual_id: p2,
          player3_individual_id: p3,
          player4_individual_id: p4,
        }).eq('id', unpopulatedQFs[i].id);
        console.log(`[POPULATE_PLACEMENT] QF${i + 1}: Seed${i + 1}+Seed${n - i} vs Seed${half - i}+Seed${half + 1 + i}`);
      }
    }
    
    // Delete extra unpopulated QF matches that can't be filled
    const stillUnpopulated = allQuarterfinals.filter(m => 
      !m.player1_individual_id && !m.player3_individual_id
    );
    // Re-fetch to check which are still empty after our updates
    const { data: updatedQFs } = await supabase
      .from('matches')
      .select('id, player1_individual_id, player3_individual_id')
      .eq('tournament_id', tournamentId)
      .in('round', allQuarterfinalRounds);
    
    if (updatedQFs) {
      const emptyQFs = updatedQFs.filter(m => !m.player1_individual_id && !m.player3_individual_id);
      if (emptyQFs.length > 0) {
        console.log(`[POPULATE_PLACEMENT] Removing ${emptyQFs.length} extra empty quarterfinal matches`);
        for (const emptyQF of emptyQFs) {
          await supabase.from('matches').delete().eq('id', emptyQF.id);
        }
      }
    }
    
    console.log('[POPULATE_PLACEMENT] Quarterfinal population done');
    return;
  }

  // SINGLE GROUP (e.g. mixed_american): populate semifinals with top 4 directly
  if (isSingleGroup) {
    const singleGroupRanking = rankedByGroup.get(sortedGroups[0])!;
    console.log(`[POPULATE_PLACEMENT] Single group mode: ${singleGroupRanking.length} players ranked`);

    // Find the semifinal matches (look for both 'semifinal' and '1st_semifinal')
    const semifinalMatches = allSemis.filter(m =>
      m.round === 'semifinal' || m.round === 'semi_final' || m.round === '1st_semifinal'
    ).sort((a, b) => a.match_number - b.match_number);

    if (semifinalMatches.length >= 2 && singleGroupRanking.length >= 4) {
      const alreadyPopulated = semifinalMatches.every(m =>
        m.player1_individual_id && m.player2_individual_id &&
        m.player3_individual_id && m.player4_individual_id
      );

      if (!alreadyPopulated) {
        const [p1, p2, p3, p4] = singleGroupRanking; // Top 4 players
        // SF1: 1st + 4th vs 2nd + 3rd
        await supabase
          .from('matches')
          .update({
            player1_individual_id: p1,
            player2_individual_id: p4,
            player3_individual_id: p2,
            player4_individual_id: p3,
          })
          .eq('id', semifinalMatches[0].id);
        console.log(`[POPULATE_PLACEMENT] SF1: 1st+4th vs 2nd+3rd`);

        if (singleGroupRanking.length >= 8) {
          // With 8+ players, SF2 gets players 5-8
          const [, , , , p5, p6, p7, p8] = singleGroupRanking;
          await supabase
            .from('matches')
            .update({
              player1_individual_id: p5,
              player2_individual_id: p8 || p5,
              player3_individual_id: p6,
              player4_individual_id: p7 || p6,
            })
            .eq('id', semifinalMatches[1].id);
          console.log(`[POPULATE_PLACEMENT] SF2: 5th+8th vs 6th+7th`);
        } else {
          // With 4-7 players, SF2 uses different pairings of same top 4
          await supabase
            .from('matches')
            .update({
              player1_individual_id: p1,
              player2_individual_id: p3,
              player3_individual_id: p2,
              player4_individual_id: p4,
            })
            .eq('id', semifinalMatches[1].id);
          console.log(`[POPULATE_PLACEMENT] SF2: 1st+3rd vs 2nd+4th`);
        }
      }
    }

    console.log('[POPULATE_PLACEMENT] Single group population done');
    return;
  }

  const populateTier = async (tierIndex: number, tierPrefix: string) => {
    const semifinalRound = `${tierPrefix}_semifinal`;
    const tierSemis = allSemis.filter(m => m.round === semifinalRound);

    if (tierSemis.length < 2) {
      if (tierPrefix === '1st') {
        const fallbackSemis = allSemis.filter(m => m.round === 'semifinal' || m.round === 'semi_final');
        if (fallbackSemis.length >= 2) {
          tierSemis.push(...fallbackSemis);
        }
      }
    }

    if (tierSemis.length < 2) {
      console.log(`[POPULATE_PLACEMENT] Tier ${tierPrefix}: not enough semifinals (${tierSemis.length})`);
      return;
    }

    const startRank = tierIndex * 2;
    const neededPlayers: string[] = [];

    for (const groupName of sortedGroups) {
      const groupRanking = rankedByGroup.get(groupName)!;
      for (let r = startRank; r < startRank + 2 && r < groupRanking.length; r++) {
        neededPlayers.push(groupRanking[r]);
      }
    }

    if (neededPlayers.length < 4) {
      console.log(`[POPULATE_PLACEMENT] Tier ${tierPrefix}: not enough players (${neededPlayers.length}/4)`);
      return;
    }

    const alreadyPopulated = tierSemis.every(m =>
      m.player1_individual_id && m.player2_individual_id &&
      m.player3_individual_id && m.player4_individual_id
    );
    if (alreadyPopulated) {
      console.log(`[POPULATE_PLACEMENT] Tier ${tierPrefix}: already populated, skipping`);
      return;
    }

    if (sortedGroups.length === 2) {
      const groupA = sortedGroups[0];
      const groupB = sortedGroups[1];
      const rankingA = rankedByGroup.get(groupA)!;
      const rankingB = rankedByGroup.get(groupB)!;

      const a1 = rankingA[startRank];
      const a2 = rankingA[startRank + 1];
      const b1 = rankingB[startRank];
      const b2 = rankingB[startRank + 1];

      if (!a1 || !a2 || !b1 || !b2) return;

      const { error: sf1Error } = await supabase
        .from('matches')
        .update({
          player1_individual_id: a1,
          player2_individual_id: b2,
          player3_individual_id: b1,
          player4_individual_id: a2,
        })
        .eq('id', tierSemis[0].id);

      if (sf1Error) {
        console.error(`[POPULATE_PLACEMENT] Error updating ${tierPrefix} SF1:`, sf1Error);
      } else {
        console.log(`[POPULATE_PLACEMENT] ${tierPrefix} SF1: ${groupA}${startRank + 1}+${groupB}${startRank + 2} vs ${groupB}${startRank + 1}+${groupA}${startRank + 2}`);
      }

      const { error: sf2Error } = await supabase
        .from('matches')
        .update({
          player1_individual_id: a2,
          player2_individual_id: b1,
          player3_individual_id: b2,
          player4_individual_id: a1,
        })
        .eq('id', tierSemis[1].id);

      if (sf2Error) {
        console.error(`[POPULATE_PLACEMENT] Error updating ${tierPrefix} SF2:`, sf2Error);
      } else {
        console.log(`[POPULATE_PLACEMENT] ${tierPrefix} SF2: ${groupA}${startRank + 2}+${groupB}${startRank + 1} vs ${groupB}${startRank + 2}+${groupA}${startRank + 1}`);
      }
    } else {
      const shuffled = [...neededPlayers].sort(() => Math.random() - 0.5);

      for (let i = 0; i < tierSemis.length && (i * 4 + 3) < shuffled.length; i++) {
        const base = i * 4;
        await supabase
          .from('matches')
          .update({
            player1_individual_id: shuffled[base],
            player2_individual_id: shuffled[base + 1],
            player3_individual_id: shuffled[base + 2],
            player4_individual_id: shuffled[base + 3],
          })
          .eq('id', tierSemis[i].id);
      }
    }

    console.log(`[POPULATE_PLACEMENT] Tier ${tierPrefix}: populated successfully`);
  };

  for (let i = 0; i < tierPrefixes.length; i++) {
    const startRank = i * 2;
    if (startRank >= maxPlayersPerGroup) break;
    await populateTier(i, tierPrefixes[i]);
  }

  console.log('[POPULATE_PLACEMENT] Done populating all placement tiers');
}

export async function advanceKnockoutWinner(
  tournamentId: string,
  completedMatchId: string,
  categoryId?: string
): Promise<void> {
  console.log('[ADVANCE_WINNER] Processing completed match:', completedMatchId);

  const { data: completedMatch, error: matchError } = await supabase
    .from('matches')
    .select('*')
    .eq('id', completedMatchId)
    .single();

  if (matchError || !completedMatch) {
    console.error('[ADVANCE_WINNER] Error fetching completed match:', matchError);
    return;
  }

  const round = completedMatch.round;
  const isIndividual = completedMatch.player1_individual_id !== null;

  console.log('[ADVANCE_WINNER] Match round:', round, 'isIndividual:', isIndividual);

  if (round.startsWith('group_')) {
    console.log('[ADVANCE_WINNER] Group match, no advancement needed');
    return;
  }

  const team1Games = (completedMatch.team1_score_set1 || 0) + (completedMatch.team1_score_set2 || 0) + (completedMatch.team1_score_set3 || 0);
  const team2Games = (completedMatch.team2_score_set1 || 0) + (completedMatch.team2_score_set2 || 0) + (completedMatch.team2_score_set3 || 0);

  if (team1Games === team2Games) {
    console.log('[ADVANCE_WINNER] Match is a draw, cannot determine winner');
    return;
  }

  const team1Won = team1Games > team2Games;

  let winnerIds: { p1: string | null; p2: string | null; team: string | null };
  let loserIds: { p1: string | null; p2: string | null; team: string | null };

  if (isIndividual) {
    if (team1Won) {
      winnerIds = { p1: completedMatch.player1_individual_id, p2: completedMatch.player2_individual_id, team: null };
      loserIds = { p1: completedMatch.player3_individual_id, p2: completedMatch.player4_individual_id, team: null };
    } else {
      winnerIds = { p1: completedMatch.player3_individual_id, p2: completedMatch.player4_individual_id, team: null };
      loserIds = { p1: completedMatch.player1_individual_id, p2: completedMatch.player2_individual_id, team: null };
    }
  } else {
    if (team1Won) {
      winnerIds = { p1: null, p2: null, team: completedMatch.team1_id };
      loserIds = { p1: null, p2: null, team: completedMatch.team2_id };
    } else {
      winnerIds = { p1: null, p2: null, team: completedMatch.team2_id };
      loserIds = { p1: null, p2: null, team: completedMatch.team1_id };
    }
  }

  console.log('[ADVANCE_WINNER] Winner:', winnerIds, 'Loser:', loserIds);

  let matchesQuery = supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId);

  if (categoryId) {
    matchesQuery = matchesQuery.eq('category_id', categoryId);
  }

  const { data: allMatches, error: allMatchesError } = await matchesQuery;

  if (allMatchesError || !allMatches) {
    console.error('[ADVANCE_WINNER] Error fetching all matches:', allMatchesError);
    return;
  }

  const semifinalRounds = ['semifinal', 'semi_final'];
  const quarterfinalRounds = ['quarterfinal', 'quarter_final'];

  if (semifinalRounds.includes(round)) {
    const semifinalMatches = allMatches
      .filter(m => semifinalRounds.includes(m.round))
      .sort((a, b) => a.match_number - b.match_number);

    const completedSemifinals = semifinalMatches.filter(m => m.status === 'completed');

    const matchIndex = semifinalMatches.findIndex(m => m.id === completedMatchId);
    console.log('[ADVANCE_WINNER] Semifinal match index:', matchIndex, 'Completed semis:', completedSemifinals.length);

    const finalMatch = allMatches.find(m => m.round === 'final');
    const thirdPlaceMatch = allMatches.find(m => m.round === '3rd_place');

    if (finalMatch) {
      if (isIndividual) {
        const updateData: any = {};
        if (matchIndex === 0) {
          updateData.player1_individual_id = winnerIds.p1;
          updateData.player2_individual_id = winnerIds.p2;
        } else {
          updateData.player3_individual_id = winnerIds.p1;
          updateData.player4_individual_id = winnerIds.p2;
        }

        const { error } = await supabase
          .from('matches')
          .update(updateData)
          .eq('id', finalMatch.id);

        if (error) {
          console.error('[ADVANCE_WINNER] Error updating final:', error);
        } else {
          console.log('[ADVANCE_WINNER] Updated final with winner from SF', matchIndex + 1);
        }
      } else {
        const updateData: any = {};
        if (matchIndex === 0) {
          updateData.team1_id = winnerIds.team;
        } else {
          updateData.team2_id = winnerIds.team;
        }

        const { error } = await supabase
          .from('matches')
          .update(updateData)
          .eq('id', finalMatch.id);

        if (error) {
          console.error('[ADVANCE_WINNER] Error updating final:', error);
        } else {
          console.log('[ADVANCE_WINNER] Updated final with winner team from SF', matchIndex + 1);
        }
      }
    }

    if (thirdPlaceMatch) {
      if (isIndividual) {
        const updateData: any = {};
        if (matchIndex === 0) {
          updateData.player1_individual_id = loserIds.p1;
          updateData.player2_individual_id = loserIds.p2;
        } else {
          updateData.player3_individual_id = loserIds.p1;
          updateData.player4_individual_id = loserIds.p2;
        }

        const { error } = await supabase
          .from('matches')
          .update(updateData)
          .eq('id', thirdPlaceMatch.id);

        if (error) {
          console.error('[ADVANCE_WINNER] Error updating 3rd place:', error);
        } else {
          console.log('[ADVANCE_WINNER] Updated 3rd place with loser from SF', matchIndex + 1);
        }
      } else {
        const updateData: any = {};
        if (matchIndex === 0) {
          updateData.team1_id = loserIds.team;
        } else {
          updateData.team2_id = loserIds.team;
        }

        const { error } = await supabase
          .from('matches')
          .update(updateData)
          .eq('id', thirdPlaceMatch.id);

        if (error) {
          console.error('[ADVANCE_WINNER] Error updating 3rd place:', error);
        } else {
          console.log('[ADVANCE_WINNER] Updated 3rd place with loser team from SF', matchIndex + 1);
        }
      }
    }
  }

  if (quarterfinalRounds.includes(round)) {
    const quarterfinalMatches = allMatches
      .filter(m => quarterfinalRounds.includes(m.round))
      .sort((a, b) => a.match_number - b.match_number);

    const semifinalMatches = allMatches
      .filter(m => semifinalRounds.includes(m.round))
      .sort((a, b) => a.match_number - b.match_number);

    const isPowerOf2 = quarterfinalMatches.length === semifinalMatches.length * 2;

    if (isPowerOf2) {
      // Standard bracket: 4 QFs → 2 SFs (each pair of QFs feeds one SF)
      const matchIndex = quarterfinalMatches.findIndex(m => m.id === completedMatchId);
      const targetSemifinalIndex = Math.floor(matchIndex / 2);
      const isFirstInPair = matchIndex % 2 === 0;

      if (semifinalMatches[targetSemifinalIndex]) {
        if (isIndividual) {
          const updateData: any = {};
          if (isFirstInPair) {
            updateData.player1_individual_id = winnerIds.p1;
            updateData.player2_individual_id = winnerIds.p2;
          } else {
            updateData.player3_individual_id = winnerIds.p1;
            updateData.player4_individual_id = winnerIds.p2;
          }
          await supabase.from('matches').update(updateData).eq('id', semifinalMatches[targetSemifinalIndex].id);
          console.log('[ADVANCE_WINNER] Updated SF', targetSemifinalIndex + 1, 'with winner from QF', matchIndex + 1);
        } else {
          const updateData: any = {};
          if (isFirstInPair) {
            updateData.team1_id = winnerIds.team;
          } else {
            updateData.team2_id = winnerIds.team;
          }
          await supabase.from('matches').update(updateData).eq('id', semifinalMatches[targetSemifinalIndex].id);
          console.log('[ADVANCE_WINNER] Updated SF', targetSemifinalIndex + 1, 'with winner team from QF', matchIndex + 1);
        }
      }
    } else {
      // Non-standard bracket (e.g. 3 QFs → 2 SFs): batch advancement
      // Wait until ALL QFs are complete before advancing
      const allQFsDone = quarterfinalMatches.every(m => m.status === 'completed');
      if (!allQFsDone) {
        console.log(`[ADVANCE_WINNER] Non-standard bracket: waiting for all QFs (${quarterfinalMatches.filter(m => m.status === 'completed').length}/${quarterfinalMatches.length})`);
        return;
      }

      console.log('[ADVANCE_WINNER] All QFs complete, batch advancing to SFs + consolation');

      if (isIndividual) {
        // Collect winners and losers from all QFs
        const qfResults: Array<{ winners: { p1: string; p2: string }; losers: { p1: string; p2: string }; winnerGameDiff: number; loserGameDiff: number }> = [];

        for (const qf of quarterfinalMatches) {
          const t1g = (qf.team1_score_set1 || 0) + (qf.team1_score_set2 || 0) + (qf.team1_score_set3 || 0);
          const t2g = (qf.team2_score_set1 || 0) + (qf.team2_score_set2 || 0) + (qf.team2_score_set3 || 0);
          const t1Won = t1g > t2g;

          if (t1Won) {
            qfResults.push({
              winners: { p1: qf.player1_individual_id, p2: qf.player2_individual_id },
              losers: { p1: qf.player3_individual_id, p2: qf.player4_individual_id },
              winnerGameDiff: t1g - t2g,
              loserGameDiff: t2g - t1g,
            });
          } else {
            qfResults.push({
              winners: { p1: qf.player3_individual_id, p2: qf.player4_individual_id },
              losers: { p1: qf.player1_individual_id, p2: qf.player2_individual_id },
              winnerGameDiff: t2g - t1g,
              loserGameDiff: t1g - t2g,
            });
          }
        }

        // Sort winners by game diff (best first) for seeding
        const sortedWinners = [...qfResults].sort((a, b) => b.winnerGameDiff - a.winnerGameDiff);
        
        // Calculate stats for each losing team based ONLY on their QF match
        const losingTeamStats = qfResults.map(r => {
          // Find the QF match for this losing team
          const qf = quarterfinalMatches.find(m => {
            const team1Players = [m.player1_individual_id, m.player2_individual_id].filter(Boolean);
            const team2Players = [m.player3_individual_id, m.player4_individual_id].filter(Boolean);
            const wasTeam1 = team1Players.includes(r.losers.p1) && team1Players.includes(r.losers.p2);
            const wasTeam2 = team2Players.includes(r.losers.p1) && team2Players.includes(r.losers.p2);
            return wasTeam1 || wasTeam2;
          });

          if (!qf) {
            return { losers: r.losers, gameDiff: r.loserGameDiff, gamesWon: 0 };
          }

          const t1g = (qf.team1_score_set1 || 0) + (qf.team1_score_set2 || 0) + (qf.team1_score_set3 || 0);
          const t2g = (qf.team2_score_set1 || 0) + (qf.team2_score_set2 || 0) + (qf.team2_score_set3 || 0);
          const team1Players = [qf.player1_individual_id, qf.player2_individual_id].filter(Boolean);
          const wasTeam1 = team1Players.includes(r.losers.p1) && team1Players.includes(r.losers.p2);
          
          // Games won by the losing team in their QF match
          const gamesWon = wasTeam1 ? t1g : t2g;
          
          return {
            losers: r.losers,
            gameDiff: r.loserGameDiff, // Negative value (they lost)
            gamesWon
          };
        });

        // Sort losers by QF match stats: 1) best game diff (least negative = best loss), 2) most games won
        const sortedLosers = [...qfResults].sort((a, b) => {
          const statsA = losingTeamStats.find(s => 
            (s.losers.p1 === a.losers.p1 && s.losers.p2 === a.losers.p2) ||
            (s.losers.p1 === a.losers.p2 && s.losers.p2 === a.losers.p1)
          );
          const statsB = losingTeamStats.find(s => 
            (s.losers.p1 === b.losers.p1 && s.losers.p2 === b.losers.p2) ||
            (s.losers.p1 === b.losers.p2 && s.losers.p2 === b.losers.p1)
          );

          const diffA = statsA?.gameDiff || -999;
          const diffB = statsB?.gameDiff || -999;
          const wonA = statsA?.gamesWon || 0;
          const wonB = statsB?.gamesWon || 0;

          // First: better game difference (less negative = better, e.g., -2 is better than -5)
          if (diffB !== diffA) {
            return diffB - diffA;
          }
          // Second: more games won in the QF match
          return wonB - wonA;
        });

        console.log('[ADVANCE_WINNER] Losing teams sorted by QF match stats (diff, games won):', sortedLosers.map((r, idx) => {
          const stats = losingTeamStats.find(s => 
            (s.losers.p1 === r.losers.p1 && s.losers.p2 === r.losers.p2) ||
            (s.losers.p1 === r.losers.p2 && s.losers.p2 === r.losers.p1)
          );
          return `${idx + 1}°: diff=${stats?.gameDiff || 0}, won=${stats?.gamesWon || 0}`;
        }));

        // Build SF qualifiers: all winners + best losers to fill SFs
        const sfPairs: Array<{ p1: string; p2: string }> = sortedWinners.map(r => r.winners);
        const consolationPairs: Array<{ p1: string; p2: string }> = [];

        // We need exactly semifinalMatches.length * 2 pairs for SFs
        const slotsNeeded = semifinalMatches.length * 2;
        let loserIdx = 0;
        while (sfPairs.length < slotsNeeded && loserIdx < sortedLosers.length) {
          sfPairs.push(sortedLosers[loserIdx].losers);
          loserIdx++;
        }

        // Remaining losers go to consolation
        while (loserIdx < sortedLosers.length) {
          consolationPairs.push(sortedLosers[loserIdx].losers);
          loserIdx++;
        }

        console.log(`[ADVANCE_WINNER] SF qualifiers: ${sfPairs.length} pairs, Consolation: ${consolationPairs.length} pairs`);

        // Populate SF matches
        for (let i = 0; i < semifinalMatches.length && i * 2 + 1 < sfPairs.length; i++) {
          const pair1 = sfPairs[i * 2];
          const pair2 = sfPairs[i * 2 + 1];
          await supabase.from('matches').update({
            player1_individual_id: pair1.p1,
            player2_individual_id: pair1.p2,
            player3_individual_id: pair2.p1,
            player4_individual_id: pair2.p2,
          }).eq('id', semifinalMatches[i].id);
          console.log(`[ADVANCE_WINNER] SF${i + 1}: pair${i * 2 + 1} vs pair${i * 2 + 2}`);
        }

        // Populate consolation match
        const consolationMatch = allMatches.find(m => m.round === 'consolation');
        if (consolationMatch && consolationPairs.length >= 2) {
          await supabase.from('matches').update({
            player1_individual_id: consolationPairs[0].p1,
            player2_individual_id: consolationPairs[0].p2,
            player3_individual_id: consolationPairs[1].p1,
            player4_individual_id: consolationPairs[1].p2,
          }).eq('id', consolationMatch.id);
          console.log('[ADVANCE_WINNER] Consolation match populated');
        } else if (consolationMatch && consolationPairs.length === 1) {
          // If only 1 losing pair left, put them all in consolation with dummy
          await supabase.from('matches').update({
            player1_individual_id: consolationPairs[0].p1,
            player2_individual_id: consolationPairs[0].p2,
            player3_individual_id: null,
            player4_individual_id: null,
          }).eq('id', consolationMatch.id);
        }
      }
    }
  }

  console.log('[ADVANCE_WINNER] Done processing advancement');
}

