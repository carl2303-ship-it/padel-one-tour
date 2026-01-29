import { Team, ScheduledMatch, DailySchedule } from './scheduler';
import { generateAmericanSchedule } from './americanScheduler';

interface CategoryScheduleRequest {
  categoryId: string;
  teams: Team[];
  format: string;
  knockoutTeams?: Team[];
  isAmerican?: boolean;
  rounds?: number;
  isIndividualFormat?: boolean;
  knockoutStage?: 'final' | 'semifinals' | 'quarterfinals' | 'round_of_16';
}

function getDaySchedule(date: string, dailySchedules: DailySchedule[], defaultStart: string, defaultEnd: string): { start_time: string; end_time: string } {
  if (dailySchedules && dailySchedules.length > 0) {
    const schedule = dailySchedules.find(s => s.date === date);
    if (schedule) {
      return { start_time: schedule.start_time, end_time: schedule.end_time };
    }
  }
  return { start_time: defaultStart, end_time: defaultEnd };
}

function calculateSlotsForDay(dateStr: string, dailySchedules: DailySchedule[], defaultStart: string, defaultEnd: string, matchDurationMinutes: number): { slotsPerDay: number; startHour: number; startMinute: number } {
  const schedule = getDaySchedule(dateStr, dailySchedules, defaultStart, defaultEnd);
  const [startHour, startMinute] = schedule.start_time.split(':').map(Number);
  const [endHour, endMinute] = schedule.end_time.split(':').map(Number);
  const startTotalMinutes = startHour * 60 + startMinute;
  const endTotalMinutes = endHour * 60 + (endMinute || 0);
  let availableMinutes = endTotalMinutes - startTotalMinutes;
  if (availableMinutes <= 0) {
    availableMinutes = (24 * 60 - startTotalMinutes) + endTotalMinutes;
  }
  const slotsPerDay = Math.floor(availableMinutes / matchDurationMinutes);
  return { slotsPerDay, startHour, startMinute };
}

function getDateForSlot(startDate: string, slotIndex: number, dailySchedules: DailySchedule[], defaultStart: string, defaultEnd: string, matchDurationMinutes: number): { dateStr: string; slotInDay: number; startHour: number; startMinute: number } {
  const [year, month, day] = startDate.split('-').map(Number);
  let remainingSlots = slotIndex;
  let currentDate = new Date(year, month - 1, day);

  while (true) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const dayInfo = calculateSlotsForDay(dateStr, dailySchedules, defaultStart, defaultEnd, matchDurationMinutes);

    if (remainingSlots < dayInfo.slotsPerDay) {
      return { dateStr, slotInDay: remainingSlots, startHour: dayInfo.startHour, startMinute: dayInfo.startMinute };
    }

    remainingSlots -= dayInfo.slotsPerDay;
    currentDate.setDate(currentDate.getDate() + 1);
  }
}

