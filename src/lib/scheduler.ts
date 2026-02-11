export interface Team {
  id: string;
  name: string;
  seed?: number;
  group_name?: string;
}

export interface ScheduledMatch {
  round: string;
  match_number: number;
  team1_id: string | null;
  team2_id: string | null;
  player1_individual_id?: string | null;
  player2_individual_id?: string | null;
  player3_individual_id?: string | null;
  player4_individual_id?: string | null;
  player3_id?: string | null;
  player4_id?: string | null;
  scheduled_time: string;
  court: string;
}

export interface DailySchedule {
  date: string;
  start_time: string;
  end_time: string;
}

export interface TimeValidationResult {
  isValid: boolean;
  message: string;
  totalMatches: number;
  totalTimeNeeded: number;
  totalTimeAvailable: number;
  suggestedMatchDuration?: number;
}

/**
 * Calculates total number of matches for a tournament
 * @param numberOfTeams - Total number of teams
 * @param format - Tournament format
 * @param numberOfGroups - Number of groups (for groups_knockout)
 * @returns Total number of matches
 */
export function calculateTotalMatches(
  numberOfTeams: number,
  format: string,
  numberOfGroups?: number
): number {
  if (format === 'single_elimination') {
    // Single elimination: n-1 matches
    return numberOfTeams - 1;
  } else if (format === 'round_robin') {
    // Round robin: n*(n-1)/2 matches
    return (numberOfTeams * (numberOfTeams - 1)) / 2;
  } else if (format === 'groups_knockout') {
    if (!numberOfGroups) return 0;

    const teamsPerGroup = Math.ceil(numberOfTeams / numberOfGroups);

    // Group stage: each group plays round robin
    const groupMatches = numberOfGroups * ((teamsPerGroup * (teamsPerGroup - 1)) / 2);

    // Knockout stage: depends on how many qualify (we'll assume standard bracket)
    // For now, assume top 2 from each group = 2*numberOfGroups teams
    const knockoutTeams = Math.min(numberOfTeams, numberOfGroups * 2);
    const knockoutMatches = knockoutTeams - 1;

    return Math.floor(groupMatches + knockoutMatches);
  }

  return 0;
}

/**
 * Validates if there's enough time to fit all matches in the tournament schedule
 * @param totalMatches - Total number of matches to schedule
 * @param numberOfCourts - Number of courts available
 * @param startDate - Tournament start date
 * @param endDate - Tournament end date
 * @param dailyStartTime - Daily start time
 * @param dailyEndTime - Daily end time
 * @param matchDurationMinutes - Duration of each match in minutes
 * @param dailySchedules - Optional per-day schedule overrides
 * @returns Validation result with message and suggestions
 */
export function validateTournamentTime(
  totalMatches: number,
  numberOfCourts: number,
  startDate: string,
  endDate: string,
  dailyStartTime: string,
  dailyEndTime: string,
  matchDurationMinutes: number,
  dailySchedules: DailySchedule[] = []
): TimeValidationResult {
  const TRANSITION_TIME = 5; // 5 minutes between matches
  const effectiveMatchTime = matchDurationMinutes + TRANSITION_TIME;

  // Calculate total available time
  const start = new Date(startDate);
  const end = new Date(endDate);
  let totalMinutesAvailable = 0;

  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    const schedule = getDaySchedule(dateStr, dailySchedules, dailyStartTime, dailyEndTime);

    const [startHour, startMin] = schedule.start_time.split(':').map(Number);
    const [endHour, endMin] = schedule.end_time.split(':').map(Number);
    const dailyMinutes = (endHour * 60 + endMin) - (startHour * 60 + startMin);
    totalMinutesAvailable += dailyMinutes;

    current.setDate(current.getDate() + 1);
  }

  // Calculate total time needed (accounting for parallel courts)
  const totalTimeNeededMinutes = Math.ceil(totalMatches / numberOfCourts) * effectiveMatchTime;

  // Check if we have enough time
  if (totalTimeNeededMinutes <= totalMinutesAvailable) {
    return {
      isValid: true,
      message: 'Schedule is valid',
      totalMatches,
      totalTimeNeeded: totalTimeNeededMinutes,
      totalTimeAvailable: totalMinutesAvailable
    };
  }

  // Calculate suggested match duration
  const maxMatchesPerSlot = totalMatches / numberOfCourts;
  const availablePerMatch = totalMinutesAvailable / maxMatchesPerSlot;
  const suggestedDuration = Math.floor(availablePerMatch - TRANSITION_TIME);

  const hoursNeeded = Math.ceil(totalTimeNeededMinutes / 60);
  const hoursAvailable = Math.floor(totalMinutesAvailable / 60);

  return {
    isValid: false,
    message: `Not enough time! You need ${hoursNeeded}h but only have ${hoursAvailable}h available. Either increase tournament duration or reduce match time to ${suggestedDuration} minutes.`,
    totalMatches,
    totalTimeNeeded: totalTimeNeededMinutes,
    totalTimeAvailable: totalMinutesAvailable,
    suggestedMatchDuration: suggestedDuration > 0 ? suggestedDuration : 10
  };
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

