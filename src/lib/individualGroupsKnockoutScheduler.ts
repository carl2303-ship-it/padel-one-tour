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

  const n = players.length;
  if (n < 4) {
    console.warn(`Group ${groupName} has fewer than 4 players, skipping matches`);
    return [];
  }

  // Baralhar jogadores aleatoriamente para variar o schedule
  const ids = shuffle(players.map(p => p.id));
  const pKey = (a: string, b: string) => [a, b].sort().join('+');

  type RawMatch = { player1_id: string; player2_id: string; player3_id: string; player4_id: string };
  const matches: RawMatch[] = [];

  if (n === 4) {
    // 4 jogadores → 3 jogos perfeitos, cada jogador joga 3 vezes
    // Cada par é usado exactamente uma vez (C(4,2)=6 pares, 3 jogos × 2 pares = 6)
    const [a, b, c, d] = ids;
    matches.push(
      { player1_id: a, player2_id: b, player3_id: c, player4_id: d }, // ab vs cd
      { player1_id: a, player2_id: c, player3_id: b, player4_id: d }, // ac vs bd
      { player1_id: a, player2_id: d, player3_id: b, player4_id: c }, // ad vs bc
    );
  } else if (n === 5) {
    // 5 jogadores → 5 jogos perfeitos, cada jogador joga 4 vezes (fica de fora 1 vez)
    // Cada par é usado exactamente uma vez (C(5,2)=10 pares, 5 jogos × 2 pares = 10)
    // Schedule óptimo derivado por design combinatorial:
    const [a, b, c, d, e] = ids;
    matches.push(
      { player1_id: a, player2_id: b, player3_id: c, player4_id: d }, // ab vs cd  (e descansa)
      { player1_id: a, player2_id: c, player3_id: b, player4_id: e }, // ac vs be  (d descansa)
      { player1_id: a, player2_id: e, player3_id: b, player4_id: d }, // ae vs bd  (c descansa)
      { player1_id: a, player2_id: d, player3_id: c, player4_id: e }, // ad vs ce  (b descansa)
      { player1_id: b, player2_id: c, player3_id: d, player4_id: e }, // bc vs de  (a descansa)
    );
  } else {
    // n ≥ 6: algoritmo por ronda com "quem descansa" rotativo
    // Melhor cobertura de pares que o algoritmo guloso original
    const usedPairs = new Set<string>();
    const playerMatchCount = new Map<string, number>();
    ids.forEach(id => playerMatchCount.set(id, 0));

    // Para cada ronda, escolher os 4 jogadores com menos jogos
    // e o melhor emparelhamento entre eles
    const maxRounds = Math.floor(n * (n - 1) / 4) + n;
    let roundsWithoutMatch = 0;

    for (let r = 0; r < maxRounds && roundsWithoutMatch < 3; r++) {
      // Ordenar jogadores por número de jogos (menos jogos primeiro)
      const byCount = [...ids].sort((a, b) =>
        (playerMatchCount.get(a) || 0) - (playerMatchCount.get(b) || 0)
      );

      // Tentar todos os grupos de 4 jogadores (priorizando quem jogou menos)
      let bestMatch: RawMatch | null = null;
      let bestScore = -Infinity;

      for (let i = 0; i < byCount.length && bestMatch === null; i++) {
        for (let j = i + 1; j < byCount.length; j++) {
          for (let k = j + 1; k < byCount.length; k++) {
            for (let l = k + 1; l < byCount.length; l++) {
              const four = [byCount[i], byCount[j], byCount[k], byCount[l]];
              // Tentar as 3 formas de emparelhar 4 jogadores
              const pairings = [
                { p1: [four[0], four[1]], p2: [four[2], four[3]] },
                { p1: [four[0], four[2]], p2: [four[1], four[3]] },
                { p1: [four[0], four[3]], p2: [four[1], four[2]] },
              ];
              for (const opt of pairings) {
                const k1 = pKey(opt.p1[0], opt.p1[1]);
                const k2 = pKey(opt.p2[0], opt.p2[1]);
                if (usedPairs.has(k1) || usedPairs.has(k2)) continue;
                const score = -Math.max(
                  ...four.map(p => playerMatchCount.get(p) || 0)
                );
                if (score > bestScore) {
                  bestScore = score;
                  bestMatch = {
                    player1_id: opt.p1[0], player2_id: opt.p1[1],
                    player3_id: opt.p2[0], player4_id: opt.p2[1],
                  };
                }
              }
              if (bestMatch) break;
            }
            if (bestMatch) break;
          }
          if (bestMatch) break;
        }
        if (bestMatch) break;
      }

      if (bestMatch) {
        const k1 = pKey(bestMatch.player1_id, bestMatch.player2_id);
        const k2 = pKey(bestMatch.player3_id, bestMatch.player4_id);
        usedPairs.add(k1);
        usedPairs.add(k2);
        [bestMatch.player1_id, bestMatch.player2_id, bestMatch.player3_id, bestMatch.player4_id]
          .forEach(id => playerMatchCount.set(id, (playerMatchCount.get(id) || 0) + 1));
        matches.push(bestMatch);
        roundsWithoutMatch = 0;
      } else {
        roundsWithoutMatch++;
      }
    }
  }

  const playerMatchCount = new Map<string, number>();
  players.forEach(p => playerMatchCount.set(p.id, 0));
  matches.forEach(m => {
    [m.player1_id, m.player2_id, m.player3_id, m.player4_id].forEach(id => {
      playerMatchCount.set(id, (playerMatchCount.get(id) || 0) + 1);
    });
  });

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
  knockoutStage: 'semifinals' | 'quarterfinals' | 'round_of_16' | 'final' = 'semifinals'
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
  console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT] Total qualified players: ${totalQualified} (${qualifiedPerGroup} per group)`);
  console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT] Knockout stage: ${knockoutStage} (knockout matches will be created separately)`);

  // Note: Knockout matches (quarterfinals, semifinals, final) are created separately
  // in TournamentDetail.tsx after group stage is completed.
  // This scheduler only creates group stage matches.

  console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT] Total group matches generated: ${matches.length}`);
  return matches;
}