export function scheduleMultipleCategories(
  categories: CategoryScheduleRequest[],
  numberOfCourts: number,
  startDate: string,
  dailyStartTime: string = '09:00',
  dailyEndTime: string = '21:00',
  matchDurationMinutes: number = 90,
  existingMatches: ScheduledMatch[] = [],
  dailySchedules: DailySchedule[] = []
): Map<string, ScheduledMatch[]> {
  console.log('[MULTI-CAT V4] Starting with dailySchedules:', JSON.stringify(dailySchedules));

  const occupiedSlots = new Set<string>();
  const busyPlayers = new Map<string, Set<string>>();
  const playerLastPlayed = new Map<string, number>();

  const getMatchPlayerIds = (match: any): string[] => {
    const ids: string[] = [];
    if (match.team1_id) ids.push(match.team1_id);
    if (match.team2_id) ids.push(match.team2_id);
    if (match.player1_individual_id) ids.push(match.player1_individual_id);
    if (match.player2_individual_id) ids.push(match.player2_individual_id);
    if (match.player3_individual_id) ids.push(match.player3_individual_id);
    if (match.player4_individual_id) ids.push(match.player4_individual_id);
    return ids;
  };

  existingMatches.forEach(match => {
    const time = match.scheduled_time;
    const court = match.court;
    occupiedSlots.add(`${time}_${court}`);

    const playerIds = getMatchPlayerIds(match);
    playerIds.forEach(playerId => {
      if (!busyPlayers.has(time)) busyPlayers.set(time, new Set());
      busyPlayers.get(time)!.add(playerId);
    });
  });

  interface MatchWithCategory extends ScheduledMatch {
    categoryId: string;
    duration?: number;
  }

  const allMatches: MatchWithCategory[] = [];

  categories.forEach(category => {
    console.log(`[MULTI-CAT V2] Processing category ${category.categoryId}:`, {
      format: category.format,
      teams: category.teams.length,
      knockoutTeams: category.knockoutTeams?.length || 0,
      hasKnockoutTeams: !!category.knockoutTeams
    });

    const calculatedRounds = category.isAmerican
      ? Math.max(category.teams.length - 1, 7)
      : (category.rounds || 7);

    const matches = generateCategoryMatches(category.teams, category.format, numberOfCourts, matchDurationMinutes, 0, category.isAmerican || false, calculatedRounds, startDate);
    console.log(`[MULTI-CAT V2] Category ${category.categoryId}: Generated ${matches.length} group matches`);
    matches.forEach(match => {
      allMatches.push({
        ...match,
        categoryId: category.categoryId,
        duration: (match as any).duration || matchDurationMinutes
      });
    });

    // If knockout teams are provided, generate knockout matches as well
    if (category.knockoutTeams && category.knockoutTeams.length >= 2) {
      // Pass the current match count as offset so knockout matches don't overlap
      const currentMatchCount = matches.length;
      const knockoutMatches = generateSingleEliminationMatchesWithOptions(
        category.knockoutTeams,
        currentMatchCount,
        category.isIndividualFormat || false,
        category.knockoutStage || 'semifinals'
      );
      console.log(`[MULTI-CAT V2] Category ${category.categoryId}: Generated ${knockoutMatches.length} knockout matches from ${category.knockoutTeams.length} qualified teams (starting at match ${currentMatchCount + 1}), isIndividual: ${category.isIndividualFormat}, knockoutStage: ${category.knockoutStage}`);
      knockoutMatches.forEach(match => {
        allMatches.push({
          ...match,
          categoryId: category.categoryId,
          duration: matchDurationMinutes
        });
      });
    }
  });

  const scheduledMatches = new Map<string, ScheduledMatch[]>();
  categories.forEach(cat => scheduledMatches.set(cat.categoryId, []));

  const scheduledMatchIds = new Set<string>();
  let currentTimeSlot = 0;
  const maxIterations = 10000;
  let iterations = 0;

  // Separate group stage matches from knockout matches
  const groupMatches = allMatches.filter(m => m.round === 'group_stage' || m.round.startsWith('group_'));
  const knockoutMatches = allMatches.filter(m => m.round !== 'group_stage' && !m.round.startsWith('group_'));

  const uniqueCategories = [...new Set(groupMatches.map(m => m.categoryId))].sort();
  console.log('[MULTI-CAT V3] Categories:', uniqueCategories);
  console.log('[MULTI-CAT V3] Starting scheduler with', allMatches.length, 'matches across', categories.length, 'categories');
  console.log(`[MULTI-CAT V3] ${groupMatches.length} group matches, ${knockoutMatches.length} knockout matches`);
  console.log(`[MULTI-CAT V3] Courts available: ${numberOfCourts}`);

  // PHASE 1: Schedule group stage matches - fill ALL courts per slot
  while (iterations < maxIterations && scheduledMatchIds.size < groupMatches.length) {
    iterations++;

    const slotIndex = currentTimeSlot;
    const slotInfo = getDateForSlot(startDate, slotIndex, dailySchedules, dailyStartTime, dailyEndTime, matchDurationMinutes);
    const totalMinutesFromStart = slotInfo.slotInDay * matchDurationMinutes;
    const hourOffset = Math.floor(totalMinutesFromStart / 60);
    const minuteOffset = totalMinutesFromStart % 60;

    const [year, month, day] = slotInfo.dateStr.split('-').map(Number);
    const scheduledTime = new Date(Date.UTC(year, month - 1, day, slotInfo.startHour + hourOffset, slotInfo.startMinute + minuteOffset, 0, 0));
    const timeStr = scheduledTime.toISOString();
    console.log(`[MULTI-CAT V4] Slot ${slotIndex} -> ${slotInfo.dateStr} slot ${slotInfo.slotInDay} -> ${timeStr}`);

    // Check if ANY category still has unscheduled matches
    const anyRemaining = groupMatches.some(m => !scheduledMatchIds.has(`${m.categoryId}_${m.match_number}`));
    if (!anyRemaining) break;

    let matchesScheduledThisSlot = 0;
    const playersPlayingThisSlot = new Set<string>();

    // Try to fill ALL courts with matches from ANY category
    for (let court = 1; court <= numberOfCourts; court++) {
      const slotKey = `${timeStr}_${court}`;
      if (occupiedSlots.has(slotKey)) {
        continue;
      }

      // Find first available match from ANY category where NO player is already playing this slot
      let matchToSchedule: typeof groupMatches[0] | undefined;

      // Rotate through categories based on slot to maintain some alternation
      const startCategoryIdx = slotIndex % uniqueCategories.length;
      for (let catOffset = 0; catOffset < uniqueCategories.length; catOffset++) {
        const catIdx = (startCategoryIdx + catOffset) % uniqueCategories.length;
        const categoryId = uniqueCategories[catIdx];

        for (const match of groupMatches) {
          if (match.categoryId !== categoryId) continue;
          const matchId = `${match.categoryId}_${match.match_number}`;
          if (scheduledMatchIds.has(matchId)) continue;

          const playerIds = getMatchPlayerIds(match);
          const anyPlayerBusy = playerIds.some(id => playersPlayingThisSlot.has(id));

          if (!anyPlayerBusy) {
            matchToSchedule = match;
            break;
          }
        }

        if (matchToSchedule) break;
      }

      if (matchToSchedule) {
        const matchDuration = matchToSchedule.duration || matchDurationMinutes;
        const { categoryId, duration, ...matchData } = matchToSchedule;
        const scheduledMatch = {
          ...matchData,
          scheduled_time: timeStr,
          court: court.toString()
        };

        const categoryScheduled = scheduledMatches.get(categoryId)!;
        categoryScheduled.push(scheduledMatch);

        const matchId = `${matchToSchedule.categoryId}_${matchToSchedule.match_number}`;
        scheduledMatchIds.add(matchId);
        occupiedSlots.add(slotKey);

        const slotsToOccupy = Math.ceil(matchDuration / matchDurationMinutes);
        for (let futureSlot = 1; futureSlot < slotsToOccupy; futureSlot++) {
          const futureSlotIndex = slotIndex + futureSlot;
          const futureSlotInfo = getDateForSlot(startDate, futureSlotIndex, dailySchedules, dailyStartTime, dailyEndTime, matchDurationMinutes);
          const futureTotalMinutes = futureSlotInfo.slotInDay * matchDurationMinutes;
          const futureHourOffset = Math.floor(futureTotalMinutes / 60);
          const futureMinuteOffset = futureTotalMinutes % 60;
          const [yr, mo, dy] = futureSlotInfo.dateStr.split('-').map(Number);
          const futureTime = new Date(Date.UTC(yr, mo - 1, dy, futureSlotInfo.startHour + futureHourOffset, futureSlotInfo.startMinute + futureMinuteOffset, 0, 0));
          occupiedSlots.add(`${futureTime.toISOString()}_${court}`);
        }

        if (!busyPlayers.has(timeStr)) busyPlayers.set(timeStr, new Set());
        const matchPlayerIds = getMatchPlayerIds(scheduledMatch);
        matchPlayerIds.forEach(playerId => {
          busyPlayers.get(timeStr)!.add(playerId);
          playerLastPlayed.set(playerId, slotIndex);
          playersPlayingThisSlot.add(playerId);
        });

        const catShort = matchToSchedule.categoryId.substring(0, 8);
        console.log(`[MULTI-CAT V3] Slot ${slotIndex} Court ${court}: Match ${matchToSchedule.match_number} Cat ${catShort}`);
        matchesScheduledThisSlot++;
      }
    }

    console.log(`[MULTI-CAT V3] Slot ${slotIndex}: ${matchesScheduledThisSlot}/${numberOfCourts} courts filled`);

    currentTimeSlot++;
  }

  console.log('[MULTI-CAT V3] Group stage complete!', scheduledMatchIds.size, 'group matches scheduled');

  // PHASE 2: Schedule knockout matches with known teams/players (not TBD placeholders)
  const knockoutWithTeams = knockoutMatches.filter(m => {
    const isTeamTBD = m.team1_id === null && m.team2_id === null;
    const p1Individual = (m as any).player1_individual_id;
    const hasNoPlayers = p1Individual === null || p1Individual === undefined;
    return !(isTeamTBD && hasNoPlayers);
  });
  console.log(`[MULTI-CAT V2] Scheduling ${knockoutWithTeams.length} knockout matches with TBD teams`);

  // Group knockout matches by round so same-round matches can be scheduled in parallel
  const matchesByRound = new Map<string, typeof knockoutWithTeams>();
  knockoutWithTeams.forEach(match => {
    if (!matchesByRound.has(match.round)) {
      matchesByRound.set(match.round, []);
    }
    matchesByRound.get(match.round)!.push(match);
  });

  // Schedule each round (e.g., all semifinals at same time on different courts)
  for (const [round, roundMatches] of matchesByRound) {
    console.log(`[MULTI-CAT V2] Scheduling ${roundMatches.length} matches for round: ${round}`);

    // Schedule all matches of this round, using multiple time slots if needed
    const matchesToSchedule = [...roundMatches];

    while (matchesToSchedule.length > 0) {
      const slotIndex = currentTimeSlot;
      const slotInfo = getDateForSlot(startDate, slotIndex, dailySchedules, dailyStartTime, dailyEndTime, matchDurationMinutes);
      const totalMinutesFromStart = slotInfo.slotInDay * matchDurationMinutes;
      const hourOffset = Math.floor(totalMinutesFromStart / 60);
      const minuteOffset = totalMinutesFromStart % 60;

      const [year, month, day] = slotInfo.dateStr.split('-').map(Number);
      const scheduledTime = new Date(Date.UTC(year, month - 1, day, slotInfo.startHour + hourOffset, slotInfo.startMinute + minuteOffset, 0, 0));
      const timeStr = scheduledTime.toISOString();

      let scheduledInThisSlot = 0;
      const remainingMatches: typeof matchesToSchedule = [];

      for (const koMatch of matchesToSchedule) {
        const matchId = `${koMatch.categoryId}_${koMatch.match_number}`;
        if (scheduledMatchIds.has(matchId)) continue;

        // Find first available court at this time
        let assignedCourt = 0;
        for (let court = 1; court <= numberOfCourts; court++) {
          const slotKey = `${timeStr}_${court}`;
          if (!occupiedSlots.has(slotKey)) {
            assignedCourt = court;
            occupiedSlots.add(slotKey);
            break;
          }
        }

        if (assignedCourt === 0) {
          remainingMatches.push(koMatch);
          continue;
        }

        const matchDuration = koMatch.duration || matchDurationMinutes;
        const { categoryId, duration, ...matchData } = koMatch;
        const scheduledMatch = {
          ...matchData,
          scheduled_time: timeStr,
          court: assignedCourt.toString()
        };

        const categoryScheduled = scheduledMatches.get(categoryId)!;
        categoryScheduled.push(scheduledMatch);
        scheduledMatchIds.add(matchId);
        scheduledInThisSlot++;

        // Mark future slots as occupied based on match duration
        const slotsToOccupy = Math.ceil(matchDuration / matchDurationMinutes);
        for (let futureSlot = 1; futureSlot < slotsToOccupy; futureSlot++) {
          const futureSlotIndex = slotIndex + futureSlot;
          const futureSlotInfo = getDateForSlot(startDate, futureSlotIndex, dailySchedules, dailyStartTime, dailyEndTime, matchDurationMinutes);
          const futureTotalMinutes = futureSlotInfo.slotInDay * matchDurationMinutes;
          const futureHourOffset = Math.floor(futureTotalMinutes / 60);
          const futureMinuteOffset = futureTotalMinutes % 60;
          const [y, m, d] = futureSlotInfo.dateStr.split('-').map(Number);
          const futureTime = new Date(Date.UTC(y, m - 1, d, futureSlotInfo.startHour + futureHourOffset, futureSlotInfo.startMinute + futureMinuteOffset, 0, 0));
          occupiedSlots.add(`${futureTime.toISOString()}_${assignedCourt}`);
        }

        console.log(`[MULTI-CAT V2] ✅ Knockout Match ${koMatch.match_number} (${koMatch.round}) scheduled at ${timeStr} on court ${assignedCourt}`);
      }

      // Move remaining matches to next iteration
      matchesToSchedule.length = 0;
      matchesToSchedule.push(...remainingMatches);

      // Move to next time slot
      currentTimeSlot++;

      if (remainingMatches.length > 0) {
        console.log(`[MULTI-CAT V2] ${remainingMatches.length} matches overflow to next slot`);
      }
    }
  }

  // PHASE 3: Schedule final/other TBD matches (knockout placeholders with null teams or TBD players)
  const tbdMatches = allMatches.filter(match => {
    const matchId = `${match.categoryId}_${match.match_number}`;
    if (scheduledMatchIds.has(matchId)) return false;
    const isTeamTBD = match.team1_id === null && match.team2_id === null;
    const p1Individual = (match as any).player1_individual_id;
    const hasNoPlayers = p1Individual === null || p1Individual === undefined;
    return isTeamTBD && hasNoPlayers;
  });

  console.log(`[MULTI-CAT V2] Found ${tbdMatches.length} TBD matches (null/null):`, tbdMatches.map(m => `M${m.match_number}(${m.round})`).join(', '));
  console.log('[MULTI-CAT V2] TBD matches details:', tbdMatches.map(m => ({ match: m.match_number, round: m.round, t1: m.team1_id, t2: m.team2_id })));

  if (tbdMatches.length > 0) {
    console.log(`[MULTI-CAT V2] Scheduling ${tbdMatches.length} TBD knockout matches after group stage (starting at slot ${currentTimeSlot})`);

    const knockoutScheduleGroups = [
      ['round_of_32'],
      ['round_of_16'],
      ['quarter_final', 'quarterfinal'],
      ['semifinal', 'semi_final', '5th_place', '7th_place'],
      ['final', '3rd_place']
    ];

    for (const roundGroup of knockoutScheduleGroups) {
      const matchesInGroup = tbdMatches.filter(m => roundGroup.includes(m.round));
      if (matchesInGroup.length === 0) continue;

      console.log(`[MULTI-CAT V2] Scheduling ${matchesInGroup.length} TBD matches for rounds: ${roundGroup.join(', ')}`);

      const pendingMatches = [...matchesInGroup];

      while (pendingMatches.length > 0) {
        const slotIndex = currentTimeSlot;
        const slotInfo = getDateForSlot(startDate, slotIndex, dailySchedules, dailyStartTime, dailyEndTime, matchDurationMinutes);
        const totalMinutesFromStart = slotInfo.slotInDay * matchDurationMinutes;
        const hourOffset = Math.floor(totalMinutesFromStart / 60);
        const minuteOffset = totalMinutesFromStart % 60;

        const [year, month, day] = slotInfo.dateStr.split('-').map(Number);
        const scheduledTime = new Date(Date.UTC(year, month - 1, day, slotInfo.startHour + hourOffset, slotInfo.startMinute + minuteOffset, 0, 0));
        const timeStr = scheduledTime.toISOString();

        let matchesScheduledThisSlot = 0;
        const remainingMatches: typeof pendingMatches = [];

        for (const tbdMatch of pendingMatches) {
          const matchId = `${tbdMatch.categoryId}_${tbdMatch.match_number}`;
          if (scheduledMatchIds.has(matchId)) continue;

          let assignedCourt = 0;
          for (let court = 1; court <= numberOfCourts; court++) {
            const slotKey = `${timeStr}_${court}`;
            if (!occupiedSlots.has(slotKey)) {
              assignedCourt = court;
              break;
            }
          }

          if (assignedCourt === 0) {
            remainingMatches.push(tbdMatch);
            continue;
          }

          occupiedSlots.add(`${timeStr}_${assignedCourt}`);

          const matchDuration = tbdMatch.duration || matchDurationMinutes;
          const { categoryId, duration, ...matchData } = tbdMatch;
          const scheduledMatch = {
            ...matchData,
            scheduled_time: timeStr,
            court: assignedCourt.toString()
          };

          const categoryScheduled = scheduledMatches.get(categoryId)!;
          categoryScheduled.push(scheduledMatch);
          scheduledMatchIds.add(matchId);

          const slotsToOccupy = Math.ceil(matchDuration / matchDurationMinutes);
          for (let futureSlot = 1; futureSlot < slotsToOccupy; futureSlot++) {
            const futureSlotIndex = slotIndex + futureSlot;
            const futureSlotInfo = getDateForSlot(startDate, futureSlotIndex, dailySchedules, dailyStartTime, dailyEndTime, matchDurationMinutes);
            const futureTotalMinutes = futureSlotInfo.slotInDay * matchDurationMinutes;
            const futureHourOffset = Math.floor(futureTotalMinutes / 60);
            const futureMinuteOffset = futureTotalMinutes % 60;
            const [fy, fm, fd] = futureSlotInfo.dateStr.split('-').map(Number);
            const futureTime = new Date(Date.UTC(fy, fm - 1, fd, futureSlotInfo.startHour + futureHourOffset, futureSlotInfo.startMinute + futureMinuteOffset, 0, 0));
            occupiedSlots.add(`${futureTime.toISOString()}_${assignedCourt}`);
          }

          matchesScheduledThisSlot++;
          console.log(`[MULTI-CAT V2] TBD Match ${tbdMatch.match_number} (${tbdMatch.round}) scheduled at ${timeStr} on court ${assignedCourt}`);
        }

        pendingMatches.length = 0;
        pendingMatches.push(...remainingMatches);

        console.log(`[MULTI-CAT V2] Slot ${slotIndex}: ${matchesScheduledThisSlot} TBD matches scheduled, ${remainingMatches.length} remaining`);
        currentTimeSlot++;
      }
    }
  }

  console.log('[MULTI-CAT V2] Final total:', scheduledMatchIds.size, 'matches scheduled (including TBD)');

  // Log what we're returning for each category
  categories.forEach(cat => {
    const matches = scheduledMatches.get(cat.categoryId) || [];
    console.log(`[MULTI-CAT V2] Returning ${matches.length} matches for category ${cat.categoryId}`);
    console.log(`[MULTI-CAT V2] Match rounds:`, matches.map(m => `${m.match_number}:${m.round}`).join(', '));
  });

  return scheduledMatches;
}

