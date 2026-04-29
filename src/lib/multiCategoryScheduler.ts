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
  categorySchedule?: CategoryScheduleEntry[] | null;
  matchDurationMinutes?: number | null;
  hasThirdPlace?: boolean;
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
  // Use Math.ceil so that a match can START within the schedule window even
  // if it ends slightly after the nominal end time. This prevents knockout
  // rounds from wrapping to the next day when there is still usable time left.
  const slotsPerDay = Math.ceil(availableMinutes / matchDurationMinutes);
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
/**
 * Canonical ordering for knockout rounds. Lower = earlier. Aliases map to same value.
 * Ensures semis are scheduled before finals even when matches are generated in arbitrary order.
 */
const ROUND_PRIORITY: Record<string, number> = {
  group_stage: 0,
  round_of_32: 10,
  round_of_16: 20,
  quarterfinal: 30,
  quarter_final: 30,
  '5th_semi': 35,
  semifinal: 40,
  semi_final: 40,
  consolation: 45,
  '3rd_place': 50,
  '5th_place': 50,
  '7th_place': 50,
  final: 60,
};

function roundPriority(round: string): number {
  if (round in ROUND_PRIORITY) return ROUND_PRIORITY[round];
  if (round.startsWith('group_')) return 0;
  return 99;
}

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
  const day1Info = calculateSlotsForDay(startDate, dailySchedules, dailyStartTime, dailyEndTime, matchDurationMinutes);
  console.log(`[MULTI-CAT V6] Day 1 (${startDate}): slotsPerDay=${day1Info.slotsPerDay}, start=${day1Info.startHour}:${String(day1Info.startMinute).padStart(2,'0')}, matchDuration=${matchDurationMinutes}min`);
  
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

  const busyPlayers = new Map<string, Set<string>>();
  const playerLastPlayed = new Map<string, number>();

  // =====================================================================
  // Canonical court name map: ensures every reference to a physical court
  // resolves to the SAME string key. Court names that share the same
  // leading number prefix (e.g. "2- Wine & Sushi" and "2- Wine&Sushi")
  // are treated as the SAME physical court.
  // =====================================================================
  const canonicalCourt = new Map<string, string>();

  // Group court names by their leading number prefix to detect aliases
  const prefixToCanonical = new Map<string, string>();
  const extractPrefix = (name: string): string | null => {
    const m = name.match(/^(\d+)\s*[-–—.)\s]/);
    return m ? m[1] : null;
  };

  // First pass: pick the first occurrence of each prefix as canonical
  allCourtNames.forEach(name => {
    const prefix = extractPrefix(name);
    if (prefix && !prefixToCanonical.has(prefix)) {
      prefixToCanonical.set(prefix, name);
    }
  });

  // Second pass: map every court name (and its position number) to canonical
  allCourtNames.forEach((name, idx) => {
    const num = idx + 1;
    const prefix = extractPrefix(name);
    const canonical = (prefix && prefixToCanonical.get(prefix)) || name;
    canonicalCourt.set(name, canonical);
    canonicalCourt.set(String(num), canonical);
  });

  // Also map from any category-specific names/numbers
  for (const [, info] of categoryCourtMap) {
    info.courtNumbers.forEach((num, idx) => {
      const name = info.courtNames[idx] || String(num);
      const prefix = extractPrefix(name);
      const canonical = (prefix && prefixToCanonical.get(prefix)) || name;
      canonicalCourt.set(name, canonical);
      canonicalCourt.set(String(num), canonical);
    });
  }

  // Deduce actual physical court count from prefix groups
  const physicalCourtCount = prefixToCanonical.size > 0 ? prefixToCanonical.size : numberOfCourts;
  if (physicalCourtCount < numberOfCourts) {
    console.warn(`[SCHEDULER] ⚠️ Tournament says ${numberOfCourts} courts but only ${physicalCourtCount} distinct physical courts detected (by number prefix). Court aliases will be unified.`);
  }

  const courtKey = (court: string | number | null | undefined): string => {
    const raw = String(court ?? '');
    return canonicalCourt.get(raw) ?? raw;
  };

  console.log('[SCHEDULER] canonicalCourt map:', Object.fromEntries(canonicalCourt));

  // Duration-aware court occupancy (interval-based).
  // Records real [startMs, endMs) busy windows per court.
  // Single source of truth for court availability.
  interface BusyInterval { start: number; end: number; }
  const courtOccupancy = new Map<string, BusyInterval[]>();
  let _markCount = 0;

  const isCourtBusy = (court: string | number | null | undefined, startIso: string, durationMin: number): boolean => {
    const key = courtKey(court);
    const startMs = new Date(startIso).getTime();
    if (!Number.isFinite(startMs)) return false;
    const endMs = startMs + Math.max(1, durationMin) * 60000;
    const intervals = courtOccupancy.get(key);
    if (!intervals || intervals.length === 0) return false;
    for (const iv of intervals) {
      if (startMs < iv.end && iv.start < endMs) return true;
    }
    return false;
  };

  const markCourtBusy = (court: string | number | null | undefined, startIso: string, durationMin: number): void => {
    const key = courtKey(court);
    const startMs = new Date(startIso).getTime();
    if (!Number.isFinite(startMs)) return;
    const endMs = startMs + Math.max(1, durationMin) * 60000;
    _markCount++;
    if (_markCount <= 30) {
      const t = new Date(startMs);
      console.log(`[MARK-BUSY] court="${court}" → key="${key}" ${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')} +${durationMin}min`);
    }
    const arr = courtOccupancy.get(key);
    if (arr) arr.push({ start: startMs, end: endMs });
    else courtOccupancy.set(key, [{ start: startMs, end: endMs }]);
  };

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
    markCourtBusy(court, time, matchDurationMinutes);

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
        category.knockoutStage || 'semifinals',
        category.hasThirdPlace ?? true
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

  // Track the latest scheduled_time (ISO) for group_stage matches per category.
  // Used to guarantee knockouts are scheduled AFTER the last group match of the same category
  // and to provide a robust "starting slot" for knockouts (replaces fragile ISO-string findIndex).
  const categoryMaxGroupTime = new Map<string, string>();
  const bumpCategoryMaxGroupTime = (cId: string, timeStr: string) => {
    const prev = categoryMaxGroupTime.get(cId);
    const t = new Date(timeStr).getTime();
    if (!Number.isFinite(t)) return;
    if (!prev || t > new Date(prev).getTime()) categoryMaxGroupTime.set(cId, timeStr);
  };
  // Track the maximum slot index (within catSlots) used by group matches per category.
  // Avoids the fragile findIndex(s => s.time === lastTime) comparison in the original code.
  const categoryMaxGroupSlotIdx = new Map<string, number>();

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
    // MODE A: Interleaved per-category scheduling
    // Categories are mixed: at each time slot we round-robin across categories
    // so that teams get rest between consecutive matches.
    // ============================
    console.log('[MULTI-CAT V8] MODE A: Interleaved category scheduling');

    // Build a unified timeline: collect ALL distinct time slots across all
    // categories, sorted chronologically.  For each slot we record which
    // categories are allowed to play at that time.
    const slotCategoryMap = new Map<string, Set<string>>();

    for (const categoryId of uniqueCategories) {
      const catSlots = categoryTimeSlotsMap.get(categoryId);
      if (catSlots && catSlots.length > 0) {
        for (const slot of catSlots) {
          if (!slotCategoryMap.has(slot.time)) slotCategoryMap.set(slot.time, new Set());
          slotCategoryMap.get(slot.time)!.add(categoryId);
        }
      }
    }

    const unifiedSlots = [...slotCategoryMap.keys()].sort();
    console.log(`[MULTI-CAT V8] Unified timeline: ${unifiedSlots.length} distinct time slots`);

    // Remaining group matches per category (mutable queues)
    const catQueues = new Map<string, typeof groupMatches>();
    for (const categoryId of uniqueCategories) {
      catQueues.set(categoryId, groupMatches.filter(m => m.categoryId === categoryId));
    }

    // Category rotation offset — advances each slot so no category is
    // always first to pick courts.
    let catRotation = 0;

    for (const timeStr of unifiedSlots) {
      const allowedCats = slotCategoryMap.get(timeStr)!;
      const playersThisSlot = new Set<string>();

      // Build ordered list of categories for this slot (round-robin)
      const catsThisSlot = uniqueCategories.filter(c => allowedCats.has(c));
      const orderedCats: string[] = [];
      for (let i = 0; i < catsThisSlot.length; i++) {
        orderedCats.push(catsThisSlot[(i + catRotation) % catsThisSlot.length]);
      }

      // Track which courts are already used in this slot
      let totalScheduled = 0;

      // Keep rotating through categories filling one court per category at
      // a time until no more matches can be placed in this time slot.
      let progress = true;
      while (progress) {
        progress = false;
        for (const categoryId of orderedCats) {
          const queue = catQueues.get(categoryId)!;
          const remaining = queue.filter(m => !scheduledMatchIds.has(`${m.categoryId}_${m.match_number}`));
          if (remaining.length === 0) continue;

          const catDuration = categoryDurationMap.get(categoryId) || matchDurationMinutes;
          const categoryInfo = categoryCourtMap.get(categoryId);
          const catCourts = categoryInfo ? categoryInfo.courtNumbers : Array.from({ length: numberOfCourts }, (_, i) => i + 1);
          const catCourtNames = categoryInfo ? categoryInfo.courtNames : allCourtNames;

          // Try to find a free court for one match of this category
          for (const court of catCourts) {
            const courtIdx = categoryInfo ? categoryInfo.courtNumbers.indexOf(court) : court - 1;
            const courtName = catCourtNames[courtIdx] || court.toString();
            if (isCourtBusy(courtName, timeStr, catDuration)) continue;

            // Pick a match, preferring teams that rested
            let matchToSchedule: typeof remaining[0] | undefined;
            let fallbackMatch: typeof remaining[0] | undefined;
            for (const match of remaining) {
              const matchId = `${match.categoryId}_${match.match_number}`;
              if (scheduledMatchIds.has(matchId)) continue;
              const playerIds = getMatchPlayerIds(match);
              if (playerIds.some(id => playersThisSlot.has(id))) continue;
              if (!fallbackMatch) fallbackMatch = match;
              const lastTs = playerIds.reduce((mx, id) => Math.max(mx, playerLastPlayed.get(id) ?? -999), -999);
              if (lastTs < totalScheduled - 1) {
                matchToSchedule = match;
                break;
              }
            }
            if (!matchToSchedule) matchToSchedule = fallbackMatch;
            if (!matchToSchedule) break;

            const { categoryId: cId, duration, ...matchData } = matchToSchedule;
            const scheduledMatch = { ...matchData, scheduled_time: timeStr, court: courtName };

            scheduledMatches.get(cId)!.push(scheduledMatch);
            scheduledMatchIds.add(`${cId}_${matchToSchedule.match_number}`);
            markCourtBusy(courtName, timeStr, catDuration);

            if (!busyPlayers.has(timeStr)) busyPlayers.set(timeStr, new Set());
            const matchPlayerIds = getMatchPlayerIds(scheduledMatch);
            matchPlayerIds.forEach(id => {
              busyPlayers.get(timeStr)!.add(id);
              playersThisSlot.add(id);
              playerLastPlayed.set(id, totalScheduled);
            });
            bumpCategoryMaxGroupTime(cId, timeStr);

            console.log(`[MULTI-CAT V8] Slot ${timeStr.substring(11,16)} Court ${courtName}: Cat ${cId.substring(0, 8)} M${matchToSchedule.match_number}`);
            totalScheduled++;
            progress = true;
            break; // one match per category per pass
          }
        }
      }

      catRotation++;
    }

    // Categories without own schedules: use global slots
    for (const categoryId of uniqueCategories) {
      const catGroupMatches = groupMatches.filter(m => m.categoryId === categoryId);
      const catSlots = categoryTimeSlotsMap.get(categoryId);
      if (catSlots && catSlots.length > 0) continue; // already handled above
      if (catGroupMatches.every(m => scheduledMatchIds.has(`${m.categoryId}_${m.match_number}`))) continue;

      console.log(`[MULTI-CAT V8] Category ${categoryId.substring(0, 8)}: no own schedule, using global slots`);
      const catDuration = categoryDurationMap.get(categoryId) || matchDurationMinutes;
      const categoryInfo = categoryCourtMap.get(categoryId);
      const catCourts = categoryInfo ? categoryInfo.courtNumbers : Array.from({ length: numberOfCourts }, (_, i) => i + 1);
      const catCourtNames = categoryInfo ? categoryInfo.courtNames : allCourtNames;

      let catSlotIndex = currentTimeSlot;
      let catIter = 0;
      while (catIter++ < maxIterations) {
        if (catGroupMatches.every(m => scheduledMatchIds.has(`${m.categoryId}_${m.match_number}`))) break;
        const slotInfo = getDateForSlot(startDate, catSlotIndex, dailySchedules, dailyStartTime, dailyEndTime, catDuration);
        const totalMinutesFromStart = slotInfo.slotInDay * catDuration;
        const hourOffset = Math.floor(totalMinutesFromStart / 60);
        const minuteOffset = totalMinutesFromStart % 60;
        const [year, month, day] = slotInfo.dateStr.split('-').map(Number);
        const scheduledTime = new Date(year, month - 1, day, slotInfo.startHour + hourOffset, slotInfo.startMinute + minuteOffset, 0, 0);
        const timeStr = scheduledTime.toISOString();
        const playersThisSlot = new Set<string>();

        // Per-day courts: restrict to courts available on this day
        const slotDaySchedule = getDaySchedule(slotInfo.dateStr, dailySchedules, dailyStartTime, dailyEndTime);
        const slotDayCourts = slotDaySchedule.court_names && slotDaySchedule.court_names.length > 0
          ? slotDaySchedule.court_names : null;

        for (const court of catCourts) {
          const courtIdx = categoryInfo ? categoryInfo.courtNumbers.indexOf(court) : court - 1;
          const courtName = catCourtNames[courtIdx] || court.toString();
          if (slotDayCourts && !slotDayCourts.includes(courtName)) continue;
          if (isCourtBusy(courtName, timeStr, catDuration)) continue;

          let matchToSchedule: typeof catGroupMatches[0] | undefined;
          for (const match of catGroupMatches) {
            if (scheduledMatchIds.has(`${match.categoryId}_${match.match_number}`)) continue;
            const playerIds = getMatchPlayerIds(match);
            if (playerIds.some(id => playersThisSlot.has(id))) continue;
            matchToSchedule = match;
            break;
          }
          if (!matchToSchedule) break;

          const { categoryId: cId, duration, ...matchData } = matchToSchedule;
          const scheduledMatch = { ...matchData, scheduled_time: timeStr, court: courtName };
          scheduledMatches.get(cId)!.push(scheduledMatch);
          scheduledMatchIds.add(`${cId}_${matchToSchedule.match_number}`);
          markCourtBusy(courtName, timeStr, catDuration);
          const matchPlayerIds = getMatchPlayerIds(scheduledMatch);
          matchPlayerIds.forEach(id => playersThisSlot.add(id));
          bumpCategoryMaxGroupTime(cId, timeStr);
        }
        catSlotIndex++;
        if (catSlotIndex > currentTimeSlot) currentTimeSlot = catSlotIndex;
      }
    }

    // Log unscheduled
    for (const categoryId of uniqueCategories) {
      const catGroupMatches = groupMatches.filter(m => m.categoryId === categoryId);
      const unscheduled = catGroupMatches.filter(m => !scheduledMatchIds.has(`${m.categoryId}_${m.match_number}`));
      if (unscheduled.length > 0) {
        console.warn(`[MULTI-CAT V8] ⚠️ Category ${categoryId.substring(0, 8)}: ${unscheduled.length} group matches could not be scheduled`);
      }
    }

    // Advance currentTimeSlot past all scheduled group times so Phase 2/3
    // don't start from slot 0.
    const allGroupTimesMs = [...categoryMaxGroupTime.values()].map(t => new Date(t).getTime()).filter(Number.isFinite);
    if (allGroupTimesMs.length > 0) {
      const latestMs = Math.max(...allGroupTimesMs);
      for (let gi = currentTimeSlot; gi < 10000; gi++) {
        const si = getDateForSlot(startDate, gi, dailySchedules, dailyStartTime, dailyEndTime, matchDurationMinutes);
        const mins = si.slotInDay * matchDurationMinutes;
        const [y, mo, d] = si.dateStr.split('-').map(Number);
        const t = new Date(y, mo - 1, d, si.startHour + Math.floor(mins / 60), si.startMinute + mins % 60).getTime();
        if (t > latestMs) { currentTimeSlot = gi; break; }
        currentTimeSlot = gi + 1;
      }
    }

    console.log('[MULTI-CAT V8] Interleaved group stage complete!', scheduledMatchIds.size, 'group matches scheduled, currentTimeSlot:', currentTimeSlot);

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

      // Per-day courts: check if this day has specific court_names
      const daySchedule = getDaySchedule(slotInfo.dateStr, dailySchedules, dailyStartTime, dailyEndTime);
      const dayCourts = daySchedule.court_names && daySchedule.court_names.length > 0
        ? daySchedule.court_names
        : allCourtNames;
      const dayCourtCount = dayCourts.length > 0 ? dayCourts.length : numberOfCourts;

      let matchesScheduledThisSlot = 0;
      const playersPlayingThisSlot = new Set<string>();

      for (let courtOffset = 0; courtOffset < dayCourtCount; courtOffset++) {
        const court = ((courtOffset + slotIndex) % dayCourtCount) + 1;

        let matchToSchedule: typeof groupMatches[0] | undefined;
        let resolvedCourtName = '';

        const startCategoryIdx = slotIndex % uniqueCategories.length;
        for (let catOffset = 0; catOffset < uniqueCategories.length; catOffset++) {
          const catIdx = (startCategoryIdx + catOffset) % uniqueCategories.length;
          const categoryId = uniqueCategories[catIdx];
          
          const categoryInfo = categoryCourtMap.get(categoryId);
          if (!categoryInfo || !categoryInfo.courtNumbers.includes(court)) {
            continue;
          }

          const candidateCourtName = categoryInfo.courtNames[categoryInfo.courtNumbers.indexOf(court)] || court.toString();

          // Skip if day-specific courts don't include this court
          if (dayCourts.length > 0 && !dayCourts.includes(candidateCourtName)) continue;
          const candidateDuration = categoryDurationMap.get(categoryId) || matchDurationMinutes;
          if (isCourtBusy(candidateCourtName, timeStr, candidateDuration)) continue;

          for (const match of groupMatches) {
            if (match.categoryId !== categoryId) continue;
            const matchId = `${match.categoryId}_${match.match_number}`;
            if (scheduledMatchIds.has(matchId)) continue;

            const playerIds = getMatchPlayerIds(match);
            const anyPlayerBusy = playerIds.some(id => playersPlayingThisSlot.has(id));

            if (!anyPlayerBusy) {
              matchToSchedule = match;
              resolvedCourtName = candidateCourtName;
              break;
            }
          }

          if (matchToSchedule) break;
        }

        if (matchToSchedule) {
          const matchDuration = categoryDurationMap.get(matchToSchedule.categoryId) || matchToSchedule.duration || matchDurationMinutes;
          const { categoryId, duration, ...matchData } = matchToSchedule;
          
          const courtName = resolvedCourtName || court.toString();
          
          const scheduledMatch = {
            ...matchData,
            scheduled_time: timeStr,
            court: courtName
          };

          const categoryScheduled = scheduledMatches.get(categoryId)!;
          categoryScheduled.push(scheduledMatch);

          const matchId = `${matchToSchedule.categoryId}_${matchToSchedule.match_number}`;
          scheduledMatchIds.add(matchId);
          markCourtBusy(courtName, timeStr, matchDuration);

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
          bumpCategoryMaxGroupTime(matchToSchedule.categoryId, timeStr);
        }
      }

      console.log(`[MULTI-CAT V6] Slot ${slotIndex}: ${matchesScheduledThisSlot}/${dayCourtCount} courts filled`);

      currentTimeSlot++;
    }

    console.log('[MULTI-CAT V6] Group stage complete!', scheduledMatchIds.size, 'group matches scheduled');
  }

  // PHASE 2: Schedule ALL knockout matches (including TBD placeholders)
  // TBD matches are scheduled with null team IDs and filled in after group stage completes
  console.log(`[MULTI-CAT V7] Scheduling ${knockoutMatches.length} knockout matches (including TBD)`);

  // Bucket matches by round
  const roundBuckets = new Map<string, typeof knockoutMatches>();
  knockoutMatches.forEach(match => {
    if (!roundBuckets.has(match.round)) roundBuckets.set(match.round, []);
    roundBuckets.get(match.round)!.push(match);
  });

  // Group rounds into scheduling tiers: rounds in the same tier can run in parallel on different courts.
  // Only advance categoryLastKOTime between tiers, not within the same tier.
  const SCHEDULE_TIERS = [
    ['round_of_32'],
    ['round_of_16'],
    ['quarter_final', 'quarterfinal'],
    ['5th_semi', 'semi_final', 'semifinal'],
    ['consolation', '3rd_place', '5th_place', '7th_place', 'final'],
  ];

  // Build ordered list of tiers that actually have matches
  const activeRoundNames = [...roundBuckets.keys()];
  const orderedTiers: string[][] = [];
  for (const tier of SCHEDULE_TIERS) {
    const present = tier.filter(r => activeRoundNames.includes(r));
    if (present.length > 0) orderedTiers.push(present);
  }
  // Any rounds not in predefined tiers get their own tier at the end
  const coveredRounds = new Set(SCHEDULE_TIERS.flat());
  const uncovered = activeRoundNames.filter(r => !coveredRounds.has(r)).sort((a, b) => roundPriority(a) - roundPriority(b));
  if (uncovered.length > 0) orderedTiers.push(uncovered);

  console.log('[MULTI-CAT V7] Knockout schedule tiers:', orderedTiers);

  // Track latest knockout time per category so later rounds (e.g. final) are always AFTER earlier rounds (semis).
  const categoryLastKOTime = new Map<string, string>();

  // Helper: earliest permissible knockout start timestamp for a given category.
  // Ensures knockouts come AFTER the last group match AND after any previously placed knockout of the same cat.
  const earliestKOTimestamp = (categoryId: string): number => {
    const catDuration = categoryDurationMap.get(categoryId) || matchDurationMinutes;
    const lastGroupTime = categoryMaxGroupTime.get(categoryId);
    const lastKOTime = categoryLastKOTime.get(categoryId);
    let ts = 0;
    if (lastGroupTime) ts = Math.max(ts, new Date(lastGroupTime).getTime() + catDuration * 60 * 1000);
    if (lastKOTime) ts = Math.max(ts, new Date(lastKOTime).getTime() + catDuration * 60 * 1000);
    return ts;
  };

  // Suppress unused import warning; we tracked categoryMaxGroupSlotIdx for diagnostics only
  void categoryMaxGroupSlotIdx;

  // Matches we could not fit respecting all constraints; validator will pick these up.
  const unschedulableKO: typeof knockoutMatches = [];

  for (const tier of orderedTiers) {
    const roundMatches = tier.flatMap(r => roundBuckets.get(r) || []);
    console.log(`[MULTI-CAT V7] Scheduling ${roundMatches.length} matches for tier: [${tier.join(', ')}]`);

    // Collect max time per category for this round; update categoryLastKOTime AFTER all matches in the round
    const roundMaxTimePerCat = new Map<string, string>();

    if (hasCategorySchedules) {
      // ---- MODE A: per-category knockout scheduling ----
      for (const koMatch of roundMatches) {
        const matchId = `${koMatch.categoryId}_${koMatch.match_number}`;
        if (scheduledMatchIds.has(matchId)) continue;

        const catSlots = categoryTimeSlotsMap.get(koMatch.categoryId);
        const categoryInfo = categoryCourtMap.get(koMatch.categoryId);
        const catCourts = categoryInfo ? categoryInfo.courtNumbers : Array.from({ length: numberOfCourts }, (_, i) => i + 1);
        const earliestTs = earliestKOTimestamp(koMatch.categoryId);
        const koPlayerIds = getMatchPlayerIds(koMatch).filter(Boolean);
        const koDuration = categoryDurationMap.get(koMatch.categoryId) || koMatch.duration || matchDurationMinutes;

        let scheduled = false;

        if (catSlots && catSlots.length > 0) {
          for (let slotIdx = 0; slotIdx < catSlots.length && !scheduled; slotIdx++) {
            const slot = catSlots[slotIdx];
            if (new Date(slot.time).getTime() < earliestTs) continue;

            const playersBusyThisTime = busyPlayers.get(slot.time);
            if (koPlayerIds.length > 0 && koPlayerIds.some(id => playersBusyThisTime?.has(id))) continue;

            for (const court of catCourts) {
              const courtIdx = categoryInfo ? categoryInfo.courtNumbers.indexOf(court) : court - 1;
              const courtName = categoryInfo ? (categoryInfo.courtNames[courtIdx] || court.toString()) : court.toString();
              if (isCourtBusy(courtName, slot.time, koDuration)) continue;
              const { categoryId, duration, ...matchData } = koMatch;
              const scheduledMatch = { ...matchData, scheduled_time: slot.time, court: courtName };

              scheduledMatches.get(categoryId)!.push(scheduledMatch);
              scheduledMatchIds.add(matchId);
              markCourtBusy(courtName, slot.time, koDuration);

              const prevMax = roundMaxTimePerCat.get(categoryId);
              if (!prevMax || slot.time > prevMax) roundMaxTimePerCat.set(categoryId, slot.time);

              if (!busyPlayers.has(slot.time)) busyPlayers.set(slot.time, new Set());
              koPlayerIds.forEach(id => busyPlayers.get(slot.time)!.add(id));

              scheduled = true;
              console.log(`[MULTI-CAT V7] OK KO M${koMatch.match_number} (${koMatch.round}) Cat ${categoryId.substring(0, 8)} -> ${slot.time} court ${courtName}`);
              break;
            }
          }
        }

        if (!scheduled) {
          const catSched = categories.find(c => c.categoryId === koMatch.categoryId)?.categorySchedule;
          if (catSched && catSched.length > 0) {
            const sortedEntries = [...catSched].sort((a, b) => a.date === b.date ? a.start_time.localeCompare(b.start_time) : a.date.localeCompare(b.date));
            for (const entry of sortedEntries) {
              if (scheduled) break;
              const [sh, sm] = entry.start_time.split(':').map(Number);
              const [eh, em] = entry.end_time.split(':').map(Number);
              const [ey, emo, ed] = entry.date.split('-').map(Number);
              const startMin = sh * 60 + (sm || 0);
              const endMin = eh * 60 + (em || 0);
              for (let min = startMin; min + koDuration <= endMin && !scheduled; min += koDuration) {
                const h = Math.floor(min / 60);
                const m = min % 60;
                const scheduledTime = new Date(ey, emo - 1, ed, h, m, 0, 0);
                const timeStr = scheduledTime.toISOString();
                const slotTs = scheduledTime.getTime();
                if (slotTs < earliestTs) continue;

                const playersBusyThisTime = busyPlayers.get(timeStr);
                if (koPlayerIds.length > 0 && koPlayerIds.some(id => playersBusyThisTime?.has(id))) continue;

                for (const court of catCourts) {
                  const courtIdx = categoryInfo ? categoryInfo.courtNumbers.indexOf(court) : court - 1;
                  const courtName = categoryInfo ? (categoryInfo.courtNames[courtIdx] || court.toString()) : court.toString();
                  if (isCourtBusy(courtName, timeStr, koDuration)) continue;
                  const { categoryId, duration, ...matchData } = koMatch;
                  const scheduledMatch = { ...matchData, scheduled_time: timeStr, court: courtName };

                  scheduledMatches.get(categoryId)!.push(scheduledMatch);
                  scheduledMatchIds.add(matchId);
                  markCourtBusy(courtName, timeStr, koDuration);

                  const prevMax = roundMaxTimePerCat.get(categoryId);
                  if (!prevMax || timeStr > prevMax) roundMaxTimePerCat.set(categoryId, timeStr);

                  if (!busyPlayers.has(timeStr)) busyPlayers.set(timeStr, new Set());
                  koPlayerIds.forEach(id => busyPlayers.get(timeStr)!.add(id));

                  scheduled = true;
                  console.log(`[MULTI-CAT V7] OK KO (fallback) M${koMatch.match_number} (${koMatch.round}) Cat ${categoryId.substring(0, 8)} -> ${timeStr} court ${courtName}`);
                  break;
                }
              }
            }
          }
        }

        if (!scheduled) {
          console.warn(`[MULTI-CAT V7] KO M${koMatch.match_number} (${koMatch.round}) Cat ${koMatch.categoryId.substring(0, 8)}: catSlots + category fallback failed. Trying global fallback beyond category schedule...`);
          const catDuration2 = koDuration;
          const globalStartTs = earliestTs;
          const globalStartDate = new Date(globalStartTs);
          const [gy, gmo, gd] = [globalStartDate.getFullYear(), globalStartDate.getMonth(), globalStartDate.getDate()];
          const dayStartMin = globalStartDate.getHours() * 60 + globalStartDate.getMinutes();

          for (let dayOffset = 0; dayOffset < 7 && !scheduled; dayOffset++) {
            const tryDate = new Date(gy, gmo, gd + dayOffset);
            const tryDateStr = `${tryDate.getFullYear()}-${String(tryDate.getMonth() + 1).padStart(2, '0')}-${String(tryDate.getDate()).padStart(2, '0')}`;
            const dayInfo = calculateSlotsForDay(tryDateStr, dailySchedules, dailyStartTime, dailyEndTime, catDuration2);
            const startMin2 = dayOffset === 0 ? Math.max(dayStartMin, dayInfo.startHour * 60 + dayInfo.startMinute) : dayInfo.startHour * 60 + dayInfo.startMinute;
            const endMin2 = dayInfo.startHour * 60 + dayInfo.startMinute + dayInfo.slotsPerDay * catDuration2;

            for (let min = startMin2; min + catDuration2 <= endMin2 && !scheduled; min += catDuration2) {
              const h = Math.floor(min / 60);
              const m2 = min % 60;
              const [ty, tmo, td] = tryDateStr.split('-').map(Number);
              const scheduledTime = new Date(ty, tmo - 1, td, h, m2, 0, 0);
              const timeStr = scheduledTime.toISOString();
              const slotTs = scheduledTime.getTime();
              if (slotTs < earliestTs) continue;

              const playersBusyThisTime = busyPlayers.get(timeStr);
              if (koPlayerIds.length > 0 && koPlayerIds.some(id => playersBusyThisTime?.has(id))) continue;

              for (const court of catCourts) {
                const courtIdx = categoryInfo ? categoryInfo.courtNumbers.indexOf(court) : court - 1;
                const courtName = categoryInfo ? (categoryInfo.courtNames[courtIdx] || court.toString()) : court.toString();
                if (isCourtBusy(courtName, timeStr, catDuration2)) continue;
                const { categoryId, duration, ...matchData } = koMatch;
                const scheduledMatch = { ...matchData, scheduled_time: timeStr, court: courtName };

                scheduledMatches.get(categoryId)!.push(scheduledMatch);
                scheduledMatchIds.add(matchId);
                markCourtBusy(courtName, timeStr, catDuration2);

                const prevMax = roundMaxTimePerCat.get(categoryId);
                if (!prevMax || timeStr > prevMax) roundMaxTimePerCat.set(categoryId, timeStr);

                if (!busyPlayers.has(timeStr)) busyPlayers.set(timeStr, new Set());
                koPlayerIds.forEach(id => busyPlayers.get(timeStr)!.add(id));

                scheduled = true;
                console.log(`[MULTI-CAT V7] OK KO (global fallback) M${koMatch.match_number} (${koMatch.round}) Cat ${categoryId.substring(0, 8)} -> ${timeStr} court ${courtName}`);
                break;
              }
            }
          }
        }

        if (!scheduled) {
          console.warn(`[MULTI-CAT V7] KO M${koMatch.match_number} (${koMatch.round}) Cat ${koMatch.categoryId.substring(0, 8)}: could NOT fit after ALL fallbacks (earliestTs=${new Date(earliestTs).toISOString()}). Added to unschedulable list.`);
          unschedulableKO.push(koMatch);
        }
      }
    } else {
      // ---- MODE B: global shared schedule ----
      const pending = [...roundMatches];
      let attempts = 0;
      const maxAttempts = 10000;

      while (pending.length > 0 && attempts < maxAttempts) {
        attempts++;
        const slotIndex = currentTimeSlot;
        const slotInfo = getDateForSlot(startDate, slotIndex, dailySchedules, dailyStartTime, dailyEndTime, matchDurationMinutes);
        const totalMinutesFromStart = slotInfo.slotInDay * matchDurationMinutes;
        const hourOffset = Math.floor(totalMinutesFromStart / 60);
        const minuteOffset = totalMinutesFromStart % 60;
        const [year, month, day] = slotInfo.dateStr.split('-').map(Number);
        const scheduledTime = new Date(year, month - 1, day, slotInfo.startHour + hourOffset, slotInfo.startMinute + minuteOffset, 0, 0);
        const timeStr = scheduledTime.toISOString();
        const slotTs = scheduledTime.getTime();

        const remaining: typeof pending = [];
        let anyScheduled = false;

        for (const koMatch of pending) {
          const matchId = `${koMatch.categoryId}_${koMatch.match_number}`;
          if (scheduledMatchIds.has(matchId)) continue;

          if (slotTs < earliestKOTimestamp(koMatch.categoryId)) {
            remaining.push(koMatch);
            continue;
          }

          const koPlayerIds = getMatchPlayerIds(koMatch).filter(Boolean);
          const playersBusyThisTime = busyPlayers.get(timeStr);
          if (koPlayerIds.length > 0 && koPlayerIds.some(id => playersBusyThisTime?.has(id))) {
            remaining.push(koMatch);
            continue;
          }

          const categoryInfo = categoryCourtMap.get(koMatch.categoryId);
          const allowedCourts = categoryInfo ? categoryInfo.courtNumbers : Array.from({ length: numberOfCourts }, (_, i) => i + 1);
          const koDuration = categoryDurationMap.get(koMatch.categoryId) || koMatch.duration || matchDurationMinutes;

          let assignedCourt = 0;
          let courtName = '';
          for (const court of allowedCourts) {
            const candidateName = categoryInfo && categoryInfo.courtNames[categoryInfo.courtNumbers.indexOf(court)]
              ? categoryInfo.courtNames[categoryInfo.courtNumbers.indexOf(court)]
              : court.toString();
            if (isCourtBusy(candidateName, timeStr, koDuration)) continue;
            assignedCourt = court;
            courtName = candidateName;
            break;
          }

          if (assignedCourt === 0) {
            remaining.push(koMatch);
            continue;
          }

          const matchDuration = koDuration;
          const { categoryId, duration, ...matchData } = koMatch;
          const scheduledMatch = { ...matchData, scheduled_time: timeStr, court: courtName || assignedCourt.toString() };
          scheduledMatches.get(categoryId)!.push(scheduledMatch);
          scheduledMatchIds.add(matchId);
          markCourtBusy(courtName || assignedCourt.toString(), timeStr, matchDuration);

          const prevMax = roundMaxTimePerCat.get(categoryId);
          if (!prevMax || timeStr > prevMax) roundMaxTimePerCat.set(categoryId, timeStr);

          if (!busyPlayers.has(timeStr)) busyPlayers.set(timeStr, new Set());
          koPlayerIds.forEach(id => busyPlayers.get(timeStr)!.add(id));

          anyScheduled = true;
          console.log(`[MULTI-CAT V7] OK Global KO M${koMatch.match_number} (${koMatch.round}) -> ${timeStr} court ${courtName || assignedCourt}`);
        }

        pending.length = 0;
        pending.push(...remaining);

        currentTimeSlot++;
        if (!anyScheduled && pending.length > 0) {
          continue;
        }
      }

      if (pending.length > 0) {
        console.warn(`[MULTI-CAT V7] ${pending.length} global knockout matches could not be scheduled after ${maxAttempts} attempts`);
        unschedulableKO.push(...pending);
      }
    }

    // Update categoryLastKOTime AFTER all matches in this tier are placed
    roundMaxTimePerCat.forEach((maxTime, catId) => {
      categoryLastKOTime.set(catId, maxTime);
      console.log(`[MULTI-CAT V7] Tier [${tier.join(',')}] done: categoryLastKOTime[${catId.substring(0, 8)}] = ${maxTime}`);
    });
  }

  if (unschedulableKO.length > 0) {
    console.warn(`[MULTI-CAT V7] WARNING: ${unschedulableKO.length} knockout matches could not be placed; validator will report them.`);
  }

  // Track matches Phase 2 explicitly could not fit; Phase 3 must NOT force them into slot 0.
  const unschedulableIds = new Set<string>(
    unschedulableKO.map(m => `${m.categoryId}_${m.match_number}`)
  );

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
      ['5th_semi'],
      ['consolation', 'semifinal', 'semi_final'],
      ['final', '3rd_place', '5th_place', '7th_place']
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
          const tbdDuration = tbdMatch.duration || categoryDurationMap.get(tbdMatch.categoryId) || matchDurationMinutes;

          let assignedCourt = 0;
          let assignedCourtName = '';
          for (const court of catCourts) {
            const courtIdx = catInfo ? catInfo.courtNumbers.indexOf(court) : court - 1;
            const candidateName = catInfo ? (catInfo.courtNames[courtIdx] || court.toString()) : (allCourtNames[court - 1] || court.toString());
            if (isCourtBusy(candidateName, timeStr, tbdDuration)) continue;
            assignedCourt = court;
            assignedCourtName = candidateName;
            break;
          }

          if (assignedCourt === 0) {
            remainingMatches.push(tbdMatch);
            continue;
          }

          markCourtBusy(assignedCourtName, timeStr, tbdDuration);

          const { categoryId, duration, ...matchData } = tbdMatch;
          const scheduledMatch = {
            ...matchData,
            scheduled_time: timeStr,
            court: assignedCourtName
          };

          const categoryScheduled = scheduledMatches.get(categoryId)!;
          categoryScheduled.push(scheduledMatch);
          scheduledMatchIds.add(matchId);

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

  // Post-schedule self-check: detect any court collisions the scheduler may have missed.
  const allFinal: { time: string; court: string; matchNum: number; catId: string }[] = [];
  for (const [catId, catMatches] of scheduledMatches) {
    for (const m of catMatches) {
      if (m.scheduled_time && m.court) {
        allFinal.push({ time: m.scheduled_time, court: courtKey(m.court), matchNum: m.match_number, catId });
      }
    }
  }
  const seen = new Map<string, typeof allFinal[0]>();
  for (const entry of allFinal) {
    const k = `${entry.time}__${entry.court}`;
    const prev = seen.get(k);
    if (prev) {
      console.error(`[SCHEDULER-COLLISION] Same court+time! Court="${entry.court}" Time=${entry.time}  Match#${prev.matchNum} (cat ${prev.catId.substring(0,8)}) vs Match#${entry.matchNum} (cat ${entry.catId.substring(0,8)})`);
    } else {
      seen.set(k, entry);
    }
  }
  if (seen.size === allFinal.length) {
    console.log(`[SCHEDULER-CHECK] ✓ No court collisions detected across ${allFinal.length} matches.`);
  }

  return scheduledMatches;
}