export function generateTournamentSchedule(
  teams: Team[],
  numberOfCourts: number,
  startDate: string,
  format: string,
  dailyStartTime: string = '09:00',
  dailyEndTime: string = '21:00',
  matchDurationMinutes: number = 90,
  skipLaterRounds: any = false,
  dailySchedules: DailySchedule[] = [],
  knockoutStage: string = 'semifinals'
): ScheduledMatch[] {
  const sortedTeams = [...teams].sort((a, b) => (a.seed || 0) - (b.seed || 0));
  const matches: ScheduledMatch[] = [];

  if (format === 'single_elimination') {
    return generateSingleEliminationSchedule(sortedTeams, numberOfCourts, startDate, dailyStartTime, dailyEndTime, matchDurationMinutes, !!skipLaterRounds, dailySchedules);
  } else if (format === 'round_robin') {
    return generateRoundRobinSchedule(sortedTeams, numberOfCourts, startDate, dailyStartTime, dailyEndTime, matchDurationMinutes, dailySchedules);
  } else if (format === 'groups_knockout') {
    return generateGroupStageSchedule(sortedTeams, numberOfCourts, startDate, dailyStartTime, dailyEndTime, matchDurationMinutes, dailySchedules, knockoutStage);
  }

  return matches;
}

function generateSingleEliminationSchedule(
  teams: Team[],
  numberOfCourts: number,
  startDate: string,
  startTime: string,
  endTime: string,
  matchDurationMinutes: number,
  skipLaterRounds: boolean = false,
  dailySchedules: DailySchedule[] = []
): ScheduledMatch[] {
  const matches: ScheduledMatch[] = [];
  const teamCount = teams.length;

  if (teamCount < 2) return matches;

  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  const startTotalMinutes = startHour * 60 + startMinute;
  const endTotalMinutes = endHour * 60 + (endMinute || 0);
  let availableMinutesPerDay = endTotalMinutes - startTotalMinutes;
  if (availableMinutesPerDay <= 0) {
    availableMinutesPerDay = (24 * 60 - startTotalMinutes) + endTotalMinutes;
  }
  const slotsPerDay = Math.floor(availableMinutesPerDay / matchDurationMinutes);

  const rounds = Math.ceil(Math.log2(teamCount));

  let matchNumber = 1;
  let globalTimeSlot = 0;

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

    if (skipLaterRounds && (roundName === 'semi_final' || roundName === 'final')) {
      continue;
    }

    for (let i = 0; i < matchesInRound; i++) {
      const courtIndex = i % numberOfCourts;
      const court = (courtIndex + 1).toString();
      const slotIndex = globalTimeSlot + Math.floor(i / numberOfCourts);
      const totalMinutesFromStart = (slotIndex % slotsPerDay) * matchDurationMinutes;
      const hourOffset = Math.floor(totalMinutesFromStart / 60);
      const minuteOffset = totalMinutesFromStart % 60;
      const daysFromStart = Math.floor(slotIndex / slotsPerDay);

      const [year, month, day] = startDate.split('-').map(Number);
      const matchDate = new Date(year, month - 1, day + daysFromStart);
      const matchDateStr = matchDate.toISOString().split('T')[0];
      const daySchedule = getDaySchedule(matchDateStr, dailySchedules, startTime, endTime);
      const [dayStartHour, dayStartMinute] = daySchedule.start_time.split(':').map(Number);

      const scheduledTime = new Date(Date.UTC(year, month - 1, day + daysFromStart, dayStartHour + hourOffset, dayStartMinute + minuteOffset, 0, 0));

      let team1_id: string | null = null;
      let team2_id: string | null = null;

      if (round === rounds - 1) {
        if (i * 2 < teamCount) team1_id = teams[i * 2].id;
        if (i * 2 + 1 < teamCount) team2_id = teams[i * 2 + 1].id;
      }

      matches.push({
        round: roundName,
        match_number: matchNumber++,
        team1_id: team1_id,
        team2_id: team2_id,
        scheduled_time: scheduledTime.toISOString(),
        court: court
      });
    }

    globalTimeSlot += Math.ceil(matchesInRound / numberOfCourts);
  }

  return matches;
}