function generateCategoryMatches(teams: Team[], format: string, numberOfCourts: number, matchDurationMinutes: number, matchNumberOffset: number = 0, isAmerican: boolean = false, rounds: number = 7, startDate: string = '2024-01-01'): ScheduledMatch[] {
  console.log(`[GEN_CAT_MATCHES] Format: ${format}, Teams: ${teams.length}, Offset: ${matchNumberOffset}`);
  if (format === 'single_elimination') {
    console.log(`[GEN_CAT_MATCHES] Teams for knockout:`, teams.map(t => ({ id: t.id, name: t.team_name, seed: t.seed })));
  }
  const sortedTeams = [...teams].sort((a, b) => (a.seed || 0) - (b.seed || 0));

  if (format === 'single_elimination') {
    return generateSingleEliminationMatches(sortedTeams, matchNumberOffset);
  } else if (format === 'groups_knockout' || format === 'groups') {
    return generateGroupKnockoutMatches(sortedTeams, numberOfCourts, matchDurationMinutes);
  } else if (format === 'individual_groups_knockout') {
    return generateIndividualGroupsKnockoutMatches(sortedTeams, matchNumberOffset, rounds, startDate);
  } else if (format === 'round_robin') {
    return generateRoundRobinMatches(sortedTeams, matchNumberOffset, isAmerican, rounds, startDate);
  }

  return [];
}

