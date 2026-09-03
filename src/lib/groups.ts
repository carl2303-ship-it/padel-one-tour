import { supabase } from './supabase';

export type Team = {
  id: string;
  name: string;
  group_name?: string;
  seed?: number | null;
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
  const getPoints = (t: TeamStats) => t.wins * 2 + (t.draws || 0);
  const getDiff = (t: TeamStats) => t.gamesWon - t.gamesLost;

  const tiebreakSort = (a: TeamStats, b: TeamStats) => {
    const diffCmp = getDiff(b) - getDiff(a);
    if (diffCmp !== 0) return diffCmp;
    if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;
    if (teamOrder) {
      return (teamOrder.get(a.id) ?? 999) - (teamOrder.get(b.id) ?? 999);
    }
    if (a.created_at && b.created_at) {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    return 0;
  };

  // 1° Sort by wins (desc), then points (desc)
  const sorted = [...teams].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return getPoints(b) - getPoints(a);
  });

  // 2° Process groups of tied teams (same wins + same points)
  const result: TeamStats[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].wins === sorted[i].wins && getPoints(sorted[j]) === getPoints(sorted[i])) {
      j++;
    }

    const tiedGroup = sorted.slice(i, j);

    if (tiedGroup.length === 1) {
      result.push(tiedGroup[0]);
    } else if (tiedGroup.length === 2) {
      // 2 teams tied: head-to-head first, then game diff
      const h2hWinner = getHeadToHeadWinner(tiedGroup[0].id, tiedGroup[1].id, matches);
      if (h2hWinner === tiedGroup[0].id) {
        result.push(tiedGroup[0], tiedGroup[1]);
      } else if (h2hWinner === tiedGroup[1].id) {
        result.push(tiedGroup[1], tiedGroup[0]);
      } else {
        result.push(...tiedGroup.sort(tiebreakSort));
      }
    } else {
      // 3+ teams tied: skip head-to-head (circular risk), use game diff then games won
      result.push(...tiedGroup.sort(tiebreakSort));
    }

    i = j;
  }

  return result;
}

/**
 * Randomly assigns teams to groups
 * @param teams - Array of teams to assign
 * @param numberOfGroups - Number of groups to create
 * @returns Array of teams with group_name assigned (A, B, C, etc.)
 */
export function assignTeamsToGroups(teams: Team[], numberOfGroups: number): Team[] {

  const groupNames = Array.from({ length: numberOfGroups }, (_, i) =>
    String.fromCharCode(65 + i)
  );

  const seeded = teams.filter(t => t.seed != null && t.seed > 0).sort((a, b) => a.seed! - b.seed!);
  const unseeded = teams.filter(t => !t.seed || t.seed <= 0).sort(() => Math.random() - 0.5);
  const ordered = [...seeded, ...unseeded];


  const result = ordered.map((team, index) => {
    const row = Math.floor(index / numberOfGroups);
    const posInRow = index % numberOfGroups;
    const groupIndex = row % 2 === 0 ? posInRow : (numberOfGroups - 1 - posInRow);
    return { ...team, group_name: groupNames[groupIndex] };
  });


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

  grouped.forEach((groupTeams, key) => {
    grouped.set(key, groupTeams.sort((a, b) => {
      const seedA = a.seed ?? Infinity;
      const seedB = b.seed ?? Infinity;
      return seedA - seedB;
    }));
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

  grouped.forEach((groupPlayers, key) => {
    grouped.set(key, groupPlayers.sort((a, b) => {
      const seedA = a.seed ?? Infinity;
      const seedB = b.seed ?? Infinity;
      return seedA - seedB;
    }));
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
  }

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
    .like('round', 'group_%')
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


    sorted.slice(0, qualifiedPerGroup).forEach((team, rank) => {
      qualified.push({ id: team.id, group: groupName, rank: rank + 1 });
    });
  });

  const orderedQualified: string[] = [];
  for (let rank = 1; rank <= qualifiedPerGroup; rank++) {
    const teamsAtRank = qualified.filter(q => q.rank === rank);
    orderedQualified.push(...teamsAtRank.map(q => q.id));
  }

  const totalQualified = orderedQualified.length;
  const nextPowerOf2 = Math.pow(2, Math.ceil(Math.log2(totalQualified)));


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

    orderedQualified.push(...bestThirds.map(t => t.id));
  }

  return orderedQualified;
}

/**
 * Updates team placement after group stage
 */
export type IndividualPlayer = {
  id: string;
  name: string;
  group_name?: string;
  seed?: number | null;
};

