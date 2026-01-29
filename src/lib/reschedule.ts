import { supabase } from './supabase';

export async function rescheduleRemainingMatches(tournamentId: string) {
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .single();

  if (!tournament) return;

  const { data: completedMatches } = await supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed')
    .order('scheduled_time', { ascending: false });

  if (!completedMatches || completedMatches.length === 0) return;

  const lastCompletedMatch = completedMatches[0];
  const lastCompletedTime = new Date(lastCompletedMatch.scheduled_time);
  const matchDurationMinutes = tournament.match_duration_minutes || 15;

  const nextAvailableTime = new Date(lastCompletedTime);
  nextAvailableTime.setMinutes(nextAvailableTime.getMinutes() + matchDurationMinutes);

  const { data: pendingMatches } = await supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .in('status', ['scheduled', 'in_progress'])
    .order('round', { ascending: false })
    .order('match_number', { ascending: true });

  if (!pendingMatches || pendingMatches.length === 0) return;

  const [startHour, startMinute] = (tournament.start_time || '09:00').split(':').map(Number);
  const [endHour, endMinute] = (tournament.end_time || '21:00').split(':').map(Number);
  const startTotalMinutes = startHour * 60 + startMinute;
  const endTotalMinutes = endHour * 60 + (endMinute || 0);
  const availableMinutesPerDay = endTotalMinutes - startTotalMinutes;
  const slotsPerDay = Math.floor(availableMinutesPerDay / matchDurationMinutes);
  const numberOfCourts = tournament.number_of_courts || 1;

  let currentTime = new Date(nextAvailableTime);
  let timeSlot = 0;

  const updates = [];

  for (const match of pendingMatches) {
    if (!match.team1_id || !match.team2_id) {
      continue;
    }

    const court = ((timeSlot % numberOfCourts) + 1).toString();
    const slotIndex = Math.floor(timeSlot / numberOfCourts);

    let scheduledTime = new Date(currentTime);
    scheduledTime.setHours(startHour, startMinute, 0, 0);

    const hoursToAdd = (slotIndex % slotsPerDay) * matchDurationHours;
    scheduledTime.setHours(scheduledTime.getHours() + hoursToAdd);

    const daysToAdd = Math.floor(slotIndex / slotsPerDay);
    scheduledTime.setDate(scheduledTime.getDate() + daysToAdd);

    if (scheduledTime.getHours() >= endHour) {
      scheduledTime.setDate(scheduledTime.getDate() + 1);
      scheduledTime.setHours(startHour, startMinute, 0, 0);
    }

    updates.push({
      id: match.id,
      scheduled_time: scheduledTime.toISOString(),
      court: court,
    });

    timeSlot++;
  }

  for (const update of updates) {
    await supabase
      .from('matches')
      .update({
        scheduled_time: update.scheduled_time,
        court: update.court,
      })
      .eq('id', update.id);
  }

  return updates.length;
}