function generateUniquePartnershipMatches(players: Team[]): Array<{ p1: string; p2: string; p3: string; p4: string }> {
  const n = players.length;

  const allPairs: Array<{ i1: number; i2: number; p1: string; p2: string }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      allPairs.push({ i1: i, i2: j, p1: players[i].id, p2: players[j].id });
    }
  }

  const validMatchPairs: Array<[number, number]> = [];
  for (let i = 0; i < allPairs.length; i++) {
    for (let j = i + 1; j < allPairs.length; j++) {
      const p1 = allPairs[i];
      const p2 = allPairs[j];
      if (p1.i1 !== p2.i1 && p1.i1 !== p2.i2 && p1.i2 !== p2.i1 && p1.i2 !== p2.i2) {
        validMatchPairs.push([i, j]);
      }
    }
  }

  let bestSolution: number[] = [];

  function backtrack(index: number, usedPairs: Set<number>, solution: number[]): void {
    if (solution.length > bestSolution.length) {
      bestSolution = [...solution];
    }

    const remainingPairs = allPairs.length - usedPairs.size;
    if (solution.length + Math.floor(remainingPairs / 2) <= bestSolution.length) {
      return;
    }

    for (let i = index; i < validMatchPairs.length; i++) {
      const [pairIdx1, pairIdx2] = validMatchPairs[i];
      if (usedPairs.has(pairIdx1) || usedPairs.has(pairIdx2)) continue;

      usedPairs.add(pairIdx1);
      usedPairs.add(pairIdx2);
      solution.push(i);

      backtrack(i + 1, usedPairs, solution);

      solution.pop();
      usedPairs.delete(pairIdx1);
      usedPairs.delete(pairIdx2);
    }
  }

  backtrack(0, new Set(), []);

  return bestSolution.map(matchIdx => {
    const [pairIdx1, pairIdx2] = validMatchPairs[matchIdx];
    const pair1 = allPairs[pairIdx1];
    const pair2 = allPairs[pairIdx2];
    return {
      p1: pair1.p1,
      p2: pair1.p2,
      p3: pair2.p1,
      p4: pair2.p2,
    };
  });
}