export function assignPlayersToGroups(players: IndividualPlayer[], numberOfGroups: number): IndividualPlayer[] {

  const groupNames = Array.from({ length: numberOfGroups }, (_, i) =>
    String.fromCharCode(65 + i)
  );

  const seeded = players.filter(p => p.seed != null && p.seed > 0).sort((a, b) => a.seed! - b.seed!);
  const unseeded = players.filter(p => !p.seed || p.seed <= 0).sort(() => Math.random() - 0.5);
  const ordered = [...seeded, ...unseeded];


  const result = ordered.map((player, index) => {
    const row = Math.floor(index / numberOfGroups);
    const posInRow = index % numberOfGroups;
    const groupIndex = row % 2 === 0 ? posInRow : (numberOfGroups - 1 - posInRow);
    return { ...player, group_name: groupNames[groupIndex] };
  });


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
    const team2Won = team2Games > team1Games;

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
      if (team2Won) player3Stats.wins++;
    }
    if (player4Stats) {
      player4Stats.matchesPlayed++;
      player4Stats.gamesWon += team2Games;
      player4Stats.gamesLost += team1Games;
      if (team2Won) player4Stats.wins++;
    }
  });

  const playersByGroup = new Map<string, Array<{ id: string; group_name: string; wins: number; gamesWon: number; gamesLost: number; matchesPlayed: number }>>();

  Array.from(playerStats.values()).forEach(player => {
    if (!playersByGroup.has(player.group_name)) {
      playersByGroup.set(player.group_name, []);
    }
    playersByGroup.get(player.group_name)!.push(player);
  });


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


    sorted.slice(0, qualifiedPerGroup).forEach((player, rank) => {
      qualified.push({ id: player.id, group: groupName, rank: rank + 1 });
    });
  });

  const orderedQualified: string[] = [];
  for (let rank = 1; rank <= qualifiedPerGroup; rank++) {
    const playersAtRank = qualified.filter(q => q.rank === rank);
    orderedQualified.push(...playersAtRank.map(q => q.id));
  }

  const numGroups = sortedGroups.length;
  const totalQualified = orderedQualified.length;


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

    orderedQualified.push(...bestExtra.map(p => p.id));
  }

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
    return;
  }

  const alreadyPopulated = directFinalRounds.every(m =>
    m.player1_individual_id && m.player1_individual_id !== 'TBD' &&
    m.player3_individual_id && m.player3_individual_id !== 'TBD'
  );
  if (alreadyPopulated) {
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

    const team2Won = team2Games > team1Games;
    if (p1Stats) { p1Stats.gamesWon += team1Games; p1Stats.gamesLost += team2Games; if (team1Won) p1Stats.wins++; }
    if (p2Stats) { p2Stats.gamesWon += team1Games; p2Stats.gamesLost += team2Games; if (team1Won) p2Stats.wins++; }
    if (p3Stats) { p3Stats.gamesWon += team2Games; p3Stats.gamesLost += team1Games; if (team2Won) p3Stats.wins++; }
    if (p4Stats) { p4Stats.gamesWon += team2Games; p4Stats.gamesLost += team1Games; if (team2Won) p4Stats.wins++; }
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
  });

  const maxPlayersPerGroup = Math.max(...Array.from(rankedByGroup.values()).map(g => g.length));

  for (let matchIdx = 0; matchIdx < directFinalRounds.length; matchIdx++) {
    const match = directFinalRounds[matchIdx];
    const startRank = matchIdx * 2;

    if (startRank >= maxPlayersPerGroup) break;

    if (match.player1_individual_id && match.player1_individual_id !== 'TBD') {
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

      // Cruzamento rotativo: (pos1)°A+(pos2)°B vs (pos1)°B+(pos2)°A
      const updateData: any = {
        player1_individual_id: a1,
        player2_individual_id: b2 || b1 || a1,
        player3_individual_id: b1 || a1,
        player4_individual_id: a2 || b1,
      };

      const { error } = await supabase
        .from('matches')
        .update(updateData)
        .eq('id', match.id);

      if (error) {
        console.error(`[POPULATE_DIRECT_FINALS] Error updating ${match.round}:`, error);
      } else {
      }
    } else {
      // 3+ grupos: cruzamento G[startRank] + (G+1)[startRank+1]
      const nGroups = sortedGroups.length;
      const dfRankings = sortedGroups.map(g => rankedByGroup.get(g)!);
      const usedDf = new Set<string>();

      const dfPairs: Array<[string, string]> = [];
      for (let g = 0; g < nGroups; g++) {
        const gNext = (g + 1) % nGroups;
        const pA = startRank < dfRankings[g].length ? dfRankings[g][startRank] : null;
        const pB = (startRank + 1) < dfRankings[gNext].length ? dfRankings[gNext][startRank + 1] : null;
        if (pA && pB && !usedDf.has(pA) && !usedDf.has(pB)) {
          dfPairs.push([pA, pB]);
          usedDf.add(pA);
          usedDf.add(pB);
        }
      }
      if (dfPairs.length === 3) {
        const tmp = dfPairs[1];
        dfPairs[1] = dfPairs[2];
        dfPairs[2] = tmp;
      }
      // Restantes
      for (let pos = startRank; pos < startRank + 2; pos++) {
        for (let g = 0; g < nGroups; g++) {
          if (pos < dfRankings[g].length && !usedDf.has(dfRankings[g][pos])) {
            dfPairs.push([dfRankings[g][pos], '']);
            usedDf.add(dfRankings[g][pos]);
          }
        }
      }

      if (dfPairs.length >= 2 && dfPairs[0][0] && dfPairs[0][1] && dfPairs[1][0] && dfPairs[1][1]) {
        const { error } = await supabase
          .from('matches')
          .update({
            player1_individual_id: dfPairs[0][0],
            player2_individual_id: dfPairs[0][1],
            player3_individual_id: dfPairs[1][0],
            player4_individual_id: dfPairs[1][1],
          })
          .eq('id', match.id);

        if (error) {
          console.error(`[POPULATE_DIRECT_FINALS] Error updating ${match.round}:`, error);
        } else {
        }
      }
    }
  }

}

