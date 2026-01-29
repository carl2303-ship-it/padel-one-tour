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

    // 2° Confronto direto (apenas aplicável quando comparamos 2 equipas)
    const h2hWinner = getHeadToHeadWinner(a.id, b.id, matches);
    if (h2hWinner === a.id) return -1;
    if (h2hWinner === b.id) return 1;

    // 3° Diferença de jogos
    const diffA = a.gamesWon - a.gamesLost;
    const diffB = b.gamesWon - b.gamesLost;
    if (diffB !== diffA) return diffB - diffA;

    // 4° Maior número de jogos ganhos
    if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;

    // 5° Data de inscrição (quem se inscreveu primeiro)
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

export async function populatePlacementMatches(
  tournamentId: string,
  categoryId?: string
): Promise<void> {
  console.log('[POPULATE_PLACEMENT] Starting for tournament:', tournamentId, 'category:', categoryId);

  let matchesQuery = supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId);

  if (categoryId) {
    matchesQuery = matchesQuery.eq('category_id', categoryId);
  }

  const { data: allMatches, error: matchesError } = await matchesQuery;

  if (matchesError || !allMatches) {
    console.error('[POPULATE_PLACEMENT] Error fetching matches:', matchesError);
    return;
  }

  const semifinalMatches = allMatches
    .filter(m => m.round === 'semifinal' || m.round === 'semi_final')
    .sort((a, b) => a.match_number - b.match_number);

  console.log('[POPULATE_PLACEMENT] Found', semifinalMatches.length, 'semifinal matches');

  if (semifinalMatches.length === 0) {
    console.log('[POPULATE_PLACEMENT] No semifinal matches to populate');
    return;
  }

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
    console.error('[POPULATE_PLACEMENT] Error fetching players:', playersError);
    return;
  }

  const groupMatches = allMatches.filter(m => m.round.startsWith('group_') && m.status === 'completed');

  const playerStats = new Map<string, { id: string; group_name: string; wins: number; gamesWon: number; gamesLost: number }>();

  players.forEach(player => {
    playerStats.set(player.id, {
      id: player.id,
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

  const playersByGroup = new Map<string, Array<{ id: string; group_name: string; wins: number; gamesWon: number; gamesLost: number }>>();

  Array.from(playerStats.values()).forEach(player => {
    if (!playersByGroup.has(player.group_name)) {
      playersByGroup.set(player.group_name, []);
    }
    playersByGroup.get(player.group_name)!.push(player);
  });

  const sortedGroups = Array.from(playersByGroup.keys()).sort();
  const rankedPlayers: Array<{ id: string; group: string; rank: number }> = [];

  sortedGroups.forEach((groupName) => {
    const groupPlayers = playersByGroup.get(groupName)!;
    const sorted = groupPlayers.sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      const diffA = a.gamesWon - a.gamesLost;
      const diffB = b.gamesWon - b.gamesLost;
      return diffB - diffA;
    });

    sorted.forEach((player, index) => {
      rankedPlayers.push({ id: player.id, group: groupName, rank: index + 1 });
    });
  });

  console.log('[POPULATE_PLACEMENT] Ranked players:', rankedPlayers);

  const numGroups = sortedGroups.length;
  const playersNeeded = semifinalMatches.length * 4;
  const qualifiedPerGroup = Math.ceil(playersNeeded / numGroups);

  console.log(`[POPULATE_PLACEMENT] Need ${playersNeeded} players for ${semifinalMatches.length} semifinal(s), ${qualifiedPerGroup} per group from ${numGroups} groups`);

  const qualified: string[] = [];
  for (let rank = 1; rank <= qualifiedPerGroup; rank++) {
    const playersAtRank = rankedPlayers.filter(p => p.rank === rank);
    qualified.push(...playersAtRank.map(p => p.id));
  }

  console.log('[POPULATE_PLACEMENT] Qualified for semifinals:', qualified);

  if (qualified.length < playersNeeded) {
    console.log(`[POPULATE_PLACEMENT] Not enough qualified players (${qualified.length}/${playersNeeded})`);
    return;
  }

  const shuffle = (array: string[]) => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const shuffledQualified = shuffle(qualified);

  if (semifinalMatches.length >= 1) {
    const { error: sf1Error } = await supabase
      .from('matches')
      .update({
        player1_individual_id: shuffledQualified[0],
        player2_individual_id: shuffledQualified[1],
        player3_individual_id: shuffledQualified[2],
        player4_individual_id: shuffledQualified[3],
      })
      .eq('id', semifinalMatches[0].id);

    if (sf1Error) {
      console.error('[POPULATE_PLACEMENT] Error updating SF1:', sf1Error);
    } else {
      console.log('[POPULATE_PLACEMENT] Updated SF1 with players:', shuffledQualified.slice(0, 4));
    }
  }

  if (semifinalMatches.length >= 2) {
    const { error: sf2Error } = await supabase
      .from('matches')
      .update({
        player1_individual_id: shuffledQualified[4],
        player2_individual_id: shuffledQualified[5],
        player3_individual_id: shuffledQualified[6],
        player4_individual_id: shuffledQualified[7],
      })
      .eq('id', semifinalMatches[1].id);

    if (sf2Error) {
      console.error('[POPULATE_PLACEMENT] Error updating SF2:', sf2Error);
    } else {
      console.log('[POPULATE_PLACEMENT] Updated SF2 with players:', shuffledQualified.slice(4, 8));
    }
  }

  console.log('[POPULATE_PLACEMENT] Done populating semifinal matches');
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

    const matchIndex = quarterfinalMatches.findIndex(m => m.id === completedMatchId);

    const semifinalMatches = allMatches
      .filter(m => semifinalRounds.includes(m.round))
      .sort((a, b) => a.match_number - b.match_number);

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

        const { error } = await supabase
          .from('matches')
          .update(updateData)
          .eq('id', semifinalMatches[targetSemifinalIndex].id);

        if (error) {
          console.error('[ADVANCE_WINNER] Error updating semifinal:', error);
        } else {
          console.log('[ADVANCE_WINNER] Updated SF', targetSemifinalIndex + 1, 'with winner from QF', matchIndex + 1);
        }
      } else {
        const updateData: any = {};
        if (isFirstInPair) {
          updateData.team1_id = winnerIds.team;
        } else {
          updateData.team2_id = winnerIds.team;
        }

        const { error } = await supabase
          .from('matches')
          .update(updateData)
          .eq('id', semifinalMatches[targetSemifinalIndex].id);

        if (error) {
          console.error('[ADVANCE_WINNER] Error updating semifinal:', error);
        } else {
          console.log('[ADVANCE_WINNER] Updated SF', targetSemifinalIndex + 1, 'with winner team from QF', matchIndex + 1);
        }
      }
    }
  }

  console.log('[ADVANCE_WINNER] Done processing advancement');
}