function generateIndividualGroupsKnockoutMatches(teams: Team[], matchNumberOffset: number = 0, _matchesPerPlayer: number = 7, startDate: string = '2024-01-01'): ScheduledMatch[] {
  const matches: ScheduledMatch[] = [];
  let matchNumber = matchNumberOffset + 1;

  console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Generating with ${teams.length} players, starting match ${matchNumber}`);

  const teamsByGroup = new Map<string, Team[]>();
  const playersWithGroups = teams.filter(t => t.group_name);

  if (playersWithGroups.length === 0 && teams.length >= 4) {
    console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] No groups assigned, creating single group "A" with all ${teams.length} players`);
    teamsByGroup.set('A', [...teams]);
  } else {
    teams.forEach(team => {
      if (team.group_name) {
        if (!teamsByGroup.has(team.group_name)) {
          teamsByGroup.set(team.group_name, []);
        }
        teamsByGroup.get(team.group_name)!.push(team);
      }
    });
  }

  const sortedGroups = Array.from(teamsByGroup.keys()).sort();
  console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Found ${sortedGroups.length} groups:`, sortedGroups);

  sortedGroups.forEach(groupName => {
    const groupPlayers = teamsByGroup.get(groupName)!;
    console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Group ${groupName}: ${groupPlayers.length} players`);

    if (groupPlayers.length < 4) {
      console.warn(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Group ${groupName} has fewer than 4 players, skipping`);
      return;
    }

    const groupMatches = generateUniquePartnershipMatches(groupPlayers);
    console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Group ${groupName}: Generated ${groupMatches.length} matches (each pair plays together once)`);

    groupMatches.forEach((match) => {
      matches.push({
        round: `group_${groupName}`,
        match_number: matchNumber++,
        team1_id: null,
        team2_id: null,
        player1_individual_id: match.p1,
        player2_individual_id: match.p2,
        player3_individual_id: match.p3,
        player4_individual_id: match.p4,
        scheduled_time: '',
        court: ''
      });
    });
  });

  console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Total group matches generated: ${matches.length}`);

  const numberOfGroups = sortedGroups.length;
  const qualifiedPerGroup = 2;
  const totalQualified = numberOfGroups * qualifiedPerGroup;

  console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Generating knockout with ${totalQualified} qualified players`);

  if (totalQualified >= 4) {
    // Always create 2 semifinals for 4+ qualified players
    const numSemifinals = 2;

    for (let i = 0; i < numSemifinals; i++) {
      matches.push({
        round: 'semifinal',
        match_number: matchNumber++,
        team1_id: null,
        team2_id: null,
        player1_individual_id: null,
        player2_individual_id: null,
        player3_individual_id: null,
        player4_individual_id: null,
        scheduled_time: '',
        court: ''
      });
    }
    console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Added ${numSemifinals} semifinal matches`);

    matches.push({
      round: 'final',
      match_number: matchNumber++,
      team1_id: null,
      team2_id: null,
      player1_individual_id: null,
      player2_individual_id: null,
      player3_individual_id: null,
      player4_individual_id: null,
      scheduled_time: '',
      court: ''
    });
    console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Added final match`);

    matches.push({
      round: '3rd_place',
      match_number: matchNumber++,
      team1_id: null,
      team2_id: null,
      player1_individual_id: null,
      player2_individual_id: null,
      player3_individual_id: null,
      player4_individual_id: null,
      scheduled_time: '',
      court: ''
    });
    console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Added 3rd/4th place match`);

    if (numberOfGroups >= 2) {
      matches.push({
        round: '5th_place',
        match_number: matchNumber++,
        team1_id: null,
        team2_id: null,
        player1_individual_id: null,
        player2_individual_id: null,
        player3_individual_id: null,
        player4_individual_id: null,
        scheduled_time: '',
        court: ''
      });
      console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Added 5th/6th place match`);

      matches.push({
        round: '7th_place',
        match_number: matchNumber++,
        team1_id: null,
        team2_id: null,
        player1_individual_id: null,
        player2_individual_id: null,
        player3_individual_id: null,
        player4_individual_id: null,
        scheduled_time: '',
        court: ''
      });
      console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Added 7th/8th place match`);
    }
  }

  console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Total matches (group + knockout + placement): ${matches.length}`);
  return matches;
}

