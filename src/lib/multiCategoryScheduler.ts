import { Team, ScheduledMatch, DailySchedule } from './scheduler';
import { generateAmericanSchedule } from './americanScheduler';
import { CategoryScheduleEntry } from './supabase';

interface CategoryScheduleRequest {
  categoryId: string;
  teams: Team[];
  format: string;
  knockoutTeams?: Team[];
  isAmerican?: boolean;
  rounds?: number;
  isIndividualFormat?: boolean;
  knockoutStage?: 'final' | 'semifinals' | 'quarterfinals' | 'round_of_16';
  courtNames?: string[];
  categorySchedule?: CategoryScheduleEntry[] | null; // Per-category day/time schedule
  matchDurationMinutes?: number | null; // Per-category match duration
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
  let currentDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  let maxDays = 365;

  while (maxDays-- > 0) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const dayInfo = calculateSlotsForDay(dateStr, dailySchedules, defaultStart, defaultEnd, matchDurationMinutes);

    if (dayInfo.slotsPerDay <= 0) {
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      continue;
    }

    if (remainingSlots < dayInfo.slotsPerDay) {
      return { dateStr, slotInDay: remainingSlots, startHour: dayInfo.startHour, startMinute: dayInfo.startMinute };
    }

    remainingSlots -= dayInfo.slotsPerDay;
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }
  const fallbackDate = currentDate.toISOString().split('T')[0];
  const fallbackInfo = calculateSlotsForDay(fallbackDate, dailySchedules, defaultStart, defaultEnd, matchDurationMinutes);
  return { dateStr: fallbackDate, slotInDay: 0, startHour: fallbackInfo.startHour, startMinute: fallbackInfo.startMinute };
}

// ===========================
// Per-Category Schedule Slots
// ===========================

interface TimeSlot {
  time: string; // ISO string
  dateStr: string;
}

/**
 * Generate all available time slots for a category based on its own schedule.
 * Each slot is a match start time within the category's configured dates/times.
 */
function generateCategoryTimeSlots(
  categorySchedule: CategoryScheduleEntry[],
  matchDurationMinutes: number
): TimeSlot[] {
  const slots: TimeSlot[] = [];

  // Sort entries by date, then start_time
  const sortedEntries = [...categorySchedule].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.start_time.localeCompare(b.start_time);
  });

  for (const entry of sortedEntries) {
    const [startHour, startMinute] = entry.start_time.split(':').map(Number);
    const [endHour, endMinute] = entry.end_time.split(':').map(Number);
    const startTotalMinutes = startHour * 60 + startMinute;
    const endTotalMinutes = endHour * 60 + (endMinute || 0);
    let availableMinutes = endTotalMinutes - startTotalMinutes;
    if (availableMinutes <= 0) {
      availableMinutes = (24 * 60 - startTotalMinutes) + endTotalMinutes;
    }
    const slotsCount = Math.floor(availableMinutes / matchDurationMinutes);

    const [year, month, day] = entry.date.split('-').map(Number);

    for (let i = 0; i < slotsCount; i++) {
      const totalMinutes = startTotalMinutes + i * matchDurationMinutes;
      const h = Math.floor(totalMinutes / 60) % 24;
      const m = totalMinutes % 60;
      const slotTime = new Date(year, month - 1, day, h, m, 0, 0);
      slots.push({
        time: slotTime.toISOString(),
        dateStr: entry.date
      });
    }
  }

  return slots;
}

