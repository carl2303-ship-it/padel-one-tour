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
  groupName: string
): Array<{ player1_id: string; player2_id: string; player3_id: string; player4_id: string }> {
  console.log(`[AMERICAN GROUP ${groupName}] Generating schedule for ${players.length} players`);

  if (players.length < 4) {
    console.warn(`Group ${groupName} has fewer than 4 players, skipping matches`);
    return [];
  }

  const matches: Array<{ player1_id: string; player2_id: string; player3_id: string; player4_id: string }> = [];
  const usedPartnerships = new Set<string>();

  const getPartnershipKey = (p1: string, p2: string): string => {
    return [p1, p2].sort().join('+');
  };

  const allPairs: Array<{ p1: string; p2: string; key: string }> = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const key = getPartnershipKey(players[i].id, players[j].id);
      allPairs.push({ p1: players[i].id, p2: players[j].id, key });
    }
  }

  const shuffledPairs = [...allPairs].sort(() => Math.random() - 0.5);
  console.log(`[AMERICAN GROUP ${groupName}] Total pairs: ${shuffledPairs.length}`);

  const maxMatches = Math.floor(allPairs.length / 2);
  console.log(`[AMERICAN GROUP ${groupName}] Max matches: ${maxMatches}`);

  const playerMatchCount = new Map<string, number>();
  players.forEach(p => playerMatchCount.set(p.id, 0));

  for (let i = 0; i < shuffledPairs.length && matches.length < maxMatches; i++) {
    const pair1 = shuffledPairs[i];
    if (usedPartnerships.has(pair1.key)) continue;

    let bestPair2: typeof pair1 | null = null;
    let bestScore = -Infinity;

    for (let j = i + 1; j < shuffledPairs.length; j++) {
      const pair2 = shuffledPairs[j];
      if (usedPartnerships.has(pair2.key)) continue;

      const allFour = new Set([pair1.p1, pair1.p2, pair2.p1, pair2.p2]);
      if (allFour.size !== 4) continue;

      const counts = [
        playerMatchCount.get(pair1.p1) || 0,
        playerMatchCount.get(pair1.p2) || 0,
        playerMatchCount.get(pair2.p1) || 0,
        playerMatchCount.get(pair2.p2) || 0,
      ];
      const score = -Math.max(...counts);

      if (score > bestScore) {
        bestScore = score;
        bestPair2 = pair2;
      }
    }

    if (bestPair2) {
      usedPartnerships.add(pair1.key);
      usedPartnerships.add(bestPair2.key);

      playerMatchCount.set(pair1.p1, (playerMatchCount.get(pair1.p1) || 0) + 1);
      playerMatchCount.set(pair1.p2, (playerMatchCount.get(pair1.p2) || 0) + 1);
      playerMatchCount.set(bestPair2.p1, (playerMatchCount.get(bestPair2.p1) || 0) + 1);
      playerMatchCount.set(bestPair2.p2, (playerMatchCount.get(bestPair2.p2) || 0) + 1);

      matches.push({
        player1_id: pair1.p1,
        player2_id: pair1.p2,
        player3_id: bestPair2.p1,
        player4_id: bestPair2.p2,
      });
    }
  }

  console.log(`[AMERICAN GROUP ${groupName}] Generated ${matches.length} matches`);
  playerMatchCount.forEach((count, playerId) => {
    const player = players.find(p => p.id === playerId);
    console.log(`  ${player?.name}: ${count} matches`);
  });

  const orderedMatches = orderMatchesForPlayerRest(matches);
  console.log(`[AMERICAN GROUP ${groupName}] Reordered matches for player rest`);

  return orderedMatches;
}