export async function populatePlacementMatches(
  tournamentId: string,
  categoryId?: string
): Promise<void> {

  const { data: allMatches, error: matchesError } = await supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId);

  if (matchesError || !allMatches) {
    console.error('[POPULATE_PLACEMENT] Error fetching matches:', matchesError);
    return;
  }

  // ====================================================================
  // ROUND OF 16: Check if there are round_of_16 matches to populate
  // ====================================================================
  const allRo16Rounds = ['round_of_16'];
  const allRo16 = allMatches
    .filter(m => allRo16Rounds.includes(m.round))
    .sort((a, b) => a.match_number - b.match_number);

  const hasUnpopulatedRo16 = allRo16.some(m =>
    !m.player1_individual_id && !m.player3_individual_id
  );


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


  const tierPrefixes = ['1st', '5th', '9th', '13th', '17th', '21st'];
  const allSemifinalRounds = [
    'semifinal', 'semi_final',
    ...tierPrefixes.map(p => `${p}_semifinal`)
  ];

  const allSemis = allMatches
    .filter(m => allSemifinalRounds.includes(m.round))
    .sort((a, b) => a.match_number - b.match_number);


  if (allSemis.length === 0 && allQuarterfinals.length === 0 && allRo16.length === 0) {
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

    const team2Won = team2Games > team1Games;
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
      if (team2Won) p3Stats.wins++;
    }
    if (p4Stats) {
      p4Stats.gamesWon += team2Games;
      p4Stats.gamesLost += team1Games;
      if (team2Won) p4Stats.wins++;
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
  });

  const maxPlayersPerGroup = Math.max(...Array.from(rankedByGroup.values()).map(g => g.length));
  const totalPlayers = players.length;


  // ====================================================================
  // ROUND OF 16 POPULATION: If round_of_16 exist and are unpopulated
  // ====================================================================
  if (allRo16.length > 0 && hasUnpopulatedRo16) {

    const unpopulatedRo16 = allRo16
      .filter(m => !m.player1_individual_id && !m.player3_individual_id)
      .sort((a, b) => a.match_number - b.match_number);

    const nGroupsRo16 = sortedGroups.length;
    const totalSlotsNeeded = unpopulatedRo16.length * 4;
    const qualPerGroup = Math.floor(totalSlotsNeeded / nGroupsRo16);
    const extraNeeded = totalSlotsNeeded - qualPerGroup * nGroupsRo16;


    const filteredRankings = new Map<string, string[]>();
    sortedGroups.forEach(g => {
      filteredRankings.set(g, (rankedByGroup.get(g) || []).slice(0, qualPerGroup));
    });

    if (extraNeeded > 0) {
      const extraCandidates: Array<{ id: string; group: string; wins: number; diff: number }> = [];
      sortedGroups.forEach(g => {
        const fullRanking = rankedByGroup.get(g) || [];
        if (fullRanking.length > qualPerGroup) {
          const extraId = fullRanking[qualPerGroup];
          const stats = playerStats.get(extraId);
          if (stats) {
            extraCandidates.push({
              id: extraId,
              group: g,
              wins: stats.wins,
              diff: stats.gamesWon - stats.gamesLost,
            });
          }
        }
      });
      extraCandidates.sort((a, b) => {
        if (a.wins !== b.wins) return b.wins - a.wins;
        return b.diff - a.diff;
      });
      extraCandidates.slice(0, extraNeeded).forEach(e => {
        filteredRankings.get(e.group)!.push(e.id);
      });
    }

    const rankingsRo16 = sortedGroups.map(g => filteredRankings.get(g)!);
    const maxLenRo16 = Math.max(...rankingsRo16.map(r => r.length));
    const usedRo16 = new Set<string>();
    const allPairsRo16: Array<[string, string]> = [];

    for (let basePos = 0; basePos < maxLenRo16; basePos += 2) {
      const layerPairs: Array<[string, string]> = [];
      for (let g = 0; g < nGroupsRo16; g++) {
        const gNext = (g + 1) % nGroupsRo16;
        const pA = basePos < rankingsRo16[g].length ? rankingsRo16[g][basePos] : null;
        const pB = (basePos + 1) < rankingsRo16[gNext].length ? rankingsRo16[gNext][basePos + 1] : null;
        if (pA && pB && !usedRo16.has(pA) && !usedRo16.has(pB)) {
          layerPairs.push([pA, pB]);
          usedRo16.add(pA);
          usedRo16.add(pB);
        }
      }
      if (layerPairs.length === 3) {
        const tmp = layerPairs[1]; layerPairs[1] = layerPairs[2]; layerPairs[2] = tmp;
      }
      allPairsRo16.push(...layerPairs);

      const remaining: string[] = [];
      for (let pos = basePos; pos < basePos + 2; pos++) {
        for (let g = 0; g < nGroupsRo16; g++) {
          const p = pos < rankingsRo16[g].length ? rankingsRo16[g][pos] : null;
          if (p && !usedRo16.has(p)) {
            remaining.push(p);
            usedRo16.add(p);
          }
        }
      }
      for (let r = 0; r + 1 < remaining.length; r += 2) {
        allPairsRo16.push([remaining[r], remaining[r + 1]]);
      }
      if (remaining.length % 2 === 1) {
        allPairsRo16.push([remaining[remaining.length - 1], '']);
      }
    }


    for (let i = 0; i < unpopulatedRo16.length && (i * 2 + 1) < allPairsRo16.length; i++) {
      const pair1 = allPairsRo16[i * 2];
      const pair2 = allPairsRo16[i * 2 + 1];
      if (!pair1?.[0] || !pair1?.[1] || !pair2?.[0] || !pair2?.[1]) break;

      await supabase.from('matches').update({
        player1_individual_id: pair1[0],
        player2_individual_id: pair1[1],
        player3_individual_id: pair2[0],
        player4_individual_id: pair2[1],
      }).eq('id', unpopulatedRo16[i].id);
    }

    // Delete extra empty RO16 matches
    const { data: updatedRo16 } = await supabase
      .from('matches')
      .select('id, player1_individual_id, player3_individual_id')
      .eq('tournament_id', tournamentId)
      .in('round', allRo16Rounds);

    if (updatedRo16) {
      const emptyRo16 = updatedRo16.filter(m => !m.player1_individual_id && !m.player3_individual_id);
      if (emptyRo16.length > 0) {
        for (const empty of emptyRo16) {
          await supabase.from('matches').delete().eq('id', empty.id);
        }
      }
    }

    return;
  }

  if (allRo16.length > 0) {
    return;
  }

  // ====================================================================
  // QUARTERFINALS POPULATION: If quarterfinals exist and are unpopulated
  // ====================================================================
  if (allQuarterfinals.length > 0 && hasUnpopulatedQF) {
    
    const unpopulatedQFs = allQuarterfinals
      .filter(m => !m.player1_individual_id && !m.player3_individual_id)
      .sort((a, b) => a.match_number - b.match_number);

    if (isSingleGroup) {
      // Single group: populate QFs with ranked players (rankings similares juntos)
      const ranking = rankedByGroup.get(sortedGroups[0])!;
      const numQFsNeeded = Math.min(unpopulatedQFs.length, Math.floor(ranking.length / 4));
      
      for (let i = 0; i < numQFsNeeded; i++) {
        const base = i * 4;
        if (base + 3 >= ranking.length) break;
        
        await supabase.from('matches').update({
          player1_individual_id: ranking[base],
          player2_individual_id: ranking[base + 1],
          player3_individual_id: ranking[base + 2],
          player4_individual_id: ranking[base + 3],
        }).eq('id', unpopulatedQFs[i].id);
      }
    } else if (sortedGroups.length === 2) {
      const groupA = sortedGroups[0];
      const groupB = sortedGroups[1];
      const rankA = rankedByGroup.get(groupA)!;
      const rankB = rankedByGroup.get(groupB)!;
      const qualPerGroup = Math.min(rankA.length, rankB.length);
      const maxQFs = Math.min(unpopulatedQFs.length, Math.floor(qualPerGroup / 2));

      for (let i = 0; i < maxQFs; i++) {
        const pos1 = i * 2;
        const pos2 = i * 2 + 1;
        const a1 = rankA[pos1];
        const a2 = rankA[pos2];
        const b1 = rankB[pos1];
        const b2 = rankB[pos2];

        if (!a1 || !a2 || !b1 || !b2) break;

        // Cruzamento rotativo: (pos1)°A+(pos2)°B vs (pos1)°B+(pos2)°A
        await supabase.from('matches').update({
          player1_individual_id: a1,
          player2_individual_id: b2,
          player3_individual_id: b1,
          player4_individual_id: a2,
        }).eq('id', unpopulatedQFs[i].id);
      }
    } else {
      // 3+ grupos: cruzamento rotativo
      // Com 3 grupos (A=0,B=1,C=2) x 4 jogadores:
      //   QF1: A1+B2 vs C1+A2   (g0p0+g1p1, g2p0+g0p1)
      //   QF2: B1+C2 vs A3+B3   (g1p0+g2p1, g0p2+g1p2)
      //   QF3: A4+C3 vs B4+C4   (g0p3+g2p2, g1p3+g2p3)
      const nGroups = sortedGroups.length;
      const rankings = sortedGroups.map(g => rankedByGroup.get(g)!);
      const usedPlayers = new Set<string>();

      // Fase 1: pares cruzados — grupo G pos 0 com grupo (G+1)%N pos 1
      const crossedPairs: Array<[string, string]> = [];
      for (let g = 0; g < nGroups; g++) {
        const gNext = (g + 1) % nGroups;
        const playerA = 0 < rankings[g].length ? rankings[g][0] : null;
        const playerB = 1 < rankings[gNext].length ? rankings[gNext][1] : null;
        if (playerA && playerB && !usedPlayers.has(playerA) && !usedPlayers.has(playerB)) {
          crossedPairs.push([playerA, playerB]);
          usedPlayers.add(playerA);
          usedPlayers.add(playerB);
        }
      }

      // Reordenar pares cruzados: [0, 2, 1] para que A1+B2 vs C1+A2, depois B1+C2
      const reordered: Array<[string, string]> = [];
      if (crossedPairs.length === 3) {
        reordered.push(crossedPairs[0], crossedPairs[2], crossedPairs[1]);
      } else {
        reordered.push(...crossedPairs);
      }

      // Fase 2: jogadores restantes emparelhados na ordem (rank por rank, grupo por grupo)
      const remaining: string[] = [];
      const maxLen = Math.max(...rankings.map(r => r.length));
      for (let pos = 0; pos < maxLen; pos++) {
        for (let g = 0; g < nGroups; g++) {
          if (pos < rankings[g].length && !usedPlayers.has(rankings[g][pos])) {
            remaining.push(rankings[g][pos]);
          }
        }
      }

      const allPairs = [...reordered];
      for (let i = 0; i < remaining.length - 1; i += 2) {
        allPairs.push([remaining[i], remaining[i + 1]]);
      }
      const crossPairs = allPairs;


      for (let i = 0; i < unpopulatedQFs.length && (i * 2 + 1) < crossPairs.length; i++) {
        const pair1 = crossPairs[i * 2];
        const pair2 = crossPairs[i * 2 + 1];
        if (!pair1 || !pair2) break;

        await supabase.from('matches').update({
          player1_individual_id: pair1[0],
          player2_individual_id: pair1[1],
          player3_individual_id: pair2[0],
          player4_individual_id: pair2[1],
        }).eq('id', unpopulatedQFs[i].id);
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
        for (const emptyQF of emptyQFs) {
          await supabase.from('matches').delete().eq('id', emptyQF.id);
        }
      }
    }
    

    return;
  }

  if (allQuarterfinals.length > 0) {
    return;
  }

  // SINGLE GROUP (e.g. mixed_american): populate semifinals with top 4 directly
  if (isSingleGroup) {
    const singleGroupRanking = rankedByGroup.get(sortedGroups[0])!;

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
        // SF1: 1st + 2nd vs 3rd + 4th (rankings similares juntos)
        await supabase
          .from('matches')
          .update({
            player1_individual_id: p1,
            player2_individual_id: p2,
            player3_individual_id: p3,
            player4_individual_id: p4,
          })
          .eq('id', semifinalMatches[0].id);

        if (singleGroupRanking.length >= 8) {
          // With 8+ players, SF2 gets players 5-8
          const [, , , , p5, p6, p7, p8] = singleGroupRanking;
          await supabase
            .from('matches')
            .update({
              player1_individual_id: p5,
              player2_individual_id: p6,
              player3_individual_id: p7,
              player4_individual_id: p8 || p7,
            })
            .eq('id', semifinalMatches[1].id);
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
        }
      }
    }

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
      return;
    }

    const alreadyPopulated = tierSemis.every(m =>
      m.player1_individual_id && m.player2_individual_id &&
      m.player3_individual_id && m.player4_individual_id
    );
    if (alreadyPopulated) {
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

      // SF1: (A1+B2) vs (B1+A2) - cruzamento rotativo
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
      }

      // SF2: (A1+A2) vs (B1+B2) - mesmos do grupo juntos para variar confrontos
      const { error: sf2Error } = await supabase
        .from('matches')
        .update({
          player1_individual_id: a1,
          player2_individual_id: a2,
          player3_individual_id: b1,
          player4_individual_id: b2,
        })
        .eq('id', tierSemis[1].id);

      if (sf2Error) {
        console.error(`[POPULATE_PLACEMENT] Error updating ${tierPrefix} SF2:`, sf2Error);
      } else {
      }
    } else {
      // 3+ grupos: cruzamento G[startRank] + (G+1)[startRank+1]
      const nGroups = sortedGroups.length;
      const fullRankings = sortedGroups.map(g => rankedByGroup.get(g)!);
      const usedTier = new Set<string>();

      const tierPairs: Array<[string, string]> = [];
      for (let g = 0; g < nGroups; g++) {
        const gNext = (g + 1) % nGroups;
        const pA = startRank < fullRankings[g].length ? fullRankings[g][startRank] : null;
        const pB = (startRank + 1) < fullRankings[gNext].length ? fullRankings[gNext][startRank + 1] : null;
        if (pA && pB && !usedTier.has(pA) && !usedTier.has(pB)) {
          tierPairs.push([pA, pB]);
          usedTier.add(pA);
          usedTier.add(pB);
        }
      }
      if (tierPairs.length === 3) {
        const tmp = tierPairs[1];
        tierPairs[1] = tierPairs[2];
        tierPairs[2] = tmp;
      }

      // Restantes do tier
      const tierRemaining: string[] = [];
      for (let pos = startRank; pos < startRank + 2; pos++) {
        for (let g = 0; g < nGroups; g++) {
          if (pos < fullRankings[g].length && !usedTier.has(fullRankings[g][pos])) {
            tierRemaining.push(fullRankings[g][pos]);
          }
        }
      }
      for (let i = 0; i < tierRemaining.length - 1; i += 2) {
        tierPairs.push([tierRemaining[i], tierRemaining[i + 1]]);
      }

      const totalPairsNeeded = tierSemis.length * 2;
      if (tierPairs.length < totalPairsNeeded) {
        const extraRank = startRank + 2;
        const extraCandidates: Array<{ id: string; wins: number; diff: number }> = [];

        for (let g = 0; g < nGroups; g++) {
          if (extraRank < fullRankings[g].length && !usedTier.has(fullRankings[g][extraRank])) {
            const playerId = fullRankings[g][extraRank];
            const stats = playerStats.get(playerId);
            if (stats) {
              extraCandidates.push({ id: playerId, wins: stats.wins, diff: stats.gamesWon - stats.gamesLost });
            }
          }
        }

        extraCandidates.sort((a, b) => {
          if (a.wins !== b.wins) return b.wins - a.wins;
          return b.diff - a.diff;
        });

        const extraNeeded = (totalPairsNeeded - tierPairs.length) * 2;
        const bestExtras = extraCandidates.slice(0, extraNeeded);

        for (let ei = 0; ei < bestExtras.length - 1; ei += 2) {
          tierPairs.push([bestExtras[ei].id, bestExtras[ei + 1].id]);
          usedTier.add(bestExtras[ei].id);
          usedTier.add(bestExtras[ei + 1].id);
        }

      }


      for (let i = 0; i < tierSemis.length && (i * 2 + 1) < tierPairs.length; i++) {
        const pair1 = tierPairs[i * 2];
        const pair2 = tierPairs[i * 2 + 1];
        await supabase
          .from('matches')
          .update({
            player1_individual_id: pair1[0],
            player2_individual_id: pair1[1],
            player3_individual_id: pair2[0],
            player4_individual_id: pair2[1],
          })
          .eq('id', tierSemis[i].id);
      }
    }

  };

  for (let i = 0; i < tierPrefixes.length; i++) {
    const startRank = i * 2;
    if (startRank >= maxPlayersPerGroup) break;
    await populateTier(i, tierPrefixes[i]);
  }

}