function generateRoundRobinSchedule(
  teams: Team[],
  numberOfCourts: number,
  startDate: string,
  startTime: string,
  endTime: string,
  matchDurationMinutes: number,
  dailySchedules: DailySchedule[] = []
): ScheduledMatch[] {
  const matches: ScheduledMatch[] = [];
  const teamCount = teams.length;

  if (teamCount < 2) return matches;

  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  const startTotalMinutes = startHour * 60 + startMinute;
  const endTotalMinutes = endHour * 60 + (endMinute || 0);
  let availableMinutesPerDay = endTotalMinutes - startTotalMinutes;
  if (availableMinutesPerDay <= 0) {
    availableMinutesPerDay = (24 * 60 - startTotalMinutes) + endTotalMinutes;
  }
  const slotsPerDay = Math.floor(availableMinutesPerDay / matchDurationMinutes);

  // Use circle rotation method for optimal round-robin scheduling
  // If odd number of teams, add a dummy team for "bye"
  const teamsForRotation = [...teams];
  const isOdd = teamCount % 2 === 1;
  if (isOdd) {
    teamsForRotation.push({ id: 'BYE', name: 'BYE' } as Team);
  }

  const n = teamsForRotation.length;
  const rounds = n - 1;
  const matchesPerRound = n / 2;

  console.log('[SCHEDULER V3] Circle rotation:', teamCount, 'teams,', rounds, 'rounds,', matchesPerRound, 'matches per round');

  let matchNumber = 1;
  let timeSlotIndex = 0;

  // Generate rounds using circle rotation
  for (let round = 0; round < rounds; round++) {
    console.log('[SCHEDULER V3] Round', round + 1);

    const roundMatches: Array<{ team1_id: string; team2_id: string }> = [];

    // In each round, pair teams: first with last, second with second-to-last, etc.
    for (let i = 0; i < matchesPerRound; i++) {
      const team1 = teamsForRotation[i];
      const team2 = teamsForRotation[n - 1 - i];

      // Skip matches involving the BYE team
      if (team1.id !== 'BYE' && team2.id !== 'BYE') {
        roundMatches.push({
          team1_id: team1.id,
          team2_id: team2.id
        });
      }
    }

    // Schedule round matches across multiple time slots if needed
    for (let matchIdx = 0; matchIdx < roundMatches.length; matchIdx += numberOfCourts) {
      const slotMatches = roundMatches.slice(matchIdx, matchIdx + numberOfCourts);

      // Calculate scheduled time
      const totalMinutesFromStart = (timeSlotIndex % slotsPerDay) * matchDurationMinutes;
      const hourOffset = Math.floor(totalMinutesFromStart / 60);
      const minuteOffset = totalMinutesFromStart % 60;
      const daysFromStart = Math.floor(timeSlotIndex / slotsPerDay);

      const [year, month, day] = startDate.split('-').map(Number);
      const scheduledTime = new Date(Date.UTC(year, month - 1, day + daysFromStart, startHour + hourOffset, startMinute + minuteOffset, 0, 0));

      slotMatches.forEach((match, courtIdx) => {
        matches.push({
          round: 'round_robin',
          match_number: matchNumber++,
          team1_id: match.team1_id,
          team2_id: match.team2_id,
          scheduled_time: scheduledTime.toISOString(),
          court: (courtIdx + 1).toString()
        });

        console.log('[SCHEDULER V3] Slot', timeSlotIndex, 'Court', courtIdx + 1, ':', match.team1_id, 'vs', match.team2_id);
      });

      timeSlotIndex++;
    }

    // Rotate teams (keep first team fixed, rotate others)
    if (round < rounds - 1) {
      const fixed = teamsForRotation[0];
      const rotating = teamsForRotation.slice(1);
      // Move last team to second position, shift others down
      rotating.unshift(rotating.pop()!);
      teamsForRotation.splice(0, teamsForRotation.length, fixed, ...rotating);
    }
  }

  console.log('[SCHEDULER V3] COMPLETE! Total matches scheduled:', matches.length);
  return matches;
}

