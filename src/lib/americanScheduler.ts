export interface Player {
  id: string;
  name: string;
}

export interface AmericanMatch {
  round: string;
  match_number: number;
  player1_id: string;
  player2_id: string;
  player3_id: string;
  player4_id: string;
  scheduled_time: string;
  court: string;
}

export function generateAmericanSchedule(
  players: Player[],
  numberOfCourts: number,
  startDate: string,
  startTime: string = '09:00',
  endTime: string = '21:00',
  matchDurationMinutes: number = 90,
  matchesPerPlayer: number = 7
): AmericanMatch[] {
  console.log('[AMERICAN] Generating schedule for', players.length, 'players, max', matchesPerPlayer, 'matches per player');

  if (players.length < 4) {
    console.error('[AMERICAN] Need at least 4 players');
    return [];
  }

  const matches: AmericanMatch[] = [];

  const partnershipCounts = new Map<string, Map<string, number>>();
  const opponentCounts = new Map<string, Map<string, number>>();

  players.forEach(p => {
    partnershipCounts.set(p.id, new Map());
    opponentCounts.set(p.id, new Map());
    players.forEach(p2 => {
      if (p.id !== p2.id) {
        partnershipCounts.get(p.id)!.set(p2.id, 0);
        opponentCounts.get(p.id)!.set(p2.id, 0);
      }
    });
  });

  const getPartnershipCount = (p1: string, p2: string): number => {
    return (partnershipCounts.get(p1)?.get(p2) || 0) + (partnershipCounts.get(p2)?.get(p1) || 0);
  };

  const getOpponentCount = (p1: string, p2: string): number => {
    return (opponentCounts.get(p1)?.get(p2) || 0) + (opponentCounts.get(p2)?.get(p1) || 0);
  };

  const recordPartnership = (p1: string, p2: string) => {
    partnershipCounts.get(p1)!.set(p2, (partnershipCounts.get(p1)!.get(p2) || 0) + 1);
  };

  const recordOpponent = (p1: string, p2: string) => {
    opponentCounts.get(p1)!.set(p2, (opponentCounts.get(p1)!.get(p2) || 0) + 1);
  };

  const isValidMatch = (p1: string, p2: string, p3: string, p4: string): boolean => {
    if (p1 === p2 || p1 === p3 || p1 === p4 || p2 === p3 || p2 === p4 || p3 === p4) {
      return false;
    }
    return true;
  };

  const scoreMatch = (p1: string, p2: string, p3: string, p4: string, playerMatchCount: Map<string, number>): number => {
    let score = 0;

    const p12Partnership = getPartnershipCount(p1, p2);
    const p34Partnership = getPartnershipCount(p3, p4);
    score -= (p12Partnership + p34Partnership) * 100;

    const p13Opponent = getOpponentCount(p1, p3);
    const p14Opponent = getOpponentCount(p1, p4);
    const p23Opponent = getOpponentCount(p2, p3);
    const p24Opponent = getOpponentCount(p2, p4);
    score -= (p13Opponent + p14Opponent + p23Opponent + p24Opponent) * 50;

    const playersInMatch = [p1, p2, p3, p4];
    const totalMatchCount = playersInMatch.reduce((sum, p) => sum + (playerMatchCount.get(p) || 0), 0);
    score -= totalMatchCount * 10;

    return score;
  };

  const playerMatchCount = new Map<string, number>();
  players.forEach(p => playerMatchCount.set(p.id, 0));

  let matchNumber = 1;
  let roundNumber = 1;

  const maxRounds = matchesPerPlayer * 2;
  console.log('[AMERICAN] Will generate up to', maxRounds, 'rounds');

  while (roundNumber <= maxRounds) {
    const minMatches = Math.min(...Array.from(playerMatchCount.values()));
    if (minMatches >= matchesPerPlayer) {
      console.log('[AMERICAN] All players have reached', matchesPerPlayer, 'matches. Stopping.');
      break;
    }
    console.log('[AMERICAN] Generating round', roundNumber);

    // Find players who haven't played this round yet
    const availablePlayers = players.filter(p => {
      const playedThisRound = matches
        .filter(m => m.round === `round_${roundNumber}`)
        .some(m => [m.player1_id, m.player2_id, m.player3_id, m.player4_id].includes(p.id));
      return !playedThisRound;
    });

    if (availablePlayers.length < 4) {
      console.log('[AMERICAN] Not enough players for another match in round', roundNumber);
      roundNumber++;
      continue;
    }

    // Find best match from available players
    let bestMatch: { p1: string; p2: string; p3: string; p4: string; score: number } | null = null;

    for (let i = 0; i < availablePlayers.length; i++) {
      for (let j = i + 1; j < availablePlayers.length; j++) {
        for (let k = 0; k < availablePlayers.length; k++) {
          if (k === i || k === j) continue;
          for (let l = k + 1; l < availablePlayers.length; l++) {
            if (l === i || l === j) continue;

            const p1 = availablePlayers[i].id;
            const p2 = availablePlayers[j].id;
            const p3 = availablePlayers[k].id;
            const p4 = availablePlayers[l].id;

            if (!isValidMatch(p1, p2, p3, p4)) continue;

            const score = scoreMatch(p1, p2, p3, p4, playerMatchCount);

            if (!bestMatch || score > bestMatch.score) {
              bestMatch = { p1, p2, p3, p4, score };
            }
          }
        }
      }
    }

    if (bestMatch) {
      recordPartnership(bestMatch.p1, bestMatch.p2);
      recordPartnership(bestMatch.p3, bestMatch.p4);
      recordOpponent(bestMatch.p1, bestMatch.p3);
      recordOpponent(bestMatch.p1, bestMatch.p4);
      recordOpponent(bestMatch.p2, bestMatch.p3);
      recordOpponent(bestMatch.p2, bestMatch.p4);

      // Increment match count for each player
      playerMatchCount.set(bestMatch.p1, (playerMatchCount.get(bestMatch.p1) || 0) + 1);
      playerMatchCount.set(bestMatch.p2, (playerMatchCount.get(bestMatch.p2) || 0) + 1);
      playerMatchCount.set(bestMatch.p3, (playerMatchCount.get(bestMatch.p3) || 0) + 1);
      playerMatchCount.set(bestMatch.p4, (playerMatchCount.get(bestMatch.p4) || 0) + 1);

      matches.push({
        round: `round_${roundNumber}`,
        match_number: matchNumber++,
        player1_id: bestMatch.p1,
        player2_id: bestMatch.p2,
        player3_id: bestMatch.p3,
        player4_id: bestMatch.p4,
        scheduled_time: '',
        court: ''
      });
    } else {
      console.log('[AMERICAN] No valid match found in round', roundNumber);
      roundNumber++;
    }
  }

  // Log match count per player
  console.log('[AMERICAN] Matches per player:');
  playerMatchCount.forEach((count, playerId) => {
    const player = players.find(p => p.id === playerId);
    console.log(`  ${player?.name}: ${count} matches`);
  });

  console.log('[AMERICAN] Generated', matches.length, 'matches across', roundNumber - 1, 'rounds');

  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  const startTotalMinutes = startHour * 60 + startMinute;
  const endTotalMinutes = endHour * 60 + (endMinute || 0);
  let availableMinutesPerDay = endTotalMinutes - startTotalMinutes;
  if (availableMinutesPerDay <= 0) {
    availableMinutesPerDay = (24 * 60 - startTotalMinutes) + endTotalMinutes;
  }
  const slotsPerDay = Math.floor(availableMinutesPerDay / matchDurationMinutes);

  // Track which players are busy at each time slot
  const busyPlayers = new Map<string, Set<string>>(); // time -> Set of player IDs
  const occupiedCourts = new Map<string, Set<number>>(); // time -> Set of court numbers

  for (const match of matches) {
    let scheduled = false;
    let currentTimeSlot = 0;
    const maxTimeSlots = slotsPerDay * 100; // Allow up to 100 days

    while (!scheduled && currentTimeSlot < maxTimeSlots) {
      const totalMinutesFromStart = currentTimeSlot * matchDurationMinutes;
      const daysFromStart = Math.floor(totalMinutesFromStart / availableMinutesPerDay);
      const minutesInDay = totalMinutesFromStart % availableMinutesPerDay;

      const totalMinutes = startHour * 60 + startMinute + minutesInDay;
      const matchHour = Math.floor(totalMinutes / 60) % 24;
      const matchMinute = totalMinutes % 60;
      const extraDays = Math.floor(totalMinutes / (60 * 24));

      const [year, month, day] = startDate.split('-').map(Number);
      const matchDate = new Date(Date.UTC(year, month - 1, day + daysFromStart + extraDays, matchHour, matchMinute, 0, 0));
      const dateString = matchDate.toISOString().split('T')[0];
      const timeString = `${String(matchHour).padStart(2, '0')}:${String(matchMinute).padStart(2, '0')}`;
      const timeKey = `${dateString}T${timeString}:00`;

      // Check if any player is busy at this time
      const busyAtThisTime = busyPlayers.get(timeKey) || new Set();
      const playersInMatch = [match.player1_id, match.player2_id, match.player3_id, match.player4_id];
      const hasConflict = playersInMatch.some(p => busyAtThisTime.has(p));

      if (!hasConflict) {
        // Find an available court
        const usedCourts = occupiedCourts.get(timeKey) || new Set();
        let availableCourt = -1;

        for (let c = 1; c <= numberOfCourts; c++) {
          if (!usedCourts.has(c)) {
            availableCourt = c;
            break;
          }
        }

        if (availableCourt !== -1) {
          // Schedule the match
          match.scheduled_time = timeKey;
          match.court = String(availableCourt);

          // Mark players as busy
          if (!busyPlayers.has(timeKey)) {
            busyPlayers.set(timeKey, new Set());
          }
          playersInMatch.forEach(p => busyPlayers.get(timeKey)!.add(p));

          // Mark court as occupied
          if (!occupiedCourts.has(timeKey)) {
            occupiedCourts.set(timeKey, new Set());
          }
          occupiedCourts.get(timeKey)!.add(availableCourt);

          scheduled = true;
        }
      }

      currentTimeSlot++;
    }

    if (!scheduled) {
      console.error('[AMERICAN] Could not schedule match:', match);
    }
  }

  console.log('[AMERICAN] Final schedule:', matches.length, 'matches');
  console.log('[AMERICAN] First match:', matches[0]);

  return matches;
}
