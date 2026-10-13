/** Round-robin home/away calendar for Club League (Liga de Clubes). */

export type GeneratedConfrontation = {
  matchdayNumber: number;
  leg: 'home' | 'away';
  homeTeamId: string;
  awayTeamId: string;
};

/** Team input for schedule generation (clubKey groups I/II from the same club). */
export type ScheduleTeamInput = {
  id: string;
  name?: string | null;
  clubId?: string | null;
  clubKey?: string | null;
};

type RoundGames = [string, string][]; // unordered pairs per round

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Group key for "same club" (e.g. "Padel Blu M6 I" + "Padel Blu M6 II" → same key).
 * Prefers club_id when set; otherwise strips category/roman suffixes from the name.
 */
export function deriveClubKey(params: {
  name?: string | null;
  clubId?: string | null;
  clubKey?: string | null;
}): string {
  if (params.clubKey?.trim()) return params.clubKey.trim().toLowerCase();
  if (params.clubId) return `club:${params.clubId}`;
  const name = (params.name || '').trim();
  if (!name) return `unknown:${Math.random()}`;
  const cleaned = name
    .replace(/\s+M\d+\s*(?:I{1,3}|IV|VI{0,3}|IX|X|\d+)\s*$/i, '')
    .replace(/\s+(?:I{1,3}|IV|VI{0,3}|IX|X)\s*$/i, '')
    .replace(/\s+[12]\s*$/i, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return cleaned || name.toLowerCase();
}

function buildClubKeyMap(teams: ScheduleTeamInput[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of teams) {
    map.set(t.id, deriveClubKey(t));
  }
  return map;
}

/** How many times a club appears as home more than once in the same matchday. */
function clubHomeConflictCount(
  schedule: GeneratedConfrontation[],
  clubKeyByTeamId: Map<string, string>
): number {
  const byMd = new Map<number, string[]>();
  for (const g of schedule) {
    const list = byMd.get(g.matchdayNumber) || [];
    list.push(g.homeTeamId);
    byMd.set(g.matchdayNumber, list);
  }
  let conflicts = 0;
  for (const homes of byMd.values()) {
    const counts = new Map<string, number>();
    for (const teamId of homes) {
      const key = clubKeyByTeamId.get(teamId) || teamId;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const n of counts.values()) {
      if (n > 1) conflicts += n - 1;
    }
  }
  return conflicts;
}

/** Orientation masks for a round that keep ≤1 home game per club. */
function validOriMasksForRound(
  games: RoundGames,
  clubKeyByTeamId: Map<string, string>
): number[] {
  const bits = games.length;
  if (bits === 0) return [0];
  const valid: number[] = [];
  const limit = 1 << bits;
  for (let mask = 0; mask < limit; mask++) {
    const seen = new Set<string>();
    let ok = true;
    for (let i = 0; i < bits; i++) {
      const [a, b] = games[i];
      const home = ((mask >> i) & 1) === 1 ? a : b;
      const key = clubKeyByTeamId.get(home) || home;
      if (seen.has(key)) {
        ok = false;
        break;
      }
      seen.add(key);
    }
    if (ok) valid.push(mask);
  }
  return valid.length > 0 ? valid : Array.from({ length: limit }, (_, i) => i);
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

function scoreSchedule(
  schedule: GeneratedConfrontation[],
  teamIds: string[],
  clubKeyByTeamId: Map<string, string>
): number {
  const clubConflicts = clubHomeConflictCount(schedule, clubKeyByTeamId);
  // Hard rule: never two home games from the same club in one jornada
  const clubPenalty = clubConflicts * 1_000_000;

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

  return clubPenalty + maxPer * 5000 + hh * 1000 + teamsWithHh * 50 + aa * 20 + balance * 5;
}

function pickValidOriMasks(
  rounds: RoundGames[],
  clubKeyByTeamId: Map<string, string>
): number[] {
  return rounds.map(games => {
    const valid = validOriMasksForRound(games, clubKeyByTeamId);
    return valid[Math.floor(Math.random() * valid.length)] ?? 0;
  });
}

/**
 * Full season home+away.
 * Hard constraint: at most one home game per club per matchday (I and II of the
 * same club cannot both host on the same jornada). Return leg inverts home/away.
 */
export function generateClubLeagueSchedule(
  teamsOrIds: Array<string | ScheduleTeamInput>
): GeneratedConfrontation[] {
  if (teamsOrIds.length < 2) return [];

  const teams: ScheduleTeamInput[] = teamsOrIds.map(t =>
    typeof t === 'string' ? { id: t, clubKey: t } : t
  );
  const teamIds = teams.map(t => t.id);
  const clubKeyByTeamId = buildClubKeyMap(teams);

  let best: GeneratedConfrontation[] = [];
  let bestScore = Infinity;

  const orderTries = teamIds.length <= 4 ? 64 : teamIds.length <= 6 ? 120 : 60;

  for (let orderTry = 0; orderTry < orderTries; orderTry++) {
    const order = [...teamIds];
    if (orderTry > 0) shuffleInPlace(order);

    const rounds = circleRounds(order);
    const R = rounds.length;
    if (R === 0) continue;

    let oriMasks = pickValidOriMasks(rounds, clubKeyByTeamId);
    let returnOrder = Array.from({ length: R }, (_, i) => i + 1);
    if (orderTry % 3 === 1) returnOrder = Array.from({ length: R }, (_, i) => R - i);

    let cur = buildSchedule(rounds, oriMasks, returnOrder);
    let curScore = scoreSchedule(cur, teamIds, clubKeyByTeamId);

    for (let iter = 0; iter < 400; iter++) {
      let improved = false;

      for (let r = 0; r < R; r++) {
        const valid = validOriMasksForRound(rounds[r], clubKeyByTeamId);
        for (const mask of valid) {
          if (mask === oriMasks[r]) continue;
          const next = [...oriMasks];
          next[r] = mask;
          const trial = buildSchedule(rounds, next, returnOrder);
          const s = scoreSchedule(trial, teamIds, clubKeyByTeamId);
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
          const s = scoreSchedule(trial, teamIds, clubKeyByTeamId);
          if (s < curScore) {
            returnOrder = next;
            cur = trial;
            curScore = s;
            improved = true;
          }
        }
      }

      if (!improved) {
        if (Math.random() < 0.6) {
          const r = Math.floor(Math.random() * R);
          const valid = validOriMasksForRound(rounds[r], clubKeyByTeamId);
          oriMasks[r] = valid[Math.floor(Math.random() * valid.length)] ?? oriMasks[r];
        } else {
          const i = Math.floor(Math.random() * R);
          const j = Math.floor(Math.random() * R);
          [returnOrder[i], returnOrder[j]] = [returnOrder[j], returnOrder[i]];
        }
        cur = buildSchedule(rounds, oriMasks, returnOrder);
        curScore = scoreSchedule(cur, teamIds, clubKeyByTeamId);
      }

      if (curScore < bestScore) {
        bestScore = curScore;
        best = cur;
        // Zero club conflicts + low HH streak score
        if (bestScore < 1000) break;
      }
    }

    if (bestScore < 1000) break;
  }

  // Safety: if best still has club conflicts, force-repair first-leg orientations
  if (clubHomeConflictCount(best, clubKeyByTeamId) > 0 && best.length > 0) {
    const repaired = repairClubHomeConflicts(best, clubKeyByTeamId);
    if (clubHomeConflictCount(repaired, clubKeyByTeamId) < clubHomeConflictCount(best, clubKeyByTeamId)) {
      best = repaired;
    }
  }

  return best;
}

/**
 * Flip home/away within a matchday until no club hosts twice (greedy).
 * Prefers flipping non-derby games.
 */
function repairClubHomeConflicts(
  schedule: GeneratedConfrontation[],
  clubKeyByTeamId: Map<string, string>
): GeneratedConfrontation[] {
  const maxMd = Math.max(...schedule.map(c => c.matchdayNumber), 0);
  const half = Math.ceil(maxMd / 2);
  const out = schedule.map(g => ({ ...g }));

  for (let md = 1; md <= half; md++) {
    const idxs = out.map((g, i) => (g.matchdayNumber === md ? i : -1)).filter(i => i >= 0);
    // Greedy: while conflict, flip a home that shares club with another home
    for (let guard = 0; guard < 20; guard++) {
      const homeClubs = new Map<string, number[]>();
      for (const i of idxs) {
        const key = clubKeyByTeamId.get(out[i].homeTeamId) || out[i].homeTeamId;
        const list = homeClubs.get(key) || [];
        list.push(i);
        homeClubs.set(key, list);
      }
      const conflictIdxs = [...homeClubs.values()].filter(list => list.length > 1).flat();
      if (conflictIdxs.length === 0) break;

      // Flip the last conflicting game in the group
      const flipI = conflictIdxs[conflictIdxs.length - 1];
      const g = out[flipI];
      out[flipI] = {
        ...g,
        homeTeamId: g.awayTeamId,
        awayTeamId: g.homeTeamId,
      };
    }
  }

  // Rebuild return leg from repaired first leg (invert pairs by opponent mapping)
  const firstByPair = new Map<string, GeneratedConfrontation>();
  const pairKey = (a: string, b: string) => [a, b].sort().join('|');
  for (const g of out) {
    if (g.matchdayNumber <= half && g.leg === 'home') {
      firstByPair.set(pairKey(g.homeTeamId, g.awayTeamId), g);
    }
  }
  for (let i = 0; i < out.length; i++) {
    const g = out[i];
    if (g.matchdayNumber <= half) continue;
    const src = firstByPair.get(pairKey(g.homeTeamId, g.awayTeamId));
    if (!src) continue;
    // Return must be exact invert of first meeting
    out[i] = {
      ...g,
      homeTeamId: src.awayTeamId,
      awayTeamId: src.homeTeamId,
      leg: 'away',
    };
  }

  return out;
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

/**
 * Read date/time as stored wall-clock (avoids timestamptz → local shifts).
 * Accepts "YYYY-MM-DDTHH:mm:ss", "YYYY-MM-DD HH:mm:ss+00", etc.
 */
export function wallClockFromScheduled(
  iso: string | null | undefined
): { dateIso: string; timeHm: string } {
  if (!iso) return { dateIso: '', timeHm: '' };
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(String(iso).trim());
  if (m) return { dateIso: m[1], timeHm: `${m[2]}:${m[3]}` };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { dateIso: '', timeHm: '' };
  return {
    dateIso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    timeHm: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  };
}

/** Format Date/ISO timestamp as dd/MM/yyyy HH:mm (24h) */
export function formatEuDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const { dateIso, timeHm } = wallClockFromScheduled(iso);
  if (!dateIso) return '';
  return `${formatEuDate(dateIso)} ${timeHm}`;
}

/** Extract HH:mm (24h) from ISO timestamp */
export function formatEuTime(iso: string | null | undefined): string {
  return wallClockFromScheduled(iso).timeHm;
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

/** ISO weekday labels (1=Monday … 7=Sunday) for PT UI. */
export const HOME_WEEKDAY_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
  { value: 6, label: 'Sábado' },
  { value: 7, label: 'Domingo' },
];

export function homeWeekdayLabel(weekday?: number | null): string {
  if (weekday == null) return '—';
  return HOME_WEEKDAY_OPTIONS.find(o => o.value === weekday)?.label || '—';
}

/** JS getDay() 0=Sun…6=Sat → ISO 1=Mon…7=Sun */
export function jsDayToIsoWeekday(jsDay: number): number {
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * Date (YYYY-MM-DD) with the given ISO weekday in the same ISO week as refIso.
 * E.g. ref=Wednesday week → Monday of that week if isoWeekday=1.
 */
export function dateOnWeekdayInSameWeek(refIso: string, isoWeekday: number): string {
  const d = new Date(refIso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return refIso;
  const currentIso = jsDayToIsoWeekday(d.getDay());
  const clamped = Math.min(7, Math.max(1, Math.round(isoWeekday)));
  d.setDate(d.getDate() + (clamped - currentIso));
  return d.toISOString().slice(0, 10);
}

/** Normalize DB time ("18:00:00") or input to HH:mm */
export function normalizeHomeTime(raw?: string | null): string | null {
  if (!raw) return null;
  const parsed = parseEuTime(String(raw).slice(0, 5));
  return parsed || null;
}

/**
 * Build scheduled_time for a home game from the home team's slot + jornada week.
 * Falls back to jornada day1 + defaultTime when the team has no slot.
 */
export function scheduledTimeForHomeGame(params: {
  weekRefIso: string;
  defaultTime: string;
  homeWeekday?: number | null;
  homeTime?: string | null;
}): { dateIso: string; timeHm: string; scheduledTime: string } {
  const dateIso =
    params.homeWeekday != null && params.homeWeekday >= 1 && params.homeWeekday <= 7
      ? dateOnWeekdayInSameWeek(params.weekRefIso, params.homeWeekday)
      : params.weekRefIso;
  const timeHm = normalizeHomeTime(params.homeTime) || parseEuTime(params.defaultTime) || '18:00';
  return {
    dateIso,
    timeHm,
    scheduledTime: `${dateIso}T${timeHm}:00`,
  };
}