function generateGroupStageSchedule(
  teams: Team[],
  numberOfCourts: number,
  startDate: string,
  startTime: string,
  endTime: string,
  matchDurationMinutes: number,
  dailySchedules: DailySchedule[] = [],
  knockoutStage: string = 'semifinals'
): ScheduledMatch[] {
  console.log('[GROUP STAGE] Starting group stage scheduling for', teams.length, 'teams');

  const teamsByGroup = new Map<string, Team[]>();
  teams.forEach(team => {
    if (team.group_name) {
      if (!teamsByGroup.has(team.group_name)) {
        teamsByGroup.set(team.group_name, []);
      }
      teamsByGroup.get(team.group_name)!.push(team);
    }
  });

  console.log('[GROUP STAGE] Found', teamsByGroup.size, 'groups');

  // Generate matches for each group
  const sortedGroups = Array.from(teamsByGroup.keys()).sort();
  const matchesByGroup = new Map<string, Array<{ team1: Team; team2: Team }>>();

  sortedGroups.forEach(groupName => {
    const groupTeams = teamsByGroup.get(groupName)!;
    const matches: Array<{ team1: Team; team2: Team }> = [];
    for (let i = 0; i < groupTeams.length; i++) {
      for (let j = i + 1; j < groupTeams.length; j++) {
        matches.push({ team1: groupTeams[i], team2: groupTeams[j] });
      }
    }
    matchesByGroup.set(groupName, matches);
  });

  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  const startTotalMinutes = startHour * 60 + startMinute;
  const endTotalMinutes = endHour * 60 + (endMinute || 0);
  let availableMinutesPerDay = endTotalMinutes - startTotalMinutes;
  if (availableMinutesPerDay <= 0) {
    availableMinutesPerDay = (24 * 60 - startTotalMinutes) + endTotalMinutes;
  }
  const slotsPerDay = Math.floor(availableMinutesPerDay / matchDurationMinutes);

  const scheduledMatches: ScheduledMatch[] = [];
  let globalMatchNumber = 1;

  // Track current match index for each group
  const groupMatchIndex = new Map<string, number>();
  sortedGroups.forEach(group => groupMatchIndex.set(group, 0));

  // Track when each team last played (time slot index)
  const teamLastPlayed = new Map<string, number>();

  // Create a list of all matches to schedule with index
  const allMatches: Array<{ group: string; match: { team1: Team; team2: Team }; scheduled: boolean; index: number }> = [];
  let matchIndex = 0;
  sortedGroups.forEach(groupName => {
    const matches = matchesByGroup.get(groupName)!;
    matches.forEach(match => {
      allMatches.push({ group: groupName, match, scheduled: false, index: matchIndex++ });
    });
  });

  console.log('[GROUP STAGE V4] Total matches to schedule:', allMatches.length);
  console.log('[GROUP STAGE V4] Groups:', sortedGroups);
  console.log('[GROUP STAGE V4] Courts:', numberOfCourts);

  let timeSlotIndex = 0;
  let scheduledCount = 0;

  while (scheduledCount < allMatches.length) {
    const teamsPlayingThisSlot = new Set<string>();
    let courtCounter = 0;

    console.log(`[GROUP STAGE V4] === TIME SLOT ${timeSlotIndex} === (${scheduledCount}/${allMatches.length} scheduled)`);

    // Try to fill all courts in this time slot
    for (let i = 0; i < allMatches.length && courtCounter < numberOfCourts; i++) {
      const matchItem = allMatches[i];

      if (matchItem.scheduled) continue;

      const { group, match } = matchItem;
      const team1Id = match.team1.id;
      const team2Id = match.team2.id;

      // Check if either team is already playing in this slot
      if (teamsPlayingThisSlot.has(team1Id) || teamsPlayingThisSlot.has(team2Id)) {
        continue;
      }

      // Check if teams have minimum rest (at least 1 slot between matches when possible)
      const team1LastSlot = teamLastPlayed.get(team1Id) ?? -2;
      const team2LastSlot = teamLastPlayed.get(team2Id) ?? -2;
      const minRestSlots = 1;

      if (timeSlotIndex - team1LastSlot <= minRestSlots && team1LastSlot >= 0) {
        // Team 1 needs more rest, try to skip this match for now
        continue;
      }
      if (timeSlotIndex - team2LastSlot <= minRestSlots && team2LastSlot >= 0) {
        // Team 2 needs more rest, try to skip this match for now
        continue;
      }

      // Schedule this match
      const court = courtCounter + 1;

      // Calculate time
      const totalMinutesFromStart = (timeSlotIndex % slotsPerDay) * matchDurationMinutes;
      const hourOffset = Math.floor(totalMinutesFromStart / 60);
      const minuteOffset = totalMinutesFromStart % 60;
      const daysFromStart = Math.floor(timeSlotIndex / slotsPerDay);

      const [year, month, day] = startDate.split('-').map(Number);
      const scheduledTime = new Date(year, month - 1, day + daysFromStart, startHour + hourOffset, startMinute + minuteOffset, 0, 0);

      scheduledMatches.push({
        round: 'group_stage',
        match_number: globalMatchNumber++,
        team1_id: team1Id,
        team2_id: team2Id,
        scheduled_time: scheduledTime.toISOString(),
        court: court.toString()
      });

      console.log(`[GROUP STAGE V4] ✅ Slot ${timeSlotIndex} Court ${court}: Group ${group} - ${match.team1.name} vs ${match.team2.name}`);

      // Mark teams as playing
      teamsPlayingThisSlot.add(team1Id);
      teamsPlayingThisSlot.add(team2Id);
      teamLastPlayed.set(team1Id, timeSlotIndex);
      teamLastPlayed.set(team2Id, timeSlotIndex);

      // Mark as scheduled
      matchItem.scheduled = true;
      scheduledCount++;
      courtCounter++;
    }

    // If no courts were filled, force schedule without rest requirements
    if (courtCounter === 0 && scheduledCount < allMatches.length) {
      console.log('[GROUP STAGE V4] ⚠️ Forcing matches without rest for slot', timeSlotIndex);

      for (let i = 0; i < allMatches.length && courtCounter < numberOfCourts; i++) {
        const matchItem = allMatches[i];

        if (matchItem.scheduled) continue;

        const { group, match } = matchItem;
        const team1Id = match.team1.id;
        const team2Id = match.team2.id;

        // Only check if already playing in THIS slot
        if (teamsPlayingThisSlot.has(team1Id) || teamsPlayingThisSlot.has(team2Id)) {
          continue;
        }

        const court = courtCounter + 1;
        const totalMinutesFromStart = (timeSlotIndex % slotsPerDay) * matchDurationMinutes;
        const hourOffset = Math.floor(totalMinutesFromStart / 60);
        const minuteOffset = totalMinutesFromStart % 60;
        const daysFromStart = Math.floor(timeSlotIndex / slotsPerDay);

        const [year, month, day] = startDate.split('-').map(Number);
        const scheduledTime = new Date(year, month - 1, day + daysFromStart, startHour + hourOffset, startMinute + minuteOffset, 0, 0);

        scheduledMatches.push({
          round: 'group_stage',
          match_number: globalMatchNumber++,
          team1_id: team1Id,
          team2_id: team2Id,
          scheduled_time: scheduledTime.toISOString(),
          court: court.toString()
        });

        console.log(`[GROUP STAGE V4] ⚠️ Slot ${timeSlotIndex} Court ${court}: Group ${group} - ${match.team1.name} vs ${match.team2.name} (FORCED)`);

        teamsPlayingThisSlot.add(team1Id);
        teamsPlayingThisSlot.add(team2Id);
        teamLastPlayed.set(team1Id, timeSlotIndex);
        teamLastPlayed.set(team2Id, timeSlotIndex);

        matchItem.scheduled = true;
        scheduledCount++;
        courtCounter++;
      }
    }

    timeSlotIndex++;
  }

  console.log('[GROUP STAGE V4] ✅ COMPLETE! Total group matches scheduled:', scheduledMatches.length);
  
  console.log('[GROUP STAGE V4] Adding knockout stage matches for stage:', knockoutStage);

  const lastGroupMatchTime = scheduledMatches.length > 0
    ? new Date(scheduledMatches[scheduledMatches.length - 1].scheduled_time)
    : new Date(`${startDate}T${startTime}:00`);

  let knockoutTime = new Date(lastGroupMatchTime.getTime() + matchDurationMinutes * 60000);

  const addKnockoutMatch = (round: string, court: string) => {
    scheduledMatches.push({
      round,
      match_number: globalMatchNumber++,
      team1_id: null,
      team2_id: null,
      scheduled_time: knockoutTime.toISOString(),
      court
    });
  };

  const advanceTime = () => {
    knockoutTime = new Date(knockoutTime.getTime() + matchDurationMinutes * 60000);
  };

  if (knockoutStage === 'quarterfinals') {
    for (let i = 0; i < 4; i++) {
      addKnockoutMatch('quarterfinal', ((i % Math.min(numberOfCourts, 4)) + 1).toString());
    }
    advanceTime();
  }

  addKnockoutMatch('semifinal', '1');
  addKnockoutMatch('semifinal', '2');
  advanceTime();

  addKnockoutMatch('3rd_place', '1');
  addKnockoutMatch('final', '2');

  const knockoutCount = scheduledMatches.length - (scheduledMatches.length - (knockoutStage === 'quarterfinals' ? 8 : 4));
  console.log(`[GROUP STAGE V4] Added ${knockoutCount} knockout matches (stage: ${knockoutStage})`);
  console.log('[GROUP STAGE V4] TOTAL matches (group + knockout):', scheduledMatches.length);
  
  return scheduledMatches;
}