function generateSingleEliminationMatchesWithOptions(
  teams: Team[],
  matchNumberOffset: number = 0,
  isIndividualFormat: boolean = false,
  knockoutStage: 'final' | 'semifinals' | 'quarterfinals' | 'round_of_16' = 'semifinals'
): ScheduledMatch[] {
  const matches: ScheduledMatch[] = [];
  const teamCount = teams.length;
  if (teamCount < 2) return matches;

  const stageToRounds: Record<string, number> = {
    'final': 1,
    'semifinals': 2,
    'quarterfinals': 3,
    'round_of_16': 4
  };

  const maxRounds = stageToRounds[knockoutStage] || 2;

  let matchNumber = matchNumberOffset + 1;

  if (isIndividualFormat) {
    const effectiveTeamCount = Math.floor(teamCount / 4);
    const naturalRounds = Math.ceil(Math.log2(Math.max(effectiveTeamCount, 2)));
    const rounds = Math.min(naturalRounds, maxRounds);

    console.log(`[KNOCKOUT_OPTIONS] Individual 2v2 format: ${teamCount} players = ${effectiveTeamCount} matches worth, knockoutStage: ${knockoutStage}, rounds: ${rounds}`);
    console.log(`[KNOCKOUT_OPTIONS] Players received:`, teams.map((t, i) => ({ index: i, id: t.id, name: t.team_name, seed: t.seed })));

    for (let round = rounds - 1; round >= 0; round--) {
      let roundName: string;
      if (round === 0) {
        roundName = 'final';
      } else if (round === 1) {
        roundName = 'semifinal';
      } else if (round === 2) {
        roundName = 'quarterfinal';
      } else {
        const teamsInRound = Math.pow(2, round + 1);
        roundName = `round_of_${teamsInRound}`;
      }

      const matchesInRound = Math.pow(2, round);
      console.log(`[KNOCKOUT_OPTIONS] Round ${round} (${roundName}): generating ${matchesInRound} matches`);

      for (let i = 0; i < matchesInRound; i++) {
        let p1: string | null = null;
        let p2: string | null = null;
        let p3: string | null = null;
        let p4: string | null = null;

        if (round === rounds - 1) {
          const baseIdx = i * 4;
          if (baseIdx < teamCount) p1 = teams[baseIdx].id;
          if (baseIdx + 1 < teamCount) p2 = teams[baseIdx + 1].id;
          if (baseIdx + 2 < teamCount) p3 = teams[baseIdx + 2].id;
          if (baseIdx + 3 < teamCount) p4 = teams[baseIdx + 3].id;
          console.log(`[KNOCKOUT_OPTIONS] First round match ${i + 1}: p1=${p1}, p2=${p2} vs p3=${p3}, p4=${p4}`);
        }

        matches.push({
          round: roundName,
          match_number: matchNumber++,
          team1_id: null,
          team2_id: null,
          player1_individual_id: p1,
          player2_individual_id: p2,
          player3_individual_id: p3,
          player4_individual_id: p4,
          scheduled_time: '',
          court: ''
        });
      }
    }

    if (rounds >= 2) {
      matches.push({
        round: '3rd_place',
        match_number: matchNumber++,
        team1_id: null,
        team2_id: null,
        player1_individual_id: null,
        player2_individual_id: null,
        player3_individual_id: null,
        player4_individual_id: null,
        scheduled_time: '',
        court: ''
      });
      console.log(`[KNOCKOUT_OPTIONS] Added 3rd/4th place match`);
    }
  } else {
    const naturalRounds = Math.ceil(Math.log2(teamCount));
    const rounds = Math.min(naturalRounds, maxRounds);

    console.log(`[KNOCKOUT_OPTIONS] Team format: ${teamCount} teams, knockoutStage: ${knockoutStage}, rounds: ${rounds}`);
    console.log(`[KNOCKOUT_OPTIONS] Teams received:`, teams.map((t, i) => ({ index: i, id: t.id, name: t.team_name, seed: t.seed })));

    for (let round = rounds - 1; round >= 0; round--) {
      let roundName: string;
      if (round === 0) {
        roundName = 'final';
      } else if (round === 1) {
        roundName = 'semi_final';
      } else if (round === 2) {
        roundName = 'quarter_final';
      } else {
        const teamsInRound = Math.pow(2, round + 1);
        roundName = `round_of_${teamsInRound}`;
      }

      const matchesInRound = Math.pow(2, round);
      console.log(`[KNOCKOUT_OPTIONS] Round ${round} (${roundName}): generating ${matchesInRound} matches`);

      for (let i = 0; i < matchesInRound; i++) {
        let team1Id: string | null = null;
        let team2Id: string | null = null;

        if (round === rounds - 1) {
          if (i * 2 < teamCount) team1Id = teams[i * 2].id;
          if (i * 2 + 1 < teamCount) team2Id = teams[i * 2 + 1].id;
          console.log(`[KNOCKOUT_OPTIONS] First round match ${i + 1}: team1=${team1Id}, team2=${team2Id}`);
        }

        matches.push({
          round: roundName,
          match_number: matchNumber++,
          team1_id: team1Id,
          team2_id: team2Id,
          scheduled_time: '',
          court: ''
        });
      }
    }
  }

  console.log(`[KNOCKOUT_OPTIONS] Total knockout matches generated: ${matches.length}`);
  return matches;
}

