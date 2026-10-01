/** Round-robin home/away calendar for Club League (Liga de Clubes). */

export type GeneratedConfrontation = {
  matchdayNumber: number;
  leg: 'home' | 'away';
  homeTeamId: string;
  awayTeamId: string;
};

type Pairing = { matchdayNumber: number; teamA: string; teamB: string };

/**
 * Circle method pairings (unordered). N even → N-1 rounds; N odd → N rounds (bye).
 */
function generatePairings(teamIds: string[]): Pairing[] {
  if (teamIds.length < 2) return [];

  const ids = [...teamIds];
  if (ids.length % 2 === 1) ids.push('__BYE__');

  const n = ids.length;
  const rounds = n - 1;
  const half = n / 2;
  const rotating = ids.slice(1);
  const pairings: Pairing[] = [];

  for (let round = 0; round < rounds; round++) {
    const ordered = [ids[0], ...rotating];
    for (let i = 0; i < half; i++) {
      const a = ordered[i];
      const b = ordered[n - 1 - i];
      if (a === '__BYE__' || b === '__BYE__') continue;
      pairings.push({ matchdayNumber: round + 1, teamA: a, teamB: b });
    }
    const last = rotating.pop();
    if (last !== undefined) rotating.unshift(last);
  }

  return pairings;
}

/**
 * Assign home/away for first leg by balancing consecutive homes and total homes.
 * Second leg = exact reverse of first meeting.
 */
export function generateClubLeagueSchedule(teamIds: string[]): GeneratedConfrontation[] {
  if (teamIds.length < 2) return [];

  const pairings = generatePairings(teamIds);
  const roundsPerLeg = Math.max(...pairings.map(p => p.matchdayNumber), 0);
  const homeCount = new Map<string, number>();
  const lastWasHome = new Map<string, boolean | null>();
  teamIds.forEach(id => {
    homeCount.set(id, 0);
    lastWasHome.set(id, null);
  });

  const firstLeg: GeneratedConfrontation[] = [];

  for (let round = 1; round <= roundsPerLeg; round++) {
    const roundPairs = pairings.filter(p => p.matchdayNumber === round);

    for (const p of roundPairs) {
      const a = p.teamA;
      const b = p.teamB;

      const score = (team: string) => {
        let s = 0;
        // Prefer fewer homes so far
        s -= (homeCount.get(team) || 0) * 10;
        // Avoid consecutive home matchdays
        if (lastWasHome.get(team) === true) s -= 50;
        // Prefer home after an away (avoids consecutive homes on the return leg)
        if (lastWasHome.get(team) === false) s += 45;
        // Stable tie-break by id
        s += team < (team === a ? b : a) ? 1 : -1;
        return s;
      };

      let home = a;
      let away = b;
      if (score(b) > score(a)) {
        home = b;
        away = a;
      }

      homeCount.set(home, (homeCount.get(home) || 0) + 1);
      lastWasHome.set(home, true);
      lastWasHome.set(away, false);

      firstLeg.push({
        matchdayNumber: round,
        leg: 'home',
        homeTeamId: home,
        awayTeamId: away,
      });
    }
  }

  const secondLeg: GeneratedConfrontation[] = firstLeg.map(c => ({
    matchdayNumber: c.matchdayNumber + roundsPerLeg,
    leg: 'away' as const,
    homeTeamId: c.awayTeamId,
    awayTeamId: c.homeTeamId,
  }));

  return [...firstLeg, ...secondLeg];
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

/** ISO YYYY-MM-DD → dd/MM/yyyy */
export function formatEuDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** dd/MM/yyyy or d/M/yyyy → ISO YYYY-MM-DD (or '' if invalid) */
export function parseEuDate(input: string | null | undefined): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!m) return '';
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3];
  const d = new Date(`${yyyy}-${mm}-${dd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  if (d.getFullYear() !== Number(yyyy) || d.getMonth() + 1 !== Number(mm) || d.getDate() !== Number(dd)) {
    return '';
  }
  return `${yyyy}-${mm}-${dd}`;
}

/** Format Date/ISO timestamp as dd/MM/yyyy HH:mm (24h) */
export function formatEuDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

/** Extract HH:mm (24h) from ISO timestamp */
export function formatEuTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Parse HH:mm or H:mm (24h). Rejects AM/PM strings. */
export function parseEuTime(input: string | null | undefined): string {
  if (!input) return '';
  const trimmed = input.trim().toLowerCase().replace(/\./g, ':');
  if (/[ap]\.?m\.?/.test(trimmed)) return '';
  const m = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!m) return '';
  const hh = Number(m[1]);
  const mi = Number(m[2]);
  if (hh < 0 || hh > 23 || mi < 0 || mi > 59) return '';
  return `${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