export function scheduleMultipleCategories(
  categories: CategoryScheduleRequest[],
  numberOfCourts: number,
  startDate: string,
  dailyStartTime: string = '09:00',
  dailyEndTime: string = '21:00',
  matchDurationMinutes: number = 90,
  existingMatches: ScheduledMatch[] = [],
  dailySchedules: DailySchedule[] = [],
  allCourtNames: string[] = []
): Map<string, ScheduledMatch[]> {
  console.log('[MULTI-CAT V6] Starting with category-specific courts + schedules');
  console.log('[MULTI-CAT V6] All court names:', allCourtNames);
  
  // Check if any category has its own schedule
  const hasCategorySchedules = categories.some(cat => cat.categorySchedule && cat.categorySchedule.length > 0);
  console.log('[MULTI-CAT V6] Has per-category schedules:', hasCategorySchedules);
  
  // Build a map of category -> allowed court numbers and names
  const categoryCourtMap = new Map<string, { courtNumbers: number[]; courtNames: string[] }>();
  
  // Build a map of category -> own time slots (if has categorySchedule)
  const categoryTimeSlotsMap = new Map<string, TimeSlot[]>();
  // Per-category match duration
  const categoryDurationMap = new Map<string, number>();
  
  categories.forEach(cat => {
    // Match duration: per-category overrides global
    const catDuration = cat.matchDurationMinutes || matchDurationMinutes;
    categoryDurationMap.set(cat.categoryId, catDuration);
    
    if (cat.courtNames && cat.courtNames.length > 0) {
      // Category has specific courts assigned
      const courtNumbers: number[] = [];
      const courtNames: string[] = [];
      
      cat.courtNames.forEach(courtName => {
        const courtIndex = allCourtNames.indexOf(courtName);
        if (courtIndex >= 0) {
          courtNumbers.push(courtIndex + 1); // Convert to 1-based court number
          courtNames.push(courtName);
        }
      });
      
      categoryCourtMap.set(cat.categoryId, { courtNumbers, courtNames });
      console.log(`[MULTI-CAT V6] Category ${cat.categoryId}: using courts ${courtNames.join(', ')} (${courtNumbers.join(', ')})`);
    } else {
      // Category uses all courts
      const allNumbers = Array.from({ length: numberOfCourts }, (_, i) => i + 1);
      categoryCourtMap.set(cat.categoryId, { courtNumbers: allNumbers, courtNames: allCourtNames });
      console.log(`[MULTI-CAT V6] Category ${cat.categoryId}: using all ${numberOfCourts} courts`);
    }
    
    // Generate time slots if category has its own schedule
    if (cat.categorySchedule && cat.categorySchedule.length > 0) {
      const slots = generateCategoryTimeSlots(cat.categorySchedule, catDuration);
      categoryTimeSlotsMap.set(cat.categoryId, slots);
      console.log(`[MULTI-CAT V6] Category ${cat.categoryId}: ${slots.length} own time slots across ${cat.categorySchedule.length} day(s)`);
      cat.categorySchedule.forEach(entry => {
        console.log(`[MULTI-CAT V6]   ${entry.date}: ${entry.start_time} – ${entry.end_time}`);
      });
    }
  });

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

  // Include ALL categories (not just those with group matches) so knockout-only categories are also tracked
  const uniqueCategories = [...new Set(allMatches.map(m => m.categoryId))].sort();
  console.log('[MULTI-CAT V3] Categories:', uniqueCategories);
  console.log('[MULTI-CAT V3] Starting scheduler with', allMatches.length, 'matches across', categories.length, 'categories');
  console.log(`[MULTI-CAT V3] ${groupMatches.length} group matches, ${knockoutMatches.length} knockout matches`);
  console.log(`[MULTI-CAT V3] Courts available: ${numberOfCourts}`);

  // PHASE 1: Schedule group stage matches
  // If categories have their own schedules, schedule each category independently
  // Otherwise, use the shared global schedule with court rotation
  
  if (hasCategorySchedules) {
    // ============================
    // MODE A: Per-Category Schedule
    // Each category has its own time window(s) and is scheduled independently
    // ============================
    console.log('[MULTI-CAT V6] MODE A: Scheduling each category in its own time window');

    for (const categoryId of uniqueCategories) {
      const catGroupMatches = groupMatches.filter(m => m.categoryId === categoryId);
      if (catGroupMatches.length === 0) continue;

      const catSlots = categoryTimeSlotsMap.get(categoryId);
      const catDuration = categoryDurationMap.get(categoryId) || matchDurationMinutes;
      const categoryInfo = categoryCourtMap.get(categoryId);
      const catCourts = categoryInfo ? categoryInfo.courtNumbers : Array.from({ length: numberOfCourts }, (_, i) => i + 1);
      const catCourtNames = categoryInfo ? categoryInfo.courtNames : allCourtNames;

      if (!catSlots || catSlots.length === 0) {
        // Fallback: use global schedule for this category
        console.log(`[MULTI-CAT V6] Category ${categoryId.substring(0, 8)}: no own schedule, using global slots`);
        let catSlotIndex = currentTimeSlot;
        const catPlayersThisSlot = new Set<string>();
        let catIter = 0;
        
        while (catIter < maxIterations) {
          catIter++;
          const anyRemaining = catGroupMatches.some(m => !scheduledMatchIds.has(`${m.categoryId}_${m.match_number}`));
          if (!anyRemaining) break;

          const slotInfo = getDateForSlot(startDate, catSlotIndex, dailySchedules, dailyStartTime, dailyEndTime, catDuration);
          const totalMinutesFromStart = slotInfo.slotInDay * catDuration;
          const hourOffset = Math.floor(totalMinutesFromStart / 60);
          const minuteOffset = totalMinutesFromStart % 60;
          const [year, month, day] = slotInfo.dateStr.split('-').map(Number);
          const scheduledTime = new Date(year, month - 1, day, slotInfo.startHour + hourOffset, slotInfo.startMinute + minuteOffset, 0, 0);
          const timeStr = scheduledTime.toISOString();

          catPlayersThisSlot.clear();
          let matchesThisSlot = 0;

          for (const court of catCourts) {
            const slotKey = `${timeStr}_${court}`;
            if (occupiedSlots.has(slotKey)) continue;

            let matchToSchedule: typeof catGroupMatches[0] | undefined;
            for (const match of catGroupMatches) {
              const matchId = `${match.categoryId}_${match.match_number}`;
              if (scheduledMatchIds.has(matchId)) continue;
              const playerIds = getMatchPlayerIds(match);
              if (playerIds.some(id => catPlayersThisSlot.has(id))) continue;
              matchToSchedule = match;
              break;
            }

            if (matchToSchedule) {
              const { categoryId: cId, duration, ...matchData } = matchToSchedule;
              const courtIdx = categoryInfo ? categoryInfo.courtNumbers.indexOf(court) : court - 1;
              const courtName = catCourtNames[courtIdx] || court.toString();
              const scheduledMatch = { ...matchData, scheduled_time: timeStr, court: courtName };

              scheduledMatches.get(cId)!.push(scheduledMatch);
              scheduledMatchIds.add(`${cId}_${matchToSchedule.match_number}`);
              occupiedSlots.add(slotKey);

              const matchPlayerIds = getMatchPlayerIds(scheduledMatch);
              matchPlayerIds.forEach(id => catPlayersThisSlot.add(id));
              matchesThisSlot++;
            }
          }

          catSlotIndex++;
          if (catSlotIndex > currentTimeSlot) currentTimeSlot = catSlotIndex;
        }

        continue;
      }

      // Category has its own time slots
      console.log(`[MULTI-CAT V6] Category ${categoryId.substring(0, 8)}: scheduling ${catGroupMatches.length} matches in ${catSlots.length} time slots across ${catCourts.length} courts`);

      let slotIdx = 0;
      let catIter = 0;
      const catPlayersThisSlot = new Set<string>();

      while (catIter < maxIterations && slotIdx < catSlots.length) {
        catIter++;
        const anyRemaining = catGroupMatches.some(m => !scheduledMatchIds.has(`${m.categoryId}_${m.match_number}`));
        if (!anyRemaining) break;

        const slot = catSlots[slotIdx];
        const timeStr = slot.time;

        catPlayersThisSlot.clear();
        let matchesThisSlot = 0;

        for (const court of catCourts) {
          const slotKey = `${timeStr}_${court}`;
          if (occupiedSlots.has(slotKey)) continue;

          let matchToSchedule: typeof catGroupMatches[0] | undefined;
          for (const match of catGroupMatches) {
            const matchId = `${match.categoryId}_${match.match_number}`;
            if (scheduledMatchIds.has(matchId)) continue;
            const playerIds = getMatchPlayerIds(match);
            if (playerIds.some(id => catPlayersThisSlot.has(id))) continue;
            matchToSchedule = match;
            break;
          }

          if (matchToSchedule) {
            const { categoryId: cId, duration, ...matchData } = matchToSchedule;
            const courtIdx = categoryInfo ? categoryInfo.courtNumbers.indexOf(court) : court - 1;
            const courtName = catCourtNames[courtIdx] || court.toString();
            const scheduledMatch = { ...matchData, scheduled_time: timeStr, court: courtName };

            scheduledMatches.get(cId)!.push(scheduledMatch);
            scheduledMatchIds.add(`${cId}_${matchToSchedule.match_number}`);
            occupiedSlots.add(slotKey);

            if (!busyPlayers.has(timeStr)) busyPlayers.set(timeStr, new Set());
            const matchPlayerIds = getMatchPlayerIds(scheduledMatch);
            matchPlayerIds.forEach(id => {
              busyPlayers.get(timeStr)!.add(id);
              catPlayersThisSlot.add(id);
            });

            console.log(`[MULTI-CAT V6] Cat ${cId.substring(0, 8)} Slot ${slotIdx} Court ${courtName}: Match ${matchToSchedule.match_number}`);
            matchesThisSlot++;
          }
        }

        console.log(`[MULTI-CAT V6] Cat ${categoryId.substring(0, 8)} Slot ${slotIdx}: ${matchesThisSlot}/${catCourts.length} courts filled`);
        slotIdx++;
      }

      // Check if all matches were scheduled
      const unscheduled = catGroupMatches.filter(m => !scheduledMatchIds.has(`${m.categoryId}_${m.match_number}`));
      if (unscheduled.length > 0) {
        console.warn(`[MULTI-CAT V6] ⚠️ Category ${categoryId.substring(0, 8)}: ${unscheduled.length} matches could not be scheduled (not enough time slots!)`);
      }
    }

    console.log('[MULTI-CAT V6] Per-category group stage complete!', scheduledMatchIds.size, 'group matches scheduled');

  } else {
    // ============================
    // MODE B: Shared Global Schedule (original behavior)
    // All categories share the same time slots
    // ============================
    console.log('[MULTI-CAT V6] MODE B: Shared global schedule');

    while (iterations < maxIterations && scheduledMatchIds.size < groupMatches.length) {
      iterations++;

      const slotIndex = currentTimeSlot;
      const slotInfo = getDateForSlot(startDate, slotIndex, dailySchedules, dailyStartTime, dailyEndTime, matchDurationMinutes);
      const totalMinutesFromStart = slotInfo.slotInDay * matchDurationMinutes;
      const hourOffset = Math.floor(totalMinutesFromStart / 60);
      const minuteOffset = totalMinutesFromStart % 60;

      const [year, month, day] = slotInfo.dateStr.split('-').map(Number);
      const scheduledTime = new Date(year, month - 1, day, slotInfo.startHour + hourOffset, slotInfo.startMinute + minuteOffset, 0, 0);
      const timeStr = scheduledTime.toISOString();

      const anyRemaining = groupMatches.some(m => !scheduledMatchIds.has(`${m.categoryId}_${m.match_number}`));
      if (!anyRemaining) break;

      let matchesScheduledThisSlot = 0;
      const playersPlayingThisSlot = new Set<string>();

      for (let courtOffset = 0; courtOffset < numberOfCourts; courtOffset++) {
        const court = ((courtOffset + slotIndex) % numberOfCourts) + 1;
        const slotKey = `${timeStr}_${court}`;
        if (occupiedSlots.has(slotKey)) {
          continue;
        }

        let matchToSchedule: typeof groupMatches[0] | undefined;

        const startCategoryIdx = slotIndex % uniqueCategories.length;
        for (let catOffset = 0; catOffset < uniqueCategories.length; catOffset++) {
          const catIdx = (startCategoryIdx + catOffset) % uniqueCategories.length;
          const categoryId = uniqueCategories[catIdx];
          
          const categoryInfo = categoryCourtMap.get(categoryId);
          if (!categoryInfo || !categoryInfo.courtNumbers.includes(court)) {
            continue;
          }

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
          
          const categoryInfo = categoryCourtMap.get(categoryId);
          const courtName = categoryInfo && categoryInfo.courtNames[categoryInfo.courtNumbers.indexOf(court)]
            ? categoryInfo.courtNames[categoryInfo.courtNumbers.indexOf(court)]
            : court.toString();
          
          const scheduledMatch = {
            ...matchData,
            scheduled_time: timeStr,
            court: courtName
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
            const futureTime = new Date(yr, mo - 1, dy, futureSlotInfo.startHour + futureHourOffset, futureSlotInfo.startMinute + futureMinuteOffset, 0, 0);
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
          console.log(`[MULTI-CAT V6] Slot ${slotIndex} Court ${court}: Match ${matchToSchedule.match_number} Cat ${catShort}`);
          matchesScheduledThisSlot++;
        }
      }

      console.log(`[MULTI-CAT V6] Slot ${slotIndex}: ${matchesScheduledThisSlot}/${numberOfCourts} courts filled`);

      currentTimeSlot++;
    }

    console.log('[MULTI-CAT V6] Group stage complete!', scheduledMatchIds.size, 'group matches scheduled');
  }

  // PHASE 2: Schedule ALL knockout matches (including TBD placeholders)
  // TBD matches are scheduled with null team IDs and filled in after group stage completes
  console.log(`[MULTI-CAT V6] Scheduling ${knockoutMatches.length} knockout matches (including TBD)`);

  // Group knockout matches by round so same-round matches can be scheduled in parallel
  const matchesByRound = new Map<string, typeof knockoutMatches>();
  knockoutMatches.forEach(match => {
    if (!matchesByRound.has(match.round)) {
      matchesByRound.set(match.round, []);
    }
    matchesByRound.get(match.round)!.push(match);
  });

  // For per-category schedules, track each category's current slot index for knockouts
  const categoryKnockoutSlotIdx = new Map<string, number>();
  if (hasCategorySchedules) {
    // Start knockout slots after the last used group slot for each category
    for (const categoryId of uniqueCategories) {
      const catSlots = categoryTimeSlotsMap.get(categoryId);
      if (catSlots) {
        // Find the last used slot index for this category
        const catScheduledMatches = scheduledMatches.get(categoryId) || [];
        if (catScheduledMatches.length > 0) {
          const lastTime = catScheduledMatches[catScheduledMatches.length - 1].scheduled_time;
          const lastIdx = catSlots.findIndex(s => s.time === lastTime);
          categoryKnockoutSlotIdx.set(categoryId, lastIdx >= 0 ? lastIdx + 1 : catSlots.length);
        } else {
          categoryKnockoutSlotIdx.set(categoryId, 0);
        }
      }
    }
  }

  // Schedule each round (e.g., all semifinals at same time on different courts)
  for (const [round, roundMatches] of matchesByRound) {
    console.log(`[MULTI-CAT V6] Scheduling ${roundMatches.length} matches for round: ${round}`);

    const matchesToSchedule = [...roundMatches];

    while (matchesToSchedule.length > 0) {
      const remainingMatches: typeof matchesToSchedule = [];

      if (hasCategorySchedules) {
        // Per-category knockout scheduling
        for (const koMatch of matchesToSchedule) {
          const matchId = `${koMatch.categoryId}_${koMatch.match_number}`;
          if (scheduledMatchIds.has(matchId)) continue;

          const catSlots = categoryTimeSlotsMap.get(koMatch.categoryId);
          const catDuration = categoryDurationMap.get(koMatch.categoryId) || matchDurationMinutes;
          const categoryInfo = categoryCourtMap.get(koMatch.categoryId);
          const catCourts = categoryInfo ? categoryInfo.courtNumbers : Array.from({ length: numberOfCourts }, (_, i) => i + 1);

          if (catSlots && catSlots.length > 0) {
            let slotIdx = categoryKnockoutSlotIdx.get(koMatch.categoryId) || 0;
            let scheduled = false;

            while (slotIdx < catSlots.length) {
              const timeStr = catSlots[slotIdx].time;

              for (const court of catCourts) {
                const slotKey = `${timeStr}_${court}`;
                if (!occupiedSlots.has(slotKey)) {
                  const courtIdx = categoryInfo ? categoryInfo.courtNumbers.indexOf(court) : court - 1;
                  const courtName = categoryInfo ? (categoryInfo.courtNames[courtIdx] || court.toString()) : court.toString();
                  const { categoryId, duration, ...matchData } = koMatch;
                  const scheduledMatch = { ...matchData, scheduled_time: timeStr, court: courtName };
                  
                  scheduledMatches.get(categoryId)!.push(scheduledMatch);
                  scheduledMatchIds.add(matchId);
                  occupiedSlots.add(slotKey);
                  categoryKnockoutSlotIdx.set(categoryId, slotIdx + 1);
                  scheduled = true;
                  console.log(`[MULTI-CAT V6] ✅ Knockout Match ${koMatch.match_number} (${koMatch.round}) -> ${timeStr} court ${courtName}`);
                  break;
                }
              }
              if (scheduled) break;
              slotIdx++;
            }

            if (!scheduled) {
              console.warn(`[MULTI-CAT V6] ⚠️ Knockout Match ${koMatch.match_number} could not fit in category schedule`);
              remainingMatches.push(koMatch);
            }
          } else {
            // Fallback to global slots
            remainingMatches.push(koMatch);
          }
        }

        let globalRetries = 0;
        const maxGlobalRetries = 100;
        while (remainingMatches.length > 0 && globalRetries < maxGlobalRetries) {
          globalRetries++;
          const globalRemaining = [...remainingMatches];
          remainingMatches.length = 0;

          for (const koMatch of globalRemaining) {
            const matchId = `${koMatch.categoryId}_${koMatch.match_number}`;
            if (scheduledMatchIds.has(matchId)) continue;

            const slotInfo = getDateForSlot(startDate, currentTimeSlot, dailySchedules, dailyStartTime, dailyEndTime, matchDurationMinutes);
            const totalMinutesFromStart = slotInfo.slotInDay * matchDurationMinutes;
            const hourOffset = Math.floor(totalMinutesFromStart / 60);
            const minuteOffset = totalMinutesFromStart % 60;
            const [year, month, day] = slotInfo.dateStr.split('-').map(Number);
            const scheduledTime = new Date(year, month - 1, day, slotInfo.startHour + hourOffset, slotInfo.startMinute + minuteOffset, 0, 0);
            const timeStr = scheduledTime.toISOString();

            const catInfo = categoryCourtMap.get(koMatch.categoryId);
            const fallbackCourts = catInfo ? catInfo.courtNumbers : Array.from({ length: numberOfCourts }, (_, i) => i + 1);
            let assignedCourt = 0;
            let courtName = '';
            for (const court of fallbackCourts) {
              const slotKey = `${timeStr}_${court}`;
              if (!occupiedSlots.has(slotKey)) {
                assignedCourt = court;
                const courtIdx = catInfo ? catInfo.courtNumbers.indexOf(court) : court - 1;
                courtName = catInfo ? (catInfo.courtNames[courtIdx] || court.toString()) : (allCourtNames[court - 1] || court.toString());
                occupiedSlots.add(slotKey);
                break;
              }
            }

            if (assignedCourt === 0) {
              currentTimeSlot++;
              remainingMatches.push(koMatch);
              continue;
            }

            const { categoryId, duration, ...matchData } = koMatch;
            const scheduledMatch = { ...matchData, scheduled_time: timeStr, court: courtName };
            scheduledMatches.get(categoryId)!.push(scheduledMatch);
            scheduledMatchIds.add(matchId);
            console.log(`[MULTI-CAT V6] ✅ Knockout Match ${koMatch.match_number} (fallback) -> ${timeStr} court ${courtName}`);
          }
        }
        if (remainingMatches.length > 0) {
          console.warn(`[MULTI-CAT V6] ⚠️ ${remainingMatches.length} knockout matches could not be scheduled after ${maxGlobalRetries} retries`);
        }

        break;

      } else {
        // Global schedule knockout (original)
        const slotIndex = currentTimeSlot;
        const slotInfo = getDateForSlot(startDate, slotIndex, dailySchedules, dailyStartTime, dailyEndTime, matchDurationMinutes);
        const totalMinutesFromStart = slotInfo.slotInDay * matchDurationMinutes;
        const hourOffset = Math.floor(totalMinutesFromStart / 60);
        const minuteOffset = totalMinutesFromStart % 60;

        const [year, month, day] = slotInfo.dateStr.split('-').map(Number);
        const scheduledTime = new Date(year, month - 1, day, slotInfo.startHour + hourOffset, slotInfo.startMinute + minuteOffset, 0, 0);
        const timeStr = scheduledTime.toISOString();

        let scheduledInThisSlot = 0;

        for (const koMatch of matchesToSchedule) {
          const matchId = `${koMatch.categoryId}_${koMatch.match_number}`;
          if (scheduledMatchIds.has(matchId)) continue;

          const categoryInfo = categoryCourtMap.get(koMatch.categoryId);
          const allowedCourts = categoryInfo ? categoryInfo.courtNumbers : Array.from({ length: numberOfCourts }, (_, i) => i + 1);

          let assignedCourt = 0;
          let courtName = '';
          for (const court of allowedCourts) {
            const slotKey = `${timeStr}_${court}`;
            if (!occupiedSlots.has(slotKey)) {
              assignedCourt = court;
              courtName = categoryInfo && categoryInfo.courtNames[categoryInfo.courtNumbers.indexOf(court)]
                ? categoryInfo.courtNames[categoryInfo.courtNumbers.indexOf(court)]
                : court.toString();
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
            court: courtName || assignedCourt.toString()
          };

          scheduledMatches.get(categoryId)!.push(scheduledMatch);
          scheduledMatchIds.add(matchId);
          scheduledInThisSlot++;

          const slotsToOccupy = Math.ceil(matchDuration / matchDurationMinutes);
          for (let futureSlot = 1; futureSlot < slotsToOccupy; futureSlot++) {
            const futureSlotIndex = slotIndex + futureSlot;
            const futureSlotInfo = getDateForSlot(startDate, futureSlotIndex, dailySchedules, dailyStartTime, dailyEndTime, matchDurationMinutes);
            const futureTotalMinutes = futureSlotInfo.slotInDay * matchDurationMinutes;
            const futureHourOffset = Math.floor(futureTotalMinutes / 60);
            const futureMinuteOffset = futureTotalMinutes % 60;
            const [y, m, d] = futureSlotInfo.dateStr.split('-').map(Number);
            const futureTime = new Date(y, m - 1, d, futureSlotInfo.startHour + futureHourOffset, futureSlotInfo.startMinute + futureMinuteOffset, 0, 0);
            occupiedSlots.add(`${futureTime.toISOString()}_${assignedCourt}`);
          }

          console.log(`[MULTI-CAT V6] ✅ Knockout Match ${koMatch.match_number} (${koMatch.round}) scheduled at ${timeStr} on court ${assignedCourt}`);
        }

        matchesToSchedule.length = 0;
        matchesToSchedule.push(...remainingMatches);
        currentTimeSlot++;

        if (remainingMatches.length > 0) {
          console.log(`[MULTI-CAT V6] ${remainingMatches.length} matches overflow to next slot`);
        }
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
      ['consolation', 'semifinal', 'semi_final', '5th_place', '7th_place'],
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
        const scheduledTime = new Date(year, month - 1, day, slotInfo.startHour + hourOffset, slotInfo.startMinute + minuteOffset, 0, 0);
        const timeStr = scheduledTime.toISOString();

        let matchesScheduledThisSlot = 0;
        const remainingMatches: typeof pendingMatches = [];

        for (const tbdMatch of pendingMatches) {
          const matchId = `${tbdMatch.categoryId}_${tbdMatch.match_number}`;
          if (scheduledMatchIds.has(matchId)) continue;

          const catInfo = categoryCourtMap.get(tbdMatch.categoryId);
          const catCourts = catInfo ? catInfo.courtNumbers : Array.from({ length: numberOfCourts }, (_, i) => i + 1);

          let assignedCourt = 0;
          let assignedCourtName = '';
          for (const court of catCourts) {
            const slotKey = `${timeStr}_${court}`;
            if (!occupiedSlots.has(slotKey)) {
              assignedCourt = court;
              const courtIdx = catInfo ? catInfo.courtNumbers.indexOf(court) : court - 1;
              assignedCourtName = catInfo ? (catInfo.courtNames[courtIdx] || court.toString()) : (allCourtNames[court - 1] || court.toString());
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
            court: assignedCourtName
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
            const futureTime = new Date(fy, fm - 1, fd, futureSlotInfo.startHour + futureHourOffset, futureSlotInfo.startMinute + futureMinuteOffset, 0, 0);
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

  // Calculate total qualified players (all players with groups)
  const totalPlayers = Array.from(teamsByGroup.values()).reduce((sum, g) => sum + g.length, 0);
  const numQFMatches = Math.floor(totalPlayers / 4);

  console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Total players: ${totalPlayers}, potential first-round matches: ${numQFMatches}`);

  const addKoMatch = (round: string) => {
    matches.push({
      round,
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
  };

  if (numQFMatches >= 3) {
    // 12+ players: QFs → SFs → Final
    // e.g. 3 groups × 4 = 12 players → 3 QFs, 2 SFs, 1 consolation, 1 final, 1 3rd
    for (let i = 0; i < numQFMatches; i++) {
      addKoMatch('quarterfinal');
    }
    console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Added ${numQFMatches} quarterfinal matches`);

    // Consolation match for QF losers who don't advance to SFs
    addKoMatch('consolation');
    console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Added consolation match`);

    // 2 semifinals
    addKoMatch('semifinal');
    addKoMatch('semifinal');
    console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Added 2 semifinal matches`);

    // Final + 3rd/4th
    addKoMatch('final');
    addKoMatch('3rd_place');
    console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Added final and 3rd/4th place matches`);
  } else if (numQFMatches >= 2) {
    // 8 players: just SFs → Final
    addKoMatch('semifinal');
    addKoMatch('semifinal');
    console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Added 2 semifinal matches`);

    addKoMatch('final');
    addKoMatch('3rd_place');
    console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Added final and 3rd/4th place matches`);
  } else if (totalPlayers >= 4) {
    // 4 players: just Final
    addKoMatch('final');
    console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Added final match`);
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

    // Add 3rd/4th place match for team format (when we have semifinals or more)
    if (rounds >= 2) {
      matches.push({
        round: '3rd_place',
        match_number: matchNumber++,
        team1_id: null,
        team2_id: null,
        scheduled_time: '',
        court: ''
      });
      console.log(`[KNOCKOUT_OPTIONS] Added 3rd/4th place match`);
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