function generateSingleEliminationMatches(teams: Team[], matchNumberOffset: number = 0): ScheduledMatch[] {
  const matches: ScheduledMatch[] = [];
  const teamCount = teams.length;
  if (teamCount < 2) return matches;

  const rounds = Math.ceil(Math.log2(teamCount));
  let matchNumber = matchNumberOffset + 1;

  console.log(`[KNOCKOUT] Generating knockout with ${teamCount} teams, ${rounds} rounds, starting match ${matchNumber}`);
  console.log(`[KNOCKOUT] Teams received:`, teams.map((t, i) => ({ index: i, id: t.id, name: t.team_name, seed: t.seed })));

  for (let round = rounds - 1; round >= 0; round--) {
    let roundName: string;
    if (round === 0) {
      roundName = 'final';
    } else if (round === 1) {
      roundName = 'semi_final';
    } else if (round === 2) {
      roundName = 'quarter_final';
    } else {
      const teamsInRound = Math.pow(2, round + 1);
      roundName = `round_of_${teamsInRound}`;
    }

    const matchesInRound = Math.pow(2, round);

    console.log(`[KNOCKOUT] Round ${round} (${roundName}): generating ${matchesInRound} matches`);

    for (let i = 0; i < matchesInRound; i++) {
      let team1_id: string | null = null;
      let team2_id: string | null = null;

      if (round === rounds - 1) {
        if (i * 2 < teamCount) team1_id = teams[i * 2].id;
        if (i * 2 + 1 < teamCount) team2_id = teams[i * 2 + 1].id;
        console.log(`[KNOCKOUT] First round match ${i + 1}: team1_id=${team1_id}, team2_id=${team2_id}`);
      }

      matches.push({
        round: roundName,
        match_number: matchNumber++,
        team1_id,
        team2_id,
        scheduled_time: '',
        court: ''
      });
    }
  }

  console.log(`[KNOCKOUT] Total knockout matches generated: ${matches.length}`);
  return matches;
}

