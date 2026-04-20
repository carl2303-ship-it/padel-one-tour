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

const toLocalDateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface DailySchedule {
  date: string;
  start_time: string;
  end_time: string;
  court_names?: string[];
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
    const dateStr = toLocalDateStr(current);
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

function getDaySchedule(date: string, dailySchedules: DailySchedule[], defaultStart: string, defaultEnd: string): { start_time: string; end_time: string; court_names?: string[] } {
  if (dailySchedules && dailySchedules.length > 0) {
    const schedule = dailySchedules.find(s => s.date === date);
    if (schedule) {
      return { start_time: schedule.start_time, end_time: schedule.end_time, court_names: schedule.court_names };
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
  knockoutStage: string = 'semifinals',
  outdoorCourtIndices: Set<number> = new Set()
): ScheduledMatch[] {
  const sortedTeams = [...teams].sort((a, b) => (a.seed || 0) - (b.seed || 0));
  const matches: ScheduledMatch[] = [];

  if (format === 'single_elimination') {
    return generateSingleEliminationSchedule(sortedTeams, numberOfCourts, startDate, dailyStartTime, dailyEndTime, matchDurationMinutes, !!skipLaterRounds, dailySchedules);
  } else if (format === 'round_robin') {
    return generateRoundRobinSchedule(sortedTeams, numberOfCourts, startDate, dailyStartTime, dailyEndTime, matchDurationMinutes, dailySchedules, outdoorCourtIndices);
  } else if (format === 'groups_knockout') {
    return generateGroupStageSchedule(sortedTeams, numberOfCourts, startDate, dailyStartTime, dailyEndTime, matchDurationMinutes, dailySchedules, knockoutStage, outdoorCourtIndices);
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
      const slotIndex = globalTimeSlot + Math.floor(i / numberOfCourts);
      const courtIndex = i % numberOfCourts;
      const court = (((courtIndex + slotIndex) % numberOfCourts) + 1).toString();
      const totalMinutesFromStart = (slotIndex % slotsPerDay) * matchDurationMinutes;
      const hourOffset = Math.floor(totalMinutesFromStart / 60);
      const minuteOffset = totalMinutesFromStart % 60;
      const daysFromStart = Math.floor(slotIndex / slotsPerDay);

      const [year, month, day] = startDate.split('-').map(Number);
      const matchDate = new Date(year, month - 1, day + daysFromStart);
      const matchDateStr = toLocalDateStr(matchDate);
      const daySchedule = getDaySchedule(matchDateStr, dailySchedules, startTime, endTime);
      const [dayStartHour, dayStartMinute] = daySchedule.start_time.split(':').map(Number);

      const scheduledTime = new Date(year, month - 1, day + daysFromStart, dayStartHour + hourOffset, dayStartMinute + minuteOffset, 0, 0);

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
  dailySchedules: DailySchedule[] = [],
  outdoorCourtIndices: Set<number> = new Set()
): ScheduledMatch[] {
  const matches: ScheduledMatch[] = [];
  const teamCount = teams.length;

  if (teamCount < 2) return matches;

  const [defaultStartHour, defaultStartMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  const defaultStartTotalMin = defaultStartHour * 60 + defaultStartMinute;
  const defaultEndTotalMin = endHour * 60 + (endMinute || 0);
  let defaultAvailMin = defaultEndTotalMin - defaultStartTotalMin;
  if (defaultAvailMin <= 0) defaultAvailMin = (24 * 60 - defaultStartTotalMin) + defaultEndTotalMin;
  const defaultSlotsPerDay = Math.max(1, Math.floor(defaultAvailMin / matchDurationMinutes));

  const getDayConfig = (dateStr: string) => {
    const ds = dailySchedules.find(d => d.date === dateStr);
    if (ds) {
      const [sh, sm] = ds.start_time.split(':').map(Number);
      const [eh, em] = ds.end_time.split(':').map(Number);
      let avail = (eh * 60 + (em || 0)) - (sh * 60 + sm);
      if (avail <= 0) avail = (24 * 60 - (sh * 60 + sm)) + (eh * 60 + (em || 0));
      return { startHour: sh, startMinute: sm, slotsPerDay: Math.max(1, Math.floor(avail / matchDurationMinutes)) };
    }
    return { startHour: defaultStartHour, startMinute: defaultStartMinute, slotsPerDay: defaultSlotsPerDay };
  };

  const teamsForRotation = [...teams];
  const isOdd = teamCount % 2 === 1;
  if (isOdd) {
    teamsForRotation.push({ id: 'BYE', name: 'BYE' } as Team);
  }

  const n = teamsForRotation.length;
  const rounds = n - 1;
  const matchesPerRound = n / 2;
  const hasOutdoor = outdoorCourtIndices.size > 0;

  console.log('[SCHEDULER V3] Circle rotation:', teamCount, 'teams,', rounds, 'rounds,', matchesPerRound, 'matches per round');
  if (hasOutdoor) console.log('[SCHEDULER V3] Outdoor courts:', [...outdoorCourtIndices]);

  let matchNumber = 1;
  let timeSlotIndex = 0;

  // Track per-team outdoor count + per-court usage
  const teamOutdoorCount = new Map<string, number>();
  const getOutdoor = (tid: string) => teamOutdoorCount.get(tid) || 0;
  const addOutdoor = (tid: string) => teamOutdoorCount.set(tid, (teamOutdoorCount.get(tid) || 0) + 1);

  const teamCourtUsage = new Map<string, number[]>();
  const getUsage = (tid: string, c: number) => {
    const u = teamCourtUsage.get(tid);
    return u ? (u[c - 1] || 0) : 0;
  };
  const addUsage = (tid: string, c: number) => {
    if (!teamCourtUsage.has(tid)) teamCourtUsage.set(tid, new Array(numberOfCourts).fill(0));
    teamCourtUsage.get(tid)![c - 1]++;
  };

  for (let round = 0; round < rounds; round++) {
    console.log('[SCHEDULER V3] Round', round + 1);

    const roundMatches: Array<{ team1_id: string; team2_id: string }> = [];

    for (let i = 0; i < matchesPerRound; i++) {
      const team1 = teamsForRotation[i];
      const team2 = teamsForRotation[n - 1 - i];

      if (team1.id !== 'BYE' && team2.id !== 'BYE') {
        roundMatches.push({
          team1_id: team1.id,
          team2_id: team2.id
        });
      }
    }

    for (let matchIdx = 0; matchIdx < roundMatches.length; matchIdx += numberOfCourts) {
      const slotMatches = roundMatches.slice(matchIdx, matchIdx + numberOfCourts);

      let remainSlots = timeSlotIndex;
      let daysFromStart = 0;
      const [year, month, day] = startDate.split('-').map(Number);
      let slotDate = new Date(year, month - 1, day);
      let dayConf = getDayConfig(toLocalDateStr(slotDate));
      while (remainSlots >= dayConf.slotsPerDay) {
        remainSlots -= dayConf.slotsPerDay;
        daysFromStart++;
        slotDate = new Date(year, month - 1, day + daysFromStart);
        dayConf = getDayConfig(toLocalDateStr(slotDate));
      }
      const totalMinutesFromStart = remainSlots * matchDurationMinutes;
      const hourOffset = Math.floor(totalMinutesFromStart / 60);
      const minuteOffset = totalMinutesFromStart % 60;
      const scheduledTime = new Date(year, month - 1, day + daysFromStart, dayConf.startHour + hourOffset, dayConf.startMinute + minuteOffset, 0, 0);

      const slotSize = slotMatches.length;
      const courtOptions = Array.from({length: Math.min(slotSize, numberOfCourts)}, (_, i) => i + 1);
      let bestAssignment = [...courtOptions];
      let bestScore = Infinity;

      const scorePerm = (arr: number[]) => {
        let outdoorSum = 0;
        let indoorSum = 0;
        for (let i = 0; i < slotSize; i++) {
          const c = arr[i];
          const t1 = slotMatches[i].team1_id;
          const t2 = slotMatches[i].team2_id;
          if (hasOutdoor && outdoorCourtIndices.has(c)) {
            outdoorSum += getOutdoor(t1) + getOutdoor(t2);
          }
          indoorSum += getUsage(t1, c) + getUsage(t2, c);
        }
        return outdoorSum * 10000 + indoorSum;
      };

      if (courtOptions.length <= 8) {
        const tryPerms = (arr: number[], start: number) => {
          if (start === arr.length) {
            const score = scorePerm(arr);
            if (score < bestScore) { bestScore = score; bestAssignment = [...arr]; }
            return;
          }
          for (let i = start; i < arr.length; i++) {
            [arr[start], arr[i]] = [arr[i], arr[start]];
            tryPerms(arr, start + 1);
            [arr[start], arr[i]] = [arr[i], arr[start]];
          }
        };
        tryPerms(courtOptions, 0);
      } else {
        for (let iter = 0; iter < 10000; iter++) {
          const perm = [...courtOptions].sort(() => Math.random() - 0.5);
          const score = scorePerm(perm);
          if (score < bestScore) { bestScore = score; bestAssignment = [...perm]; }
        }
      }

      for (let i = 0; i < slotSize; i++) {
        const court = bestAssignment[i];
        addUsage(slotMatches[i].team1_id, court);
        addUsage(slotMatches[i].team2_id, court);
        if (hasOutdoor && outdoorCourtIndices.has(court)) {
          addOutdoor(slotMatches[i].team1_id);
          addOutdoor(slotMatches[i].team2_id);
        }
        matches.push({
          round: 'round_robin',
          match_number: matchNumber++,
          team1_id: slotMatches[i].team1_id,
          team2_id: slotMatches[i].team2_id,
          scheduled_time: scheduledTime.toISOString(),
          court: bestAssignment[i].toString()
        });
        console.log('[SCHEDULER V3] Slot', timeSlotIndex, 'Court', bestAssignment[i], ':', slotMatches[i].team1_id, 'vs', slotMatches[i].team2_id);
      }

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
  knockoutStage: string = 'semifinals',
  outdoorCourtIndices: Set<number> = new Set()
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

  // Track per-team outdoor count + per-court usage
  const gsHasOutdoor = outdoorCourtIndices.size > 0;
  const gsTeamOutdoor = new Map<string, number>();
  const gsGetOutdoor = (tid: string) => gsTeamOutdoor.get(tid) || 0;
  const gsAddOutdoor = (tid: string) => gsTeamOutdoor.set(tid, (gsTeamOutdoor.get(tid) || 0) + 1);

  const gsTeamCourtUsage = new Map<string, number[]>();
  const gsGetUsage = (tid: string, c: number) => {
    const u = gsTeamCourtUsage.get(tid);
    return u ? (u[c - 1] || 0) : 0;
  };
  const gsAddUsage = (tid: string, c: number) => {
    if (!gsTeamCourtUsage.has(tid)) gsTeamCourtUsage.set(tid, new Array(numberOfCourts).fill(0));
    gsTeamCourtUsage.get(tid)![c - 1]++;
  };

  const maxSlots = allMatches.length * 10;
  while (scheduledCount < allMatches.length && timeSlotIndex < maxSlots) {
    const teamsPlayingThisSlot = new Set<string>();

    console.log(`[GROUP STAGE V4] === TIME SLOT ${timeSlotIndex} === (${scheduledCount}/${allMatches.length} scheduled)`);

    // Collect eligible matches for this slot
    type SlotEntry = { matchItem: typeof allMatches[0]; team1Id: string; team2Id: string; forced: boolean };
    const slotEntries: SlotEntry[] = [];

    // First pass: with rest constraints
    for (let i = 0; i < allMatches.length && slotEntries.length < numberOfCourts; i++) {
      const matchItem = allMatches[i];
      if (matchItem.scheduled) continue;

      const { match } = matchItem;
      const team1Id = match.team1.id;
      const team2Id = match.team2.id;

      if (teamsPlayingThisSlot.has(team1Id) || teamsPlayingThisSlot.has(team2Id)) continue;

      const team1LastSlot = teamLastPlayed.get(team1Id) ?? -2;
      const team2LastSlot = teamLastPlayed.get(team2Id) ?? -2;
      const minRestSlots = 1;

      if (timeSlotIndex - team1LastSlot <= minRestSlots && team1LastSlot >= 0) continue;
      if (timeSlotIndex - team2LastSlot <= minRestSlots && team2LastSlot >= 0) continue;

      slotEntries.push({ matchItem, team1Id, team2Id, forced: false });
      teamsPlayingThisSlot.add(team1Id);
      teamsPlayingThisSlot.add(team2Id);
    }

    // Second pass: force without rest if nothing was found
    if (slotEntries.length === 0 && scheduledCount < allMatches.length) {
      console.log('[GROUP STAGE V4] ⚠️ Forcing matches without rest for slot', timeSlotIndex);
      for (let i = 0; i < allMatches.length && slotEntries.length < numberOfCourts; i++) {
        const matchItem = allMatches[i];
        if (matchItem.scheduled) continue;

        const { match } = matchItem;
        const team1Id = match.team1.id;
        const team2Id = match.team2.id;

        if (teamsPlayingThisSlot.has(team1Id) || teamsPlayingThisSlot.has(team2Id)) continue;

        slotEntries.push({ matchItem, team1Id, team2Id, forced: true });
        teamsPlayingThisSlot.add(team1Id);
        teamsPlayingThisSlot.add(team2Id);
      }
    }

    if (slotEntries.length > 0) {
      const sn = slotEntries.length;
      const allCourts = Array.from({length: numberOfCourts}, (_, i) => i + 1);
      const courtOpts = allCourts.slice(0, Math.max(sn, numberOfCourts));
      let bestAssign = courtOpts.slice(0, sn);
      let bestScore = Infinity;

      const scoreAssign = (arr: number[]) => {
        let outdoorSum = 0;
        let indoorSum = 0;
        for (let i = 0; i < sn; i++) {
          const c = arr[i];
          const t1 = slotEntries[i].team1Id;
          const t2 = slotEntries[i].team2Id;
          if (gsHasOutdoor && outdoorCourtIndices.has(c)) {
            outdoorSum += gsGetOutdoor(t1) + gsGetOutdoor(t2);
          }
          indoorSum += gsGetUsage(t1, c) + gsGetUsage(t2, c);
        }
        return outdoorSum * 10000 + indoorSum;
      };

      if (numberOfCourts <= 8) {
        const tryP = (arr: number[], start: number) => {
          if (start === sn) {
            const score = scoreAssign(arr.slice(0, sn));
            if (score < bestScore) { bestScore = score; bestAssign = arr.slice(0, sn); }
            return;
          }
          for (let i = start; i < arr.length; i++) {
            [arr[start], arr[i]] = [arr[i], arr[start]];
            tryP(arr, start + 1);
            [arr[start], arr[i]] = [arr[i], arr[start]];
          }
        };
        tryP([...courtOpts], 0);
      } else {
        for (let iter = 0; iter < 10000; iter++) {
          const perm = [...courtOpts].sort(() => Math.random() - 0.5).slice(0, sn);
          const score = scoreAssign(perm);
          if (score < bestScore) { bestScore = score; bestAssign = [...perm]; }
        }
      }

      const totalMinutesFromStart = (timeSlotIndex % slotsPerDay) * matchDurationMinutes;
      const hourOffset = Math.floor(totalMinutesFromStart / 60);
      const minuteOffset = totalMinutesFromStart % 60;
      const daysFromStart = Math.floor(timeSlotIndex / slotsPerDay);
      const [year, month, day] = startDate.split('-').map(Number);
      const scheduledTime = new Date(year, month - 1, day + daysFromStart, startHour + hourOffset, startMinute + minuteOffset, 0, 0);

      for (let i = 0; i < sn; i++) {
        const { matchItem, team1Id, team2Id, forced } = slotEntries[i];
        const court = bestAssign[i];

        gsAddUsage(team1Id, court);
        gsAddUsage(team2Id, court);
        if (gsHasOutdoor && outdoorCourtIndices.has(court)) {
          gsAddOutdoor(team1Id);
          gsAddOutdoor(team2Id);
        }

        scheduledMatches.push({
          round: 'group_stage',
          match_number: globalMatchNumber++,
          team1_id: team1Id,
          team2_id: team2Id,
          scheduled_time: scheduledTime.toISOString(),
          court: court.toString()
        });

        const label = forced ? '⚠️' : '✅';
        console.log(`[GROUP STAGE V4] ${label} Slot ${timeSlotIndex} Court ${court}: Group ${matchItem.group} - ${matchItem.match.team1.name} vs ${matchItem.match.team2.name}${forced ? ' (FORCED)' : ''}`);

        teamLastPlayed.set(team1Id, timeSlotIndex);
        teamLastPlayed.set(team2Id, timeSlotIndex);
        matchItem.scheduled = true;
        scheduledCount++;
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

  const [koEndH, koEndM] = endTime.split(':').map(Number);
  const [koStartH, koStartM] = startTime.split(':').map(Number);
  const advanceTime = () => {
    knockoutTime = new Date(knockoutTime.getTime() + matchDurationMinutes * 60000);
    const koEndMinutes = koEndH * 60 + (koEndM || 0);
    const currentMinutes = knockoutTime.getHours() * 60 + knockoutTime.getMinutes();
    if (currentMinutes >= koEndMinutes) {
      knockoutTime.setDate(knockoutTime.getDate() + 1);
      knockoutTime.setHours(koStartH, koStartM || 0, 0, 0);
    }
  };

  const matchesBefore = scheduledMatches.length;

  const addKnockoutRound = (roundName: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const courtIdx = i % numberOfCourts;
      addKnockoutMatch(roundName, (courtIdx + 1).toString());
      if (courtIdx === numberOfCourts - 1 || i === count - 1) {
        advanceTime();
      }
    }
  };

  if (knockoutStage === 'round_of_16') {
    addKnockoutRound('round_of_16', 8);
  }

  if (knockoutStage === 'quarterfinals' || knockoutStage === 'round_of_16') {
    addKnockoutRound('quarterfinal', 4);
  }

  addKnockoutMatch('semifinal', '1');
  addKnockoutMatch('semifinal', '2');
  advanceTime();

  addKnockoutMatch('3rd_place', '1');
  addKnockoutMatch('final', '2');

  const knockoutCount = scheduledMatches.length - matchesBefore;
  console.log(`[GROUP STAGE V4] Added ${knockoutCount} knockout matches (stage: ${knockoutStage})`);
  console.log('[GROUP STAGE V4] TOTAL matches (group + knockout):', scheduledMatches.length);
  
  return scheduledMatches;
}