// =====================================================================
// Schedule validator
// Detects structural problems in a generated schedule BEFORE it is saved
// to the database. Used by TournamentDetail.handleGenerateSchedule to
// block bad inserts and inform the user what is wrong.
// =====================================================================

export interface ScheduleValidationResult {
  errors: string[];
  warnings: string[];
}

export interface ValidatorMatch {
  category_id?: string | null;
  round: string;
  match_number?: number;
  team1_id?: string | null;
  team2_id?: string | null;
  scheduled_time: string;
  court: string;
}

export interface ValidatorCategory {
  id: string;
  name: string;
  category_schedule?: CategoryScheduleEntry[] | null;
  match_duration_minutes?: number | null;
}

/**
 * Validate a generated schedule. Returns a list of errors and warnings.
 * ERRORS block the insert; WARNINGS let the user confirm.
 *
 * Checks:
 *   1. No slot has more matches than numberOfCourts.
 *   2. No team plays two matches at the same time.
 *   3. Every knockout match happens AFTER the last group_stage match of its category.
 *   4. Every match of a category fits inside that category's category_schedule window (if any).
 */
export function validateGeneratedSchedule(
  matches: ValidatorMatch[],
  numberOfCourts: number,
  categoriesInfo: ValidatorCategory[],
  globalMatchDurationMinutes: number = 30
): ScheduleValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const formatTime = (iso: string): string => {
    try {
      return new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return iso;
    }
  };

  // 1. Court overflow per slot
  const slotCounts = new Map<string, number>();
  for (const m of matches) {
    slotCounts.set(m.scheduled_time, (slotCounts.get(m.scheduled_time) || 0) + 1);
  }
  for (const [time, count] of slotCounts) {
    if (count > numberOfCourts) {
      errors.push(`${formatTime(time)}: ${count} jogos agendados em simultâneo, mas só existem ${numberOfCourts} campos.`);
    }
  }

  // 2. Team double-booking
  const teamsByTime = new Map<string, Map<string, number>>();
  for (const m of matches) {
    if (!teamsByTime.has(m.scheduled_time)) teamsByTime.set(m.scheduled_time, new Map());
    const teamMap = teamsByTime.get(m.scheduled_time)!;
    [m.team1_id, m.team2_id].forEach(tid => {
      if (tid) teamMap.set(tid, (teamMap.get(tid) || 0) + 1);
    });
  }
  for (const [time, teamMap] of teamsByTime) {
    for (const [teamId, count] of teamMap) {
      if (count > 1) {
        errors.push(`${formatTime(time)}: equipa ${teamId.substring(0, 8)} em ${count} jogos simultâneos.`);
      }
    }
  }

  // 2b. Court overlap (duration-aware): two matches on the same court whose
  //     [start, start+duration) windows intersect. Detects bugs where a
  //     category with shorter duration starts a match while another category's
  //     longer match is still running on the same court.
  const categoryById = new Map(categoriesInfo.map(c => [c.id, c]));
  interface MatchInterval {
    startMs: number;
    endMs: number;
    match: ValidatorMatch;
    durationMin: number;
  }
  const intervalsByCourt = new Map<string, MatchInterval[]>();
  for (const m of matches) {
    const startMs = new Date(m.scheduled_time).getTime();
    if (!Number.isFinite(startMs)) continue;
    const cat = m.category_id ? categoryById.get(m.category_id) : undefined;
    const durationMin = cat?.match_duration_minutes || globalMatchDurationMinutes;
    const endMs = startMs + durationMin * 60000;
    const key = m.court || '';
    if (!intervalsByCourt.has(key)) intervalsByCourt.set(key, []);
    intervalsByCourt.get(key)!.push({ startMs, endMs, match: m, durationMin });
  }
  for (const [courtName, intervals] of intervalsByCourt) {
    intervals.sort((a, b) => a.startMs - b.startMs);
    for (let i = 1; i < intervals.length; i++) {
      const prev = intervals[i - 1];
      const curr = intervals[i];
      // Overlap: current starts before previous ends.
      if (curr.startMs < prev.endMs) {
        const prevCat = prev.match.category_id ? categoryById.get(prev.match.category_id)?.name : undefined;
        const currCat = curr.match.category_id ? categoryById.get(curr.match.category_id)?.name : undefined;
        errors.push(
          `Campo "${courtName}": sobreposição detectada. ` +
          `${prevCat ?? 'Cat ?'} M${prev.match.match_number ?? '?'} (${formatTime(prev.match.scheduled_time)}, ${prev.durationMin}min) ` +
          `termina às ${formatTime(new Date(prev.endMs).toISOString())}, ` +
          `mas ${currCat ?? 'Cat ?'} M${curr.match.match_number ?? '?'} começa às ${formatTime(curr.match.scheduled_time)}.`
        );
      }
    }
  }

  // 3. Knockout after last group_stage per category
  const lastGroupTsByCat = new Map<string, number>();
  for (const m of matches) {
    if (!m.category_id) continue;
    if (m.round !== 'group_stage' && !m.round.startsWith('group_')) continue;
    const ts = new Date(m.scheduled_time).getTime();
    if (!Number.isNaN(ts) && ts > (lastGroupTsByCat.get(m.category_id) || 0)) {
      lastGroupTsByCat.set(m.category_id, ts);
    }
  }
  // categoryById already declared above (section 2b).
  for (const m of matches) {
    if (!m.category_id) continue;
    if (m.round === 'group_stage' || m.round.startsWith('group_')) continue;
    const lastGroupTs = lastGroupTsByCat.get(m.category_id);
    if (lastGroupTs === undefined) continue;
    const matchTs = new Date(m.scheduled_time).getTime();
    if (!Number.isNaN(matchTs) && matchTs < lastGroupTs) {
      const cat = categoryById.get(m.category_id);
      errors.push(
        `${cat?.name ?? m.category_id.substring(0, 8)} — ${m.round} M${m.match_number ?? '?'}: ` +
        `agendado ${formatTime(m.scheduled_time)}, ANTES do último jogo de grupos (${formatTime(new Date(lastGroupTs).toISOString())}).`
      );
    }
  }

  // 4. Matches must fit the category's category_schedule window (if defined)
  // Only apply to group_stage matches; knockouts may extend beyond the window.
  for (const m of matches) {
    if (!m.category_id) continue;
    if (m.round !== 'group_stage' && !m.round.startsWith('group_')) continue;
    const cat = categoryById.get(m.category_id);
    if (!cat || !cat.category_schedule || cat.category_schedule.length === 0) continue;

    const matchDate = new Date(m.scheduled_time);
    const matchTs = matchDate.getTime();
    const yyyy = matchDate.getFullYear();
    const mm = String(matchDate.getMonth() + 1).padStart(2, '0');
    const dd = String(matchDate.getDate()).padStart(2, '0');
    const matchDateStr = `${yyyy}-${mm}-${dd}`;

    let fits = false;
    for (const entry of cat.category_schedule) {
      if (entry.date !== matchDateStr) continue;
      const [sh, sm] = entry.start_time.split(':').map(Number);
      const [eh, em] = entry.end_time.split(':').map(Number);
      const [ey, emo, ed] = entry.date.split('-').map(Number);
      const winStart = new Date(ey, emo - 1, ed, sh, sm || 0).getTime();
      const winEnd = new Date(ey, emo - 1, ed, eh, em || 0).getTime();
      if (matchTs >= winStart && matchTs < winEnd) {
        fits = true;
        break;
      }
    }
    if (!fits) {
      errors.push(
        `${cat.name} — ${m.round} M${m.match_number ?? '?'}: agendado ${formatTime(m.scheduled_time)}, ` +
        `fora da janela da categoria.`
      );
    }
  }

  return { errors, warnings };
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

    // Final (3rd/4th place match intentionally NOT generated)
    addKoMatch('final');
    console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Added final match (no 3rd/4th place)`);
  } else if (numQFMatches >= 2) {
    // 8 players: just SFs → Final
    addKoMatch('semifinal');
    addKoMatch('semifinal');
    console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Added 2 semifinal matches`);

    addKoMatch('final');
    console.log(`[INDIVIDUAL_GROUPS_KNOCKOUT_MULTI] Added final match (no 3rd/4th place)`);
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
  knockoutStage: 'final' | 'semifinals' | 'quarterfinals' | 'round_of_16' = 'semifinals',
  hasThirdPlace: boolean = true
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

    // 3rd/4th place match intentionally NOT generated.
    // As meias-finais definem apenas vencedor e finalista; os perdedores ficam ex-aequo em 3º lugar.
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

    // 3rd/4th place match
    if (hasThirdPlace && rounds >= 2) {
      matches.push({
        round: '3rd_place',
        match_number: matchNumber++,
        team1_id: null,
        team2_id: null,
        scheduled_time: '',
        court: ''
      });
      console.log(`[KNOCKOUT_OPTIONS] Added 3rd_place match for teams`);
    }

    // Classification matches for 5th-8th when there are quarterfinals (4+ QF matches = 8+ teams)
    if (rounds >= 3) {
      // 2 x 5th_semi: QF losers play each other
      matches.push({
        round: '5th_semi',
        match_number: matchNumber++,
        team1_id: null,
        team2_id: null,
        scheduled_time: '',
        court: ''
      });
      matches.push({
        round: '5th_semi',
        match_number: matchNumber++,
        team1_id: null,
        team2_id: null,
        scheduled_time: '',
        court: ''
      });
      console.log(`[KNOCKOUT_OPTIONS] Added 2 x 5th_semi matches`);

      // 5th place final + 7th place final
      matches.push({
        round: '5th_place',
        match_number: matchNumber++,
        team1_id: null,
        team2_id: null,
        scheduled_time: '',
        court: ''
      });
      matches.push({
        round: '7th_place',
        match_number: matchNumber++,
        team1_id: null,
        team2_id: null,
        scheduled_time: '',
        court: ''
      });
      console.log(`[KNOCKOUT_OPTIONS] Added 5th_place and 7th_place matches`);
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
