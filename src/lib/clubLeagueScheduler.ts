/** Round-robin home/away calendar for Club League (Liga de Clubes). */

export type GeneratedConfrontation = {
  matchdayNumber: number;
  leg: 'home' | 'away';
  homeTeamId: string;
  awayTeamId: string;
};

type RoundGames = [string, string][]; // unordered pairs per round

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Circle method: rounds of unordered pairs. */
function circleRounds(teamIds: string[]): RoundGames[] {
  const ids = [...teamIds];
  if (ids.length % 2 === 1) ids.push('__BYE__');
  const n = ids.length;
  const rounds = n - 1;
  const half = n / 2;
  const rotating = ids.slice(1);
  const out: RoundGames[] = [];

  for (let round = 0; round < rounds; round++) {
    const ordered = [ids[0], ...rotating];
    const games: RoundGames = [];
    for (let i = 0; i < half; i++) {
      const a = ordered[i];
      const b = ordered[n - 1 - i];
      if (a !== '__BYE__' && b !== '__BYE__') games.push([a, b]);
    }
    out.push(games);
    const last = rotating.pop();
    if (last !== undefined) rotating.unshift(last);
  }
  return out;
}

function buildSchedule(
  rounds: RoundGames[],
  oriMasks: number[],
  returnOrder: number[]
): GeneratedConfrontation[] {
  const R = rounds.length;
  const first: GeneratedConfrontation[] = [];

  for (let r = 0; r < R; r++) {
    const mask = oriMasks[r];
    const games = rounds[r];
    for (let i = 0; i < games.length; i++) {
      const [a, b] = games[i];
      const aHome = ((mask >> i) & 1) === 1;
      first.push({
        matchdayNumber: r + 1,
        leg: 'home',
        homeTeamId: aHome ? a : b,
        awayTeamId: aHome ? b : a,
      });
    }
  }

  const byMd = new Map<number, GeneratedConfrontation[]>();
  for (const g of first) {
    const list = byMd.get(g.matchdayNumber) || [];
    list.push(g);
    byMd.set(g.matchdayNumber, list);
  }

  const second: GeneratedConfrontation[] = [];
  for (let slot = 0; slot < R; slot++) {
    const src = returnOrder[slot];
    for (const g of byMd.get(src) || []) {
      second.push({
        matchdayNumber: R + slot + 1,
        leg: 'away',
        homeTeamId: g.awayTeamId,
        awayTeamId: g.homeTeamId,
      });
    }
  }

  return [...first, ...second];
}

function scoreSchedule(schedule: GeneratedConfrontation[], teamIds: string[]): number {
  const maxMd = Math.max(...schedule.map(c => c.matchdayNumber), 0);
  const role = new Map<string, Map<number, 'H' | 'A' | null>>();
  teamIds.forEach(id => {
    const m = new Map<number, 'H' | 'A' | null>();
    for (let md = 1; md <= maxMd; md++) m.set(md, null);
    role.set(id, m);
  });
  for (const g of schedule) {
    role.get(g.homeTeamId)!.set(g.matchdayNumber, 'H');
    role.get(g.awayTeamId)!.set(g.matchdayNumber, 'A');
  }

  let hh = 0;
  let aa = 0;
  let maxPer = 0;
  let teamsWithHh = 0;
  const homeTotals: number[] = [];

  for (const id of teamIds) {
    const m = role.get(id)!;
    let homes = 0;
    let per = 0;
    let prev: 'H' | 'A' | null = null;
    let prevMd = 0;
    for (let md = 1; md <= maxMd; md++) {
      const r = m.get(md) || null;
      if (!r) continue;
      if (r === 'H') homes++;
      if (prev && prevMd === md - 1) {
        if (prev === 'H' && r === 'H') {
          hh++;
          per++;
        }
        if (prev === 'A' && r === 'A') aa++;
      }
      prev = r;
      prevMd = md;
    }
    if (per > 0) teamsWithHh++;
    maxPer = Math.max(maxPer, per);
    homeTotals.push(homes);
  }

  const avg = homeTotals.reduce((a, b) => a + b, 0) / Math.max(homeTotals.length, 1);
  let balance = 0;
  for (const h of homeTotals) balance += Math.abs(h - avg);

  // Prioritize: no team with 2+ HH streaks, then total HH, then fewer teams affected
  return maxPer * 5000 + hh * 1000 + teamsWithHh * 50 + aa * 20 + balance * 5;
}

/**
 * Full season home+away.
 * Note: with an even number of teams it is mathematically impossible for every
 * team to avoid all consecutive homes (each plays every jornada). We minimize
 * total consecutive homes and cap per-team streaks.
 */
export function generateClubLeagueSchedule(teamIds: string[]): GeneratedConfrontation[] {
  if (teamIds.length < 2) return [];

  let best: GeneratedConfrontation[] = [];
  let bestScore = Infinity;

  const orderTries = teamIds.length <= 4 ? 48 : teamIds.length <= 6 ? 80 : 40;

  for (let orderTry = 0; orderTry < orderTries; orderTry++) {
    const order = [...teamIds];
    if (orderTry > 0) shuffleInPlace(order);

    const rounds = circleRounds(order);
    const R = rounds.length;
    if (R === 0) continue;

    let oriMasks = Array.from({ length: R }, () => Math.floor(Math.random() * 8));
    let returnOrder = Array.from({ length: R }, (_, i) => i + 1);
    if (orderTry % 3 === 1) returnOrder = Array.from({ length: R }, (_, i) => R - i);

    let cur = buildSchedule(rounds, oriMasks, returnOrder);
    let curScore = scoreSchedule(cur, teamIds);

    for (let iter = 0; iter < 350; iter++) {
      let improved = false;

      for (let r = 0; r < R; r++) {
        const bits = Math.max(rounds[r].length, 1);
        for (let bit = 0; bit < bits; bit++) {
          const next = [...oriMasks];
          next[r] ^= 1 << bit;
          const trial = buildSchedule(rounds, next, returnOrder);
          const s = scoreSchedule(trial, teamIds);
          if (s < curScore) {
            oriMasks = next;
            cur = trial;
            curScore = s;
            improved = true;
          }
        }
      }

      for (let i = 0; i < R; i++) {
        for (let j = i + 1; j < R; j++) {
          const next = [...returnOrder];
          [next[i], next[j]] = [next[j], next[i]];
          const trial = buildSchedule(rounds, oriMasks, next);
          const s = scoreSchedule(trial, teamIds);
          if (s < curScore) {
            returnOrder = next;
            cur = trial;
            curScore = s;
            improved = true;
          }
        }
      }

      if (!improved) {
        if (Math.random() < 0.5) {
          oriMasks[Math.floor(Math.random() * R)] = Math.floor(Math.random() * 8);
        } else {
          const i = Math.floor(Math.random() * R);
          const j = Math.floor(Math.random() * R);
          [returnOrder[i], returnOrder[j]] = [returnOrder[j], returnOrder[i]];
        }
        cur = buildSchedule(rounds, oriMasks, returnOrder);
        curScore = scoreSchedule(cur, teamIds);
      }

      if (curScore < bestScore) {
        bestScore = curScore;
        best = cur;
        // Ideal for odd teams (byes); for even, maxPer<=1 and low HH is the practical optimum
        if (bestScore < 1000) break;
      }
    }

    if (bestScore < 1000) break;
  }

  return best;
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
