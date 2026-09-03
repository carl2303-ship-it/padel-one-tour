import { generateAmericanSchedule, type Player as AmericanPlayer, type ExistingMatch } from './americanScheduler';

export interface IndividualPlayer {
  id: string;
  name: string;
  group_name?: string;
}

export interface IndividualMatch {
  round: string;
  match_number: number;
  player1_id: string;
  player2_id: string;
  player3_id?: string | null;
  player4_id?: string | null;
  scheduled_time: string;
  court: string;
}

function shuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function generateAmericanMatchesForGroup(
  players: IndividualPlayer[],
  groupName: string,
  completedGroupMatches: ExistingMatch[] = []
): Array<{ player1_id: string; player2_id: string; player3_id: string; player4_id: string }> {
  const n = players.length;
  if (n < 4) {
    console.warn(`Group ${groupName} has fewer than 4 players, skipping matches`);
    return [];
  }

  // Americano Padel: each player plays n-1 matches (one per round, different partner each round)
  const matchesPerPlayer = n - 1;

  // If all matches already completed, nothing to generate
  const playerIds = new Set(players.map(p => p.id));
  const relevantCompleted = completedGroupMatches.filter(m =>
    playerIds.has(m.player1_id) && playerIds.has(m.player2_id) &&
    playerIds.has(m.player3_id) && playerIds.has(m.player4_id)
  );
  const maxCompleted = Math.max(0, ...players.map(p => relevantCompleted.filter(m =>
    m.player1_id === p.id || m.player2_id === p.id || m.player3_id === p.id || m.player4_id === p.id
  ).length));
  if (maxCompleted >= matchesPerPlayer) {
    return [];
  }

  const americanPlayers: AmericanPlayer[] = players.map(p => ({ id: p.id, name: p.name || 'Player' }));
  const americanMatches = generateAmericanSchedule(
    americanPlayers,
    Math.max(1, Math.floor(n / 4)),
    '2000-01-01',
    '00:00',
    '23:59',
    30,
    matchesPerPlayer,
    new Set(),
    relevantCompleted
  );

  const result = americanMatches.map(m => ({
    player1_id: m.player1_id,
    player2_id: m.player2_id,
    player3_id: m.player3_id,
    player4_id: m.player4_id,
  }));


  return result;
}

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours, minutes };
}