export async function advanceKnockoutWinner(
  tournamentId: string,
  completedMatchId: string,
  categoryId?: string
): Promise<void> {

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


  if (round.startsWith('group_')) {
    return;
  }

  const team1Games = (completedMatch.team1_score_set1 || 0) + (completedMatch.team1_score_set2 || 0) + (completedMatch.team1_score_set3 || 0);
  const team2Games = (completedMatch.team2_score_set1 || 0) + (completedMatch.team2_score_set2 || 0) + (completedMatch.team2_score_set3 || 0);

  if (team1Games === team2Games) {
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

  const ro16Rounds = ['round_of_16'];
  const semifinalRounds = ['semifinal', 'semi_final', '1st_semifinal'];
  const quarterfinalRounds = ['quarterfinal', 'quarter_final'];

  if (ro16Rounds.includes(round)) {
    const ro16Matches = allMatches
      .filter(m => ro16Rounds.includes(m.round))
      .sort((a, b) => a.match_number - b.match_number);

    const quarterfinalMatches = allMatches
      .filter(m => quarterfinalRounds.includes(m.round))
      .sort((a, b) => a.match_number - b.match_number);

    const isPowerOf2 = ro16Matches.length === quarterfinalMatches.length * 2;

    if (isPowerOf2) {
      const matchIndex = ro16Matches.findIndex(m => m.id === completedMatchId);
      const targetQFIndex = Math.floor(matchIndex / 2);
      const isFirstInPair = matchIndex % 2 === 0;

      if (quarterfinalMatches[targetQFIndex]) {
        if (isIndividual) {
          const updateData: any = {};
          if (isFirstInPair) {
            updateData.player1_individual_id = winnerIds.p1;
            updateData.player2_individual_id = winnerIds.p2;
          } else {
            updateData.player3_individual_id = winnerIds.p1;
            updateData.player4_individual_id = winnerIds.p2;
          }
          await supabase.from('matches').update(updateData).eq('id', quarterfinalMatches[targetQFIndex].id);
        } else {
          const updateData: any = {};
          if (isFirstInPair) {
            updateData.team1_id = winnerIds.team;
          } else {
            updateData.team2_id = winnerIds.team;
          }
          await supabase.from('matches').update(updateData).eq('id', quarterfinalMatches[targetQFIndex].id);
        }
      }
    } else {
      const allRo16Done = ro16Matches.every(m => m.status === 'completed');
      if (!allRo16Done) {
        return;
      }


      if (isIndividual) {
        const ro16Results: Array<{ winners: { p1: string; p2: string }; winnerGameDiff: number }> = [];

        for (const m of ro16Matches) {
          const t1g = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
          const t2g = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);
          const t1Won = t1g > t2g;

          if (t1Won) {
            ro16Results.push({ winners: { p1: m.player1_individual_id, p2: m.player2_individual_id }, winnerGameDiff: t1g - t2g });
          } else {
            ro16Results.push({ winners: { p1: m.player3_individual_id, p2: m.player4_individual_id }, winnerGameDiff: t2g - t1g });
          }
        }

        const sortedWinners = [...ro16Results].sort((a, b) => b.winnerGameDiff - a.winnerGameDiff);
        const pairs = sortedWinners.map(r => r.winners);

        for (let i = 0; i < quarterfinalMatches.length && i * 2 + 1 < pairs.length; i++) {
          const pair1 = pairs[i * 2];
          const pair2 = pairs[i * 2 + 1];
          await supabase.from('matches').update({
            player1_individual_id: pair1.p1,
            player2_individual_id: pair1.p2,
            player3_individual_id: pair2.p1,
            player4_individual_id: pair2.p2,
          }).eq('id', quarterfinalMatches[i].id);
        }
      }
    }
  }

  if (semifinalRounds.includes(round)) {
    const semifinalMatches = allMatches
      .filter(m => semifinalRounds.includes(m.round))
      .sort((a, b) => a.match_number - b.match_number);

    const completedSemifinals = semifinalMatches.filter(m => m.status === 'completed');

    const matchIndex = semifinalMatches.findIndex(m => m.id === completedMatchId);

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
        } else {
          const updateData: any = {};
          if (isFirstInPair) {
            updateData.team1_id = winnerIds.team;
          } else {
            updateData.team2_id = winnerIds.team;
          }
          await supabase.from('matches').update(updateData).eq('id', semifinalMatches[targetSemifinalIndex].id);
        }
      }

      // Send QF losers to consolation match
      const consolationMatch = allMatches.find(m => m.round === 'consolation');
      if (consolationMatch) {
        if (isIndividual) {
          const updateData: any = {};
          if (isFirstInPair) {
            updateData.player1_individual_id = loserIds.p1;
            updateData.player2_individual_id = loserIds.p2;
          } else {
            updateData.player3_individual_id = loserIds.p1;
            updateData.player4_individual_id = loserIds.p2;
          }
          await supabase.from('matches').update(updateData).eq('id', consolationMatch.id);
        } else {
          const updateData: any = {};
          if (isFirstInPair) {
            updateData.team1_id = loserIds.team;
          } else {
            updateData.team2_id = loserIds.team;
          }
          await supabase.from('matches').update(updateData).eq('id', consolationMatch.id);
        }
      }
    } else {
      // Non-standard bracket (e.g. 3 QFs → 2 SFs): batch advancement
      // Wait until ALL QFs are complete before advancing
      const allQFsDone = quarterfinalMatches.every(m => m.status === 'completed');
      if (!allQFsDone) {
        return;
      }


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
        }

        // Populate consolation match with QF losers
        {
          const consolationMatch = allMatches.find(m => m.round === 'consolation');
          if (consolationMatch && consolationPairs.length >= 2) {
            await supabase.from('matches').update({
              player1_individual_id: consolationPairs[0].p1,
              player2_individual_id: consolationPairs[0].p2,
              player3_individual_id: consolationPairs[1].p1,
              player4_individual_id: consolationPairs[1].p2,
            }).eq('id', consolationMatch.id);
          } else if (consolationMatch && consolationPairs.length === 1) {
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
  }

}