function generateRoundRobinMatches(teams: Team[], matchNumberOffset: number = 0, isAmerican: boolean = false, rounds: number = 7, startDate: string = '2024-01-01'): ScheduledMatch[] {
  const matches: ScheduledMatch[] = [];
  const teamCount = teams.length;
  if (teamCount < 2) return matches;

  let matchNumber = matchNumberOffset + 1;

  console.log(`[ROUND_ROBIN] Generating round robin with ${teamCount} teams/players, starting match ${matchNumber}, American: ${isAmerican}, Rounds: ${rounds}`);

  if (isAmerican && teamCount >= 4) {
    const players = teams.map(t => ({ id: t.id, name: t.team_name }));
    const americanMatches = generateAmericanSchedule(
      players,
      1,
      startDate,
      '09:00',
      '21:00',
      90,
      rounds
    );

    americanMatches.forEach((match, idx) => {
      matches.push({
        round: 'group_stage',
        match_number: matchNumber + idx,
        team1_id: null,
        team2_id: null,
        player1_individual_id: match.player1_id,
        player2_individual_id: match.player2_id,
        player3_individual_id: match.player3_id,
        player4_individual_id: match.player4_id,
        scheduled_time: '',
        court: ''
      });
    });
  } else {
    const rrRounds = generateRoundRobinRounds(teams);
    rrRounds.forEach(roundMatches => {
      roundMatches.forEach(m => {
        matches.push({
          round: 'group_stage',
          match_number: matchNumber++,
          team1_id: m.team1.id,
          team2_id: m.team2.id,
          scheduled_time: '',
          court: ''
        });
      });
    });
  }

  console.log(`[ROUND_ROBIN] Total matches generated: ${matches.length}`);
  return matches;
}

function generateRoundRobinRounds(teams: Team[]): Array<Array<{team1: Team, team2: Team}>> {
  const n = teams.length;
  const isOdd = n % 2 === 1;
  const teamList = [...teams];

  if (isOdd) {
    teamList.push({ id: 'BYE', team_name: 'BYE', seed: 999 } as Team);
  }

  const numTeams = teamList.length;
  const numRounds = numTeams - 1;
  const matchesPerRound = numTeams / 2;
  const rounds: Array<Array<{team1: Team, team2: Team}>> = [];

  for (let round = 0; round < numRounds; round++) {
    const roundMatches: Array<{team1: Team, team2: Team}> = [];

    for (let match = 0; match < matchesPerRound; match++) {
      let home: number, away: number;

      if (match === 0) {
        home = 0;
        away = numTeams - 1 - round;
        if (away === 0) away = numTeams - 1;
      } else {
        home = (round + match) % (numTeams - 1);
        if (home === 0) home = numTeams - 1;
        away = (round + numTeams - 1 - match) % (numTeams - 1);
        if (away === 0) away = numTeams - 1;
      }

      const team1 = teamList[home];
      const team2 = teamList[away];

      if (team1.id !== 'BYE' && team2.id !== 'BYE') {
        roundMatches.push({ team1, team2 });
      }
    }

    rounds.push(roundMatches);
  }

  console.log(`[ROUND_ROBIN_ROUNDS] Generated ${rounds.length} rounds for ${n} teams`);
  rounds.forEach((r, i) => {
    console.log(`[ROUND_ROBIN_ROUNDS] Round ${i + 1}: ${r.map(m => `${m.team1.team_name} vs ${m.team2.team_name}`).join(', ')}`);
  });

  return rounds;
}

function generateGroupKnockoutMatches(teams: Team[], numberOfCourts: number, matchDurationMinutes: number): ScheduledMatch[] {
  const matches: ScheduledMatch[] = [];
  const teamsByGroup = new Map<string, Team[]>();

  console.log('[MULTI-CAT V2] generateGroupKnockoutMatches called with', teams.length, 'teams');

  teams.forEach(team => {
    if (team.group_name) {
      if (!teamsByGroup.has(team.group_name)) {
        teamsByGroup.set(team.group_name, []);
      }
      teamsByGroup.get(team.group_name)!.push(team);
    }
  });

  let matchNumber = 1;
  const sortedGroups = Array.from(teamsByGroup.keys()).sort();
  console.log('[MULTI-CAT V2] Groups found:', sortedGroups);

  const roundsByGroup = new Map<string, Array<Array<{team1: Team, team2: Team}>>>();
  let maxRounds = 0;

  sortedGroups.forEach(groupName => {
    const groupTeams = teamsByGroup.get(groupName)!;
    console.log(`[MULTI-CAT V2] Group ${groupName}: ${groupTeams.length} teams`);

    const rounds = generateRoundRobinRounds(groupTeams);
    roundsByGroup.set(groupName, rounds);
    maxRounds = Math.max(maxRounds, rounds.length);
  });

  for (let roundIdx = 0; roundIdx < maxRounds; roundIdx++) {
    sortedGroups.forEach(groupName => {
      const rounds = roundsByGroup.get(groupName)!;
      if (roundIdx < rounds.length) {
        const roundMatches = rounds[roundIdx];
        roundMatches.forEach(m => {
          matches.push({
            round: 'group_stage',
            match_number: matchNumber++,
            team1_id: m.team1.id,
            team2_id: m.team2.id,
            scheduled_time: '',
            court: ''
          });
        });
      }
    });
  }

  console.log('[MULTI-CAT V2] Generated', matches.length, 'group matches organized by rounds');
  return matches;
}