function orderMatchesForPlayerRest(
  matches: Array<{ player1_id: string; player2_id: string; player3_id: string; player4_id: string }>
): Array<{ player1_id: string; player2_id: string; player3_id: string; player4_id: string }> {
  if (matches.length <= 1) return matches;

  const result: typeof matches = [];
  const remaining = [...matches];
  const lastPlayedIndex = new Map<string, number>();

  while (remaining.length > 0) {
    let bestMatchIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const match = remaining[i];
      const players = [match.player1_id, match.player2_id, match.player3_id, match.player4_id];

      let minGap = Infinity;
      for (const playerId of players) {
        const lastIdx = lastPlayedIndex.get(playerId);
        if (lastIdx !== undefined) {
          const gap = result.length - lastIdx;
          minGap = Math.min(minGap, gap);
        }
      }

      const score = minGap === Infinity ? 1000 : minGap;

      if (score > bestScore) {
        bestScore = score;
        bestMatchIdx = i;
      }
    }

    const selectedMatch = remaining.splice(bestMatchIdx, 1)[0];
    const players = [selectedMatch.player1_id, selectedMatch.player2_id, selectedMatch.player3_id, selectedMatch.player4_id];
    for (const playerId of players) {
      lastPlayedIndex.set(playerId, result.length);
    }
    result.push(selectedMatch);
  }

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
  knockoutStage: 'semifinals' | 'quarterfinals' = 'semifinals'
): IndividualMatch[] {
  console.log('=== NEW ROTATION CODE v2 ===', new Date().toISOString());
  console.log('[INDIVIDUAL_GROUPS_KNOCKOUT] Starting schedule generation');
  console.log('[INDIVIDUAL_GROUPS_KNOCKOUT] Players:', players.length, 'Groups:', numberOfGroups);

  if (players.length < 4) {
    console.error('[INDIVIDUAL_GROUPS_KNOCKOUT] Need at least 4 players');
    return [];
  }

  const matches: IndividualMatch[] = [];
  const groupNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

  const groups: Map<string, IndividualPlayer[]> = new Map();

  const hasExistingGroups = players.some(p => p.group_name);

  if (hasExistingGroups) {
    console.log('[INDIVIDUAL_GROUPS_KNOCKOUT] Using existing group assignments');
    players.forEach(player => {
      if (player.group_name) {
        if (!groups.has(player.group_name)) {
          groups.set(player.group_name, []);
        }
        groups.get(player.group_name)!.push(player);
      }
    });

    groups.forEach((groupPlayers, groupName) => {
      console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT] Group ${groupName}: ${groupPlayers.length} players`);
    });
  } else {
    console.log('[INDIVIDUAL_GROUPS_KNOCKOUT] Creating new random group assignments');
    const playersPerGroup = Math.ceil(players.length / numberOfGroups);
    const shuffledPlayers = shuffle([...players]);

    for (let i = 0; i < numberOfGroups; i++) {
      const groupName = groupNames[i] || `Group ${i + 1}`;
      const groupPlayers = shuffledPlayers.slice(i * playersPerGroup, (i + 1) * playersPerGroup);

      groupPlayers.forEach(p => {
        p.group_name = groupName;
      });

      groups.set(groupName, groupPlayers);
      console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT] Group ${groupName}: ${groupPlayers.length} players`);
    }
  }

  let matchNumber = 1;
  let currentDate = new Date(startDate);
  const { hours: startHours, minutes: startMinutes } = parseTime(startTime);
  const { hours: endHours, minutes: endMinutes } = parseTime(endTime);

  let currentTime = new Date(currentDate);
  currentTime.setHours(startHours, startMinutes, 0, 0);

  const endOfDay = new Date(currentDate);
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
    const americanMatches = generateAmericanMatchesForGroup(groupPlayers, groupName);
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

  console.log(`[SCHEDULING] ${numGroups} groups, ${numberOfCourts} courts per slot`);

  const lastPlayedSlot = new Map<string, number>();
  sortedGroupNames.forEach(g => lastPlayedSlot.set(g, -999));

  while (getTotalRemainingMatches() > 0) {
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

    const groupsToPlay = [...groupsWithMatches].sort((a, b) => {
      const lastA = lastPlayedSlot.get(a) || -999;
      const lastB = lastPlayedSlot.get(b) || -999;
      return lastA - lastB;
    });

    console.log(`[SLOT ${slotNumber}] Groups with matches sorted by rest: ${groupsToPlay.join(',')}`);

    const groupsUsedInSlot = new Set<string>();

    for (let court = 0; court < numberOfCourts && groupsToPlay.length > 0; court++) {
      let selectedGroup: string | null = null;

      for (const g of groupsToPlay) {
        if (!groupsUsedInSlot.has(g)) {
          const matches = matchesByGroup.get(g) || [];
          const idx = groupMatchIndices.get(g) || 0;
          if (idx < matches.length) {
            selectedGroup = g;
            break;
          }
        }
      }

      if (selectedGroup) {
        const matches = matchesByGroup.get(selectedGroup) || [];
        const idx = groupMatchIndices.get(selectedGroup) || 0;

        if (idx < matches.length) {
          slot.push(matches[idx]);
          groupMatchIndices.set(selectedGroup, idx + 1);
          groupsUsedInSlot.add(selectedGroup);
          lastPlayedSlot.set(selectedGroup, slotNumber);
          console.log(`  Court ${court + 1}: Group ${selectedGroup}`);
        }
      }
    }

    if (slot.length > 0) {
      timeSlots.push(slot);
    }
    slotNumber++;
  }

  let totalGroupMatches = 0;
  timeSlots.forEach(slot => {
    totalGroupMatches += slot.length;
  });

  console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT] Total group stage matches: ${totalGroupMatches}`);
  console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT] Time slots: ${timeSlots.length}`);
  console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT] Groups balanced across ${sortedGroupNames.length} groups`);

  for (let slotIdx = 0; slotIdx < timeSlots.length; slotIdx++) {
    const slot = timeSlots[slotIdx];
    const slotTime = currentTime.toISOString();

    console.log(`[SLOT ${slotIdx}] Time: ${slotTime}, Matches: ${slot.map(m => m.group).join(', ')}`);

    for (let courtIdx = 0; courtIdx < slot.length; courtIdx++) {
      const groupMatch = slot[courtIdx];
      const courtNumber = courtIdx + 1;

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
      currentDate.setDate(currentDate.getDate() + 1);
      currentTime = new Date(currentDate);
      currentTime.setHours(startHours, startMinutes, 0, 0);
      endOfDay.setDate(currentDate.getDate());
      endOfDay.setHours(endHours, endMinutes, 0, 0);
    }
  }

  const totalQualified = numberOfGroups * qualifiedPerGroup;
  console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT] Total qualified players: ${totalQualified} (${qualifiedPerGroup} per group)`);

  const maxPlayersPerGroup = Math.max(...Array.from(groups.values()).map(g => g.length));
  console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT] Max players per group: ${maxPlayersPerGroup}`);

  if (knockoutStage === 'semifinals' && numberOfGroups >= 2) {
    currentTime = new Date(currentTime.getTime() + matchDurationMinutes * 60000);
    if (currentTime >= endOfDay) {
      currentDate.setDate(currentDate.getDate() + 1);
      currentTime = new Date(currentDate);
      currentTime.setHours(startHours, startMinutes, 0, 0);
      endOfDay.setDate(currentDate.getDate());
      endOfDay.setHours(endHours, endMinutes, 0, 0);
    }

    const createPlacementTier = (
      tierPosition: number,
      tierLabel: string,
      finalLabel: string,
      thirdLabel: string
    ) => {
      const tierTime = currentTime.toISOString();

      matches.push({
        round: `${tierLabel}_semifinal`,
        match_number: matchNumber++,
        player1_id: 'TBD',
        player2_id: 'TBD',
        player3_id: 'TBD',
        player4_id: 'TBD',
        scheduled_time: tierTime,
        court: '1',
      });

      matches.push({
        round: `${tierLabel}_semifinal`,
        match_number: matchNumber++,
        player1_id: 'TBD',
        player2_id: 'TBD',
        player3_id: 'TBD',
        player4_id: 'TBD',
        scheduled_time: tierTime,
        court: '2',
      });

      currentTime = new Date(currentTime.getTime() + matchDurationMinutes * 60000);
      if (currentTime >= endOfDay) {
        currentDate.setDate(currentDate.getDate() + 1);
        currentTime = new Date(currentDate);
        currentTime.setHours(startHours, startMinutes, 0, 0);
        endOfDay.setDate(currentDate.getDate());
        endOfDay.setHours(endHours, endMinutes, 0, 0);
      }

      const finalsTime = currentTime.toISOString();

      matches.push({
        round: finalLabel,
        match_number: matchNumber++,
        player1_id: 'TBD',
        player2_id: 'TBD',
        player3_id: 'TBD',
        player4_id: 'TBD',
        scheduled_time: finalsTime,
        court: '1',
      });

      matches.push({
        round: thirdLabel,
        match_number: matchNumber++,
        player1_id: 'TBD',
        player2_id: 'TBD',
        player3_id: 'TBD',
        player4_id: 'TBD',
        scheduled_time: finalsTime,
        court: '2',
      });

      currentTime = new Date(currentTime.getTime() + matchDurationMinutes * 60000);
      if (currentTime >= endOfDay) {
        currentDate.setDate(currentDate.getDate() + 1);
        currentTime = new Date(currentDate);
        currentTime.setHours(startHours, startMinutes, 0, 0);
        endOfDay.setDate(currentDate.getDate());
        endOfDay.setHours(endHours, endMinutes, 0, 0);
      }

      console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT] Created tier ${tierPosition}: ${finalLabel}, ${thirdLabel}`);
    };

    createPlacementTier(1, '1st', 'final', '3rd_place');

    if (maxPlayersPerGroup >= 2) {
      createPlacementTier(2, '5th', '5th_place', '7th_place');
    }

    if (maxPlayersPerGroup >= 3) {
      createPlacementTier(3, '9th', '9th_place', '11th_place');
    }

    if (maxPlayersPerGroup >= 4) {
      createPlacementTier(4, '13th', '13th_place', '15th_place');
    }

    if (maxPlayersPerGroup >= 5) {
      createPlacementTier(5, '17th', '17th_place', '19th_place');
    }

    if (maxPlayersPerGroup >= 6) {
      const remainingPlayers = players.length - (numberOfGroups * 5);
      if (remainingPlayers >= 4) {
        createPlacementTier(6, '21st', '21st_place', '23rd_place');
      } else if (remainingPlayers >= 2) {
        const tierTime = currentTime.toISOString();
        matches.push({
          round: '21st_place',
          match_number: matchNumber++,
          player1_id: 'TBD',
          player2_id: 'TBD',
          player3_id: 'TBD',
          player4_id: 'TBD',
          scheduled_time: tierTime,
          court: '1',
        });
        console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT] Created single match for remaining players: 21st_place`);
      }
    }

    console.log('[INDIVIDUAL_GROUPS_KNOCKOUT] Created all placement tiers for full classification');
  }

  console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT] Total matches generated: ${matches.length}`);
  return matches;
}