export type TeamQualificationConfig = {
  qualifiedPerGroup: number;
  extraBestNeeded: number;
  totalQualified: number;
  knockoutStage: string;
  extraFromPosition: number;
  entryRoundMatchCount: number;
};

/** Quantas equipas passam por grupo consoante a fase eliminatória (formato equipas). */
export function calculateTeamQualificationConfig(
  numberOfGroups: number,
  knockoutStage: string,
  qualifiedPerGroupOverride?: number | null
): TeamQualificationConfig {
  const teamKnockoutSizes: Record<string, number> = {
    none: 0,
    final: 2,
    semifinals: 4,
    quarterfinals: 8,
    round_of_16: 16,
  };

  const safeGroups = Math.max(1, numberOfGroups);
  const stageQualified = teamKnockoutSizes[knockoutStage] ?? 4;
  const qualifiedPerGroup =
    qualifiedPerGroupOverride != null && qualifiedPerGroupOverride > 0
      ? qualifiedPerGroupOverride
      : Math.max(1, Math.floor(stageQualified / safeGroups));
  const totalQualified =
    qualifiedPerGroupOverride != null && qualifiedPerGroupOverride > 0
      ? safeGroups * qualifiedPerGroup
      : stageQualified;
  const extraBestNeeded = Math.max(0, totalQualified - qualifiedPerGroup * safeGroups);

  return {
    qualifiedPerGroup,
    extraBestNeeded,
    totalQualified,
    knockoutStage,
    extraFromPosition: qualifiedPerGroup + 1,
    entryRoundMatchCount: Math.max(1, Math.floor(totalQualified / 2)),
  };
}