export function generateIndividualGroupsKnockoutSchedule(
  players: IndividualPlayer[],
  numberOfGroups: number,
  numberOfCourts: number,
  startDate: string,
  startTime: string = '09:00',
  endTime: string = '21:00',
  matchDurationMinutes: number = 90,
  qualifiedPerGroup: number = 2,
  knockoutStage: 'semifinals' | 'quarterfinals' | 'round_of_16' | 'final' = 'semifinals',
  completedMatches: ExistingMatch[] = []
): IndividualMatch[] {

  if (players.length < 4) {
    console.error('[INDIVIDUAL_GROUPS_KNOCKOUT] Need at least 4 players');
    return [];
  }

  const matches: IndividualMatch[] = [];
  const groupNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

  const groups: Map<string, IndividualPlayer[]> = new Map();

  const hasExistingGroups = players.some(p => p.group_name);

  if (hasExistingGroups) {
    players.forEach(player => {
      if (player.group_name) {
        if (!groups.has(player.group_name)) {
          groups.set(player.group_name, []);
        }
        groups.get(player.group_name)!.push(player);
      }
    });

    groups.forEach((groupPlayers, groupName) => {
    });
  } else {
    const playersPerGroup = Math.ceil(players.length / numberOfGroups);
    const shuffledPlayers = shuffle([...players]);

    for (let i = 0; i < numberOfGroups; i++) {
      const groupName = groupNames[i] || `Group ${i + 1}`;
      const groupPlayers = shuffledPlayers.slice(i * playersPerGroup, (i + 1) * playersPerGroup);

      groupPlayers.forEach(p => {
        p.group_name = groupName;
      });

      groups.set(groupName, groupPlayers);
    }
  }

  let matchNumber = 1;
  let currentDate = new Date(startDate);
  const { hours: startHours, minutes: startMinutes } = parseTime(startTime);
  const { hours: endHours, minutes: endMinutes } = parseTime(endTime);

  let currentTime = new Date(currentDate);
  currentTime.setHours(startHours, startMinutes, 0, 0);

  let endOfDay = new Date(currentDate);
  endOfDay.setHours(endHours, endMinutes, 0, 0);

  const matchesByGroup: Map<string, Array<{
    group: string;
    player1_id: string;
    player2_id: string;
    player3_id: string;
    player4_id: string;
  }>> = new Map();

  const sortedGroupNames = Array.from(groups.keys()).sort();

  sortedGroupNames.forEach((groupName) => {
    const groupPlayers = groups.get(groupName)!;
    const americanMatches = generateAmericanMatchesForGroup(groupPlayers, groupName, completedMatches);
    matchesByGroup.set(groupName, americanMatches.map(match => ({
      group: groupName,
      ...match,
    })));
  });

  const groupMatchIndices = new Map<string, number>();
  sortedGroupNames.forEach(g => groupMatchIndices.set(g, 0));

  const getTotalRemainingMatches = () => {
    let total = 0;
    sortedGroupNames.forEach(g => {
      const matches = matchesByGroup.get(g) || [];
      const idx = groupMatchIndices.get(g) || 0;
      total += matches.length - idx;
    });
    return total;
  };

  const timeSlots: Array<Array<{
    group: string;
    player1_id: string;
    player2_id: string;
    player3_id: string;
    player4_id: string;
  }>> = [];

  const numGroups = sortedGroupNames.length;
  let slotNumber = 0;


  const lastPlayedSlot = new Map<string, number>();
  sortedGroupNames.forEach(g => lastPlayedSlot.set(g, -999));

  // Cada slot deve colocar pelo menos 1 jogo quando há grupos por jogar
  // (jogadores de grupos diferentes nunca colidem). Este limite é só uma
  // rede de segurança contra dados corrompidos/edge cases que impeçam
  // progresso, para nunca bloquear o browser num loop sem fim.
  const totalMatchesToSchedule = getTotalRemainingMatches();
  const maxSlotsSafety = totalMatchesToSchedule + numGroups + 10;

  while (getTotalRemainingMatches() > 0 && slotNumber < maxSlotsSafety) {
    const slot: Array<{
      group: string;
      player1_id: string;
      player2_id: string;
      player3_id: string;
      player4_id: string;
    }> = [];

    const groupsWithMatches = sortedGroupNames.filter(g => {
      const matches = matchesByGroup.get(g) || [];
      const idx = groupMatchIndices.get(g) || 0;
      return idx < matches.length;
    });

    if (groupsWithMatches.length === 0) break;

    const orderedGroups = [...groupsWithMatches].sort((a, b) => {
      const lastA = lastPlayedSlot.get(a) || -999;
      const lastB = lastPlayedSlot.get(b) || -999;
      return lastA - lastB;
    });


    // Use player-based conflict checking instead of group-based constraint.
    // This allows multiple matches from the same group in one slot when players don't overlap
    // (e.g. 8 players = 2 simultaneous matches per round).
    const playersInSlot = new Set<string>();
    let added = true;
    while (slot.length < numberOfCourts && added) {
      added = false;
      for (const g of orderedGroups) {
        if (slot.length >= numberOfCourts) break;
        const gMatches = matchesByGroup.get(g) || [];
        const idx = groupMatchIndices.get(g) || 0;
        if (idx >= gMatches.length) continue;

        const match = gMatches[idx];
        const matchPlayers = [match.player1_id, match.player2_id, match.player3_id, match.player4_id];
        if (matchPlayers.some(p => playersInSlot.has(p))) continue;

        matchPlayers.forEach(p => playersInSlot.add(p));
        slot.push(match);
        groupMatchIndices.set(g, idx + 1);
        lastPlayedSlot.set(g, slotNumber);
        added = true;
      }
    }

    if (slot.length > 0) {
      timeSlots.push(slot);
    }
    slotNumber++;
  }

  if (getTotalRemainingMatches() > 0) {
    console.error(`[INDIVIDUAL_GROUPS_KNOCKOUT] Safety limit reached with ${getTotalRemainingMatches()} matches unscheduled — check for data inconsistency (duplicate players across groups).`);
  }

  let totalGroupMatches = 0;
  timeSlots.forEach(slot => {
    totalGroupMatches += slot.length;
  });


  for (let slotIdx = 0; slotIdx < timeSlots.length; slotIdx++) {
    const slot = timeSlots[slotIdx];
    const slotTime = currentTime.toISOString();


    for (let courtIdx = 0; courtIdx < slot.length; courtIdx++) {
      const groupMatch = slot[courtIdx];
      const courtNumber = ((courtIdx + slotIdx) % numberOfCourts) + 1;

      matches.push({
        round: `group_${groupMatch.group}`,
        match_number: matchNumber,
        player1_id: groupMatch.player1_id,
        player2_id: groupMatch.player2_id,
        player3_id: groupMatch.player3_id,
        player4_id: groupMatch.player4_id,
        scheduled_time: slotTime,
        court: courtNumber.toString(),
      });

      matchNumber++;
    }

    currentTime = new Date(currentTime.getTime() + matchDurationMinutes * 60000);

    if (currentTime >= endOfDay) {
      const nextDay = new Date(currentDate);
      nextDay.setDate(nextDay.getDate() + 1);
      currentDate = nextDay;
      currentTime = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), startHours, startMinutes, 0, 0);
      endOfDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), endHours, endMinutes, 0, 0);
    }
  }

  const totalQualified = numberOfGroups * qualifiedPerGroup;

  // Note: Knockout matches (quarterfinals, semifinals, final) are created separately
  // in TournamentDetail.tsx after group stage is completed.
  // This scheduler only creates group stage matches.

  return matches;
}
