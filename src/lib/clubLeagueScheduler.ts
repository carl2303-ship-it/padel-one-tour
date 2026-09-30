/** Round-robin home/away calendar for Club League (Liga de Clubes). */

export type ClubLeagueTeamRef = {
  id: string;
  name: string;
};

export type GeneratedConfrontation = {
  matchdayNumber: number;
  leg: 'home' | 'away';
  homeTeamId: string;
  awayTeamId: string;
};

/**
 * Circle method: N even → N-1 rounds per leg; N odd → N rounds per leg (with bye).
 * Returns one full season of home + away legs.
 */
export function generateClubLeagueSchedule(teamIds: string[]): GeneratedConfrontation[] {
  if (teamIds.length < 2) return [];

  const ids = [...teamIds];
  const odd = ids.length % 2 === 1;
  if (odd) ids.push('__BYE__');

  const n = ids.length;
  const roundsPerLeg = n - 1;
  const half = n / 2;
  const rotating = ids.slice(1);
  const result: GeneratedConfrontation[] = [];

  for (let legIndex = 0; legIndex < 2; legIndex++) {
    const leg: 'home' | 'away' = legIndex === 0 ? 'home' : 'away';
    const baseRound = legIndex * roundsPerLeg;

    // Reset rotation each leg so pairings mirror with home/away swapped
    const rot = [...rotating];

    for (let round = 0; round < roundsPerLeg; round++) {
      const ordered = [ids[0], ...rot];
      const matchdayNumber = baseRound + round + 1;

      for (let i = 0; i < half; i++) {
        const a = ordered[i];
        const b = ordered[n - 1 - i];
        if (a === '__BYE__' || b === '__BYE__') continue;

        // First leg: lower index in ordered is "home" on even rounds for variety;
        // Second leg: swap home/away relative to first meeting.
        let home = a;
        let away = b;
        if (round % 2 === 1) {
          home = b;
          away = a;
        }
        if (leg === 'away') {
          const tmp = home;
          home = away;
          away = tmp;
        }

        result.push({
          matchdayNumber,
          leg,
          homeTeamId: home,
          awayTeamId: away,
        });
      }

      // Rotate clockwise: last -> front of rotating ring
      const last = rot.pop();
      if (last !== undefined) rot.unshift(last);
    }
  }

  return result;
}

export function expectedMatchdayCount(teamCount: number): number {
  if (teamCount < 2) return 0;
  const n = teamCount % 2 === 0 ? teamCount : teamCount + 1;
  return 2 * (n - 1);
}

export function assignMatchdayDates(
  matchdayCount: number,
  startDate: string,
  intervalDays = 7
): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + 'T12:00:00');
  for (let i = 0; i < matchdayCount; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i * intervalDays);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}