/**
 * Emparelha equipas de 2 grupos para eliminatórias, colocando os vencedores
 * de cada grupo em lados opostos do quadro (só se encontram na final se
 * ganharem todos os jogos).
 *
 * Ex. quartos com 2 grupos de 4:
 *   J1: 1°A vs 4°B | J2: 3°A vs 2°B | J3: 2°A vs 3°B | J4: 4°A vs 1°B
 *
 * A ordem J1/J2 e J3/J4 mantém o 1° e o 2° de cada grupo em metades
 * opostas do quadro, considerando que J1+J2 e J3+J4 alimentam as meias.
 */
export function buildTwoGroupKnockoutPairs<T extends { id: string }>(
  rankA: T[],
  rankB: T[],
  numMatches: number
): Array<[T, T]> {
  const pairs: Array<[T, T]> = [];
  let seedOrder = [0];

  while (seedOrder.length < numMatches) {
    const offset = seedOrder.length;
    seedOrder = seedOrder.flatMap(seed => [seed, seed + offset]);
  }

  for (const rankIndex of seedOrder.slice(0, numMatches)) {
    const a = rankA[rankIndex];
    const b = rankB[numMatches - 1 - rankIndex];
    if (a && b) pairs.push([a, b]);
  }

  return pairs;
}

/**
 * Popula matches de knockout (semi_final, quarter_final, round_of_16) com TEAMS
 * a partir do ranking dos grupos. Funciona por categoria.
 *
 * Cenários:
 *   • Sem categoria → processa todas as categorias do torneio.
 *   • Com categoria → processa apenas essa categoria.
 *
 * Só corre quando todos os jogos de grupos dessa categoria estiverem completos.
 * A primeira ronda knockout vazia é preenchida pelo ranking dos grupos.
 * Rondas seguintes (ex. meias após quartos) são preenchidas com os VENCEDORES
 * da ronda anterior — nunca de novo com o ranking dos grupos.
 */
export async function populateTeamPlacementMatches(
  tournamentId: string,
  categoryId?: string | null
): Promise<void> {

  const { data: allMatches, error: matchesError } = await supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId);

  if (matchesError || !allMatches) {
    console.error('[POPULATE_TEAM_PLACEMENT] Error fetching matches:', matchesError);
    return;
  }

  const { data: allTeams, error: teamsError } = await supabase
    .from('teams')
    .select('id, name, category_id, group_name')
    .eq('tournament_id', tournamentId);

  if (teamsError || !allTeams) {
    console.error('[POPULATE_TEAM_PLACEMENT] Error fetching teams:', teamsError);
    return;
  }

  const categoryIds = categoryId
    ? [categoryId]
    : Array.from(new Set(allTeams.map(t => t.category_id).filter(Boolean) as string[]));

  if (categoryIds.length === 0) {
    return;
  }

  for (const catId of categoryIds) {
    await populateTeamPlacementForCategory(catId, allMatches, allTeams);
  }

}

async function populateTeamPlacementForCategory(
  categoryId: string,
  allMatches: any[],
  allTeams: Array<{ id: string; name: string; category_id: string | null; group_name?: string | null }>
): Promise<void> {
  const catTeams = allTeams.filter(t => t.category_id === categoryId);
  if (catTeams.length < 2) {
    return;
  }

  const catMatches = allMatches.filter(m => m.category_id === categoryId);
  const groupMatches = catMatches.filter(m => typeof m.round === 'string' && m.round.startsWith('group_'));
  if (groupMatches.length === 0) {
    return;
  }

  const hasResult = (m: any) => {
    const t1 = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
    const t2 = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);
    return m.status === 'completed' || t1 > 0 || t2 > 0;
  };
  const allGroupsDone = groupMatches.every(hasResult);

  // Knockout / placement rounds for the category (extended to cover the full
  // bracket so reverts cascade all the way down to the final / 3rd-place).
  const ko = catMatches.filter(m =>
    m.round === 'round_of_16' ||
    m.round === 'quarter_final' ||
    m.round === 'quarterfinal' ||
    m.round === 'semi_final' ||
    m.round === 'semifinal' ||
    m.round === 'final' ||
    m.round === '3rd_place'
  );

  // If the group stage is not yet fully resolved we MUST also clear the
  // knockout slots so the bracket reflects reality (e.g. user reverted a
  // group result -> previously-qualified teams should disappear). We only
  // protect KO matches that have *real* scores entered, never just because
  // status happens to be 'completed' (that flag may be leftover state).
  const hasRealScores = (m: any) => {
    const t1 = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
    const t2 = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);
    return t1 > 0 || t2 > 0;
  };
  if (!allGroupsDone) {
    const done = groupMatches.filter(hasResult).length;
    let cleared = 0;
    for (const m of ko) {
      if (hasRealScores(m)) {
        continue;
      }
      if (!m.team1_id && !m.team2_id) continue;
      const { error: updErr } = await supabase
        .from('matches')
        .update({ team1_id: null, team2_id: null, winner_id: null, status: 'scheduled' })
        .eq('id', m.id);
      if (updErr) {
        console.error(`[POPULATE_TEAM_PLACEMENT] Error clearing ${m.round} #${m.match_number}:`, updErr);
      } else {
        cleared++;
      }
    }
    return;
  }

  if (ko.length === 0) {
    return;
  }

  type Stats = { id: string; name: string; group: string; wins: number; gd: number; gf: number };
  const stats = new Map<string, Stats>();
  const teamGroupMap = new Map<string, string>();
  catTeams.forEach(t => {
    stats.set(t.id, { id: t.id, name: t.name, group: '', wins: 0, gd: 0, gf: 0 });
    if ((t as any).group_name) teamGroupMap.set(t.id, (t as any).group_name);
  });

  groupMatches.forEach(m => {
    const t1g = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
    const t2g = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);
    const t1Won = t1g > t2g;
    const t2Won = t2g > t1g;

    let groupName = typeof m.round === 'string' && m.round !== 'group_stage'
      ? m.round.replace('group_', '')
      : '';
    if (!groupName && m.team1_id && teamGroupMap.has(m.team1_id)) {
      groupName = teamGroupMap.get(m.team1_id)!;
    } else if (!groupName && m.team2_id && teamGroupMap.has(m.team2_id)) {
      groupName = teamGroupMap.get(m.team2_id)!;
    }

    const s1 = m.team1_id ? stats.get(m.team1_id) : undefined;
    const s2 = m.team2_id ? stats.get(m.team2_id) : undefined;
    if (s1) {
      if (!s1.group) s1.group = groupName;
      s1.gf += t1g;
      s1.gd += t1g - t2g;
      if (t1Won) s1.wins++;
    }
    if (s2) {
      if (!s2.group) s2.group = groupName;
      s2.gf += t2g;
      s2.gd += t2g - t1g;
      // Empate (t1g === t2g): nenhuma equipa recebe vitória.
      if (t2Won) s2.wins++;
    }
  });

  const teamsByGroup = new Map<string, Stats[]>();
  Array.from(stats.values()).forEach(s => {
    const g = s.group || 'A';
    if (!teamsByGroup.has(g)) teamsByGroup.set(g, []);
    teamsByGroup.get(g)!.push(s);
  });

  const sortedGroupNames = Array.from(teamsByGroup.keys()).sort();
  const rankedByGroup = new Map<string, Stats[]>();
  sortedGroupNames.forEach(g => {
    const arr = (teamsByGroup.get(g) || []).slice().sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      if (a.gd !== b.gd) return b.gd - a.gd;
      return b.gf - a.gf;
    });
    rankedByGroup.set(g, arr);
  });

  const { data: categoryRow } = await supabase
    .from('tournament_categories')
    .select('qualified_per_group, knockout_stage, number_of_groups, format')
    .eq('id', categoryId)
    .maybeSingle();

  const configuredGroupCount =
    categoryRow?.number_of_groups && categoryRow.number_of_groups > 0
      ? categoryRow.number_of_groups
      : sortedGroupNames.length;

  const qualConfig = calculateTeamQualificationConfig(
    configuredGroupCount,
    categoryRow?.knockout_stage || 'semifinals',
    categoryRow?.qualified_per_group
  );


  const qualifiedByGroup = new Map<string, Stats[]>();
  sortedGroupNames.forEach(g => {
    qualifiedByGroup.set(g, (rankedByGroup.get(g) || []).slice(0, qualConfig.qualifiedPerGroup));
  });

  const extraQualified: Stats[] = [];
  if (qualConfig.extraBestNeeded > 0) {
    const extraCandidates: Stats[] = [];
    sortedGroupNames.forEach(g => {
      const full = rankedByGroup.get(g) || [];
      if (full.length > qualConfig.qualifiedPerGroup) {
        extraCandidates.push(full[qualConfig.qualifiedPerGroup]);
      }
    });
    extraCandidates.sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      if (a.gd !== b.gd) return b.gd - a.gd;
      return b.gf - a.gf;
    });
    extraQualified.push(...extraCandidates.slice(0, qualConfig.extraBestNeeded));
    if (extraQualified.length > 0) {
    }
  }

  const overallQualified: Stats[] = [];
  const maxQualLen = Math.max(...Array.from(qualifiedByGroup.values()).map(a => a.length), 0);
  for (let pos = 0; pos < maxQualLen; pos++) {
    for (const g of sortedGroupNames) {
      const arr = qualifiedByGroup.get(g)!;
      if (pos < arr.length) overallQualified.push(arr[pos]);
    }
  }
  overallQualified.push(...extraQualified);

  const semis = ko.filter(m => m.round === 'semi_final' || m.round === 'semifinal').sort((a, b) => a.match_number - b.match_number);
  const qfs = ko.filter(m => m.round === 'quarter_final' || m.round === 'quarterfinal').sort((a, b) => a.match_number - b.match_number);
  const ro16 = ko.filter(m => m.round === 'round_of_16').sort((a, b) => a.match_number - b.match_number);
  const finals = ko.filter(m => m.round === 'final').sort((a, b) => a.match_number - b.match_number);

  const buildCrossPairs = (teams: Stats[], n: number): Array<[Stats, Stats]> => {
    const pool = teams.slice(0, n);
    const pairs: Array<[Stats, Stats]> = [];
    for (let i = 0; i < pool.length / 2; i++) {
      const top = pool[i];
      const bot = pool[pool.length - 1 - i];
      if (top && bot && top.id !== bot.id) pairs.push([top, bot]);
    }
    return pairs;
  };

  const buildKnockoutPairs = (numMatches: number): Array<[Stats, Stats]> => {
    if (sortedGroupNames.length === 2) {
      const rankA = qualifiedByGroup.get(sortedGroupNames[0])!;
      const rankB = qualifiedByGroup.get(sortedGroupNames[1])!;
      return buildTwoGroupKnockoutPairs(rankA, rankB, numMatches);
    }
    const need = numMatches * 2;
    return buildCrossPairs(overallQualified, Math.min(need, overallQualified.length));
  };

  const clearUnplayedKnockoutSlots = async (matches: typeof ko, label: string) => {
    for (const m of matches) {
      if (hasRealScores(m)) continue;
      if (!m.team1_id && !m.team2_id) continue;
      await supabase
        .from('matches')
        .update({ team1_id: null, team2_id: null, winner_id: null, status: 'scheduled' })
        .eq('id', m.id);
    }
  };

  const applyKnockoutPairs = async (matches: typeof ko, pairs: Array<[Stats, Stats]>, label: string) => {
    for (let i = 0; i < matches.length && i < pairs.length; i++) {
      const m = matches[i];
      // Reescrever slots sem resultado (corrige quadro antigo ou ordem errada).
      if (hasRealScores(m)) continue;
      const [a, b] = pairs[i];
      if (!a || !b) continue;
      if (m.team1_id === a.id && m.team2_id === b.id) continue;
      await supabase.from('matches').update({ team1_id: a.id, team2_id: b.id }).eq('id', m.id);
    }
  };

  const matchWinnerTeamId = (m: any): string | null => {
    if (m.winner_id && (m.winner_id === m.team1_id || m.winner_id === m.team2_id)) {
      return m.winner_id;
    }
    const t1g = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
    const t2g = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);
    if (t1g === t2g) return null;
    return t1g > t2g ? m.team1_id : m.team2_id;
  };

  // QF1/QF2 winners → SF1, QF3/QF4 winners → SF2 (same pairing as advanceKnockoutWinner).
  // Overwrites stale group-seed teams on unplayed next-round matches so upsets stick.
  const advanceWinnersToNextRound = async (
    fromMatches: typeof ko,
    toMatches: typeof ko,
    label: string
  ) => {
    if (toMatches.length === 0) return;
    for (let i = 0; i < fromMatches.length; i++) {
      const src = fromMatches[i];
      if (!hasRealScores(src)) continue;
      const winnerId = matchWinnerTeamId(src);
      if (!winnerId) continue;
      const target = toMatches[Math.floor(i / 2)];
      if (!target || hasRealScores(target)) continue;
      const field = i % 2 === 0 ? 'team1_id' : 'team2_id';
      if (target[field] === winnerId) continue;
      await supabase.from('matches').update({ [field]: winnerId }).eq('id', target.id);
      (target as any)[field] = winnerId;
    }
  };

  // The entry round must be derived from config (groups + qualified/group),
  // never inferred by "how many matches currently exist", otherwise seeding can
  // drift (e.g. A1 vs B3 when only 3 QFs were found).
  const entryCount = qualConfig.entryRoundMatchCount;
  const minQualifiedTeams = Math.max(2, entryCount * 2);

  if (overallQualified.length < minQualifiedTeams) {
    return;
  }

  type EntryRound = { matches: typeof ko; label: string; nextRound: typeof ko; staleRounds: Array<{ matches: typeof ko; label: string }> };
  const resolveEntryRound = (): EntryRound | null => {
    const isGroupsKnockoutCategory =
      categoryRow?.format === 'groups_knockout' || categoryRow?.format == null;
    if (!isGroupsKnockoutCategory) return null;

    if (entryCount >= 8) {
      if (ro16.length !== entryCount) return null;
      return {
        matches: ro16,
        label: 'RO16',
        nextRound: qfs,
        staleRounds: [
          { matches: qfs.slice(Math.ceil(entryCount / 2)), label: 'QF-extra' },
          { matches: semis.slice(Math.ceil(entryCount / 4)), label: 'SF-extra' },
        ],
      };
    }
    if (entryCount === 4) {
      if (qfs.length !== entryCount) return null;
      return {
        matches: qfs,
        label: 'QF',
        nextRound: semis,
        staleRounds: [{ matches: ro16, label: 'RO16' }],
      };
    }
    if (entryCount === 2) {
      if (semis.length !== entryCount) return null;
      return {
        matches: semis,
        label: 'SF',
        nextRound: finals,
        staleRounds: [{ matches: qfs, label: 'QF' }, { matches: ro16, label: 'RO16' }],
      };
    }
    if (entryCount === 1) {
      if (finals.length !== entryCount) return null;
      return {
        matches: finals,
        label: 'F',
        nextRound: [],
        staleRounds: [{ matches: semis, label: 'SF' }, { matches: qfs, label: 'QF' }, { matches: ro16, label: 'RO16' }],
      };
    }
    return null;
  };

  const entry = resolveEntryRound();
  if (!entry) {
    return;
  }

  for (const stale of entry.staleRounds) {
    await clearUnplayedKnockoutSlots(stale.matches, stale.label);
  }

  if (entry.matches.some(m => !hasRealScores(m))) {
    const pairs = buildKnockoutPairs(entry.matches.length);
    await applyKnockoutPairs(entry.matches, pairs, entry.label);
  }

  if (entry.nextRound.length > 0) {
    await advanceWinnersToNextRound(entry.matches, entry.nextRound, `${entry.label}→next`);
  }

  // Perdedores das meias → 3º/4º lugar (reforço caso o MatchModal falhe / race)
  const thirdPlaces = ko
    .filter(m => m.round === '3rd_place')
    .sort((a, b) => a.match_number - b.match_number);
  if (semis.length >= 2 && thirdPlaces.length > 0) {
    const third = thirdPlaces[0];
    if (!hasRealScores(third)) {
      for (let i = 0; i < Math.min(2, semis.length); i++) {
        const src = semis[i];
        if (!hasRealScores(src)) continue;
        const winnerId = matchWinnerTeamId(src);
        if (!winnerId) continue;
        const loserId = winnerId === src.team1_id ? src.team2_id : src.team1_id;
        if (!loserId) continue;
        const field = i === 0 ? 'team1_id' : 'team2_id';
        if (third[field] === loserId) continue;
        await supabase.from('matches').update({ [field]: loserId }).eq('id', third.id);
        (third as any)[field] = loserId;
      }
    }
  }
}

