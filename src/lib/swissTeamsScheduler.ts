import type { ScheduledMatch } from './scheduler';

export type SwissTeam = {
  id: string;
  name: string;
  seed?: number | null;
  category_id?: string | null;
};

export type SwissMatchLike = {
  round?: string | null;
  team1_id?: string | null;
  team2_id?: string | null;
  status?: string | null;
  winner_id?: string | null;
  team1_score_set1?: number | null;
  team2_score_set1?: number | null;
  team1_score_set2?: number | null;
  team2_score_set2?: number | null;
  team1_score_set3?: number | null;
  team2_score_set3?: number | null;
};

export type SwissStanding = {
  teamId: string;
  name: string;
  seed: number | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gamesFor: number;
  gamesAgainst: number;
  gameDiff: number;
  byeWins: number;
};

export type SwissPairing = {
  team1Id: string | null;
  team2Id: string | null;
  isBye: boolean;
};

export const SWISS_ROUND_PREFIX = 'swiss_r';

export function swissRoundName(roundNumber: number): string {
  return `${SWISS_ROUND_PREFIX}${roundNumber}`;
}

export function parseSwissRoundNumber(round: string | null | undefined): number | null {
  if (!round || !round.startsWith(SWISS_ROUND_PREFIX)) return null;
  const n = parseInt(round.slice(SWISS_ROUND_PREFIX.length), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function isSwissRound(round: string | null | undefined): boolean {
  return parseSwissRoundNumber(round) != null;
}

function matchGames(m: SwissMatchLike): { t1: number; t2: number } {
  const t1 = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
  const t2 = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);
  return { t1, t2 };
}

function matchHasResult(m: SwissMatchLike): boolean {
  const { t1, t2 } = matchGames(m);
  return m.status === 'completed' || t1 > 0 || t2 > 0 || !!m.winner_id;
}

function matchWinnerId(m: SwissMatchLike): string | null {
  if (m.winner_id && (m.winner_id === m.team1_id || m.winner_id === m.team2_id)) {
    return m.winner_id;
  }
  const { t1, t2 } = matchGames(m);
  if (!m.team1_id || !m.team2_id || t1 === t2) return null;
  return t1 > t2 ? m.team1_id : m.team2_id;
}

/** Collect opponent history from completed swiss matches (excludes byes). */
export function buildOpponentMap(matches: SwissMatchLike[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };
  for (const m of matches) {
    if (!isSwissRound(m.round || '')) continue;
    if (!m.team1_id || !m.team2_id) continue;
    if (!matchHasResult(m)) continue;
    add(m.team1_id, m.team2_id);
    add(m.team2_id, m.team1_id);
  }
  return map;
}

export function computeSwissStandings(
  teams: SwissTeam[],
  matches: SwissMatchLike[],
): SwissStanding[] {
  const stats = new Map<string, SwissStanding>();
  teams.forEach(t => {
    stats.set(t.id, {
      teamId: t.id,
      name: t.name,
      seed: t.seed ?? null,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      gamesFor: 0,
      gamesAgainst: 0,
      gameDiff: 0,
      byeWins: 0,
    });
  });

  for (const m of matches) {
    if (!isSwissRound(m.round || '')) continue;
    // Bye: team1 set, team2 null, completed
    if (m.team1_id && !m.team2_id && matchHasResult(m)) {
      const s = stats.get(m.team1_id);
      if (s) {
        s.played += 1;
        s.wins += 1;
        s.byeWins += 1;
      }
      continue;
    }
    if (!m.team1_id || !m.team2_id || !matchHasResult(m)) continue;
    const { t1, t2 } = matchGames(m);
    const s1 = stats.get(m.team1_id);
    const s2 = stats.get(m.team2_id);
    if (!s1 || !s2) continue;
    s1.played += 1;
    s2.played += 1;
    s1.gamesFor += t1;
    s1.gamesAgainst += t2;
    s2.gamesFor += t2;
    s2.gamesAgainst += t1;
    s1.gameDiff = s1.gamesFor - s1.gamesAgainst;
    s2.gameDiff = s2.gamesFor - s2.gamesAgainst;
    const winner = matchWinnerId(m);
    if (winner === m.team1_id) {
      s1.wins += 1;
      s2.losses += 1;
    } else if (winner === m.team2_id) {
      s2.wins += 1;
      s1.losses += 1;
    } else {
      // Timed matches can end level (e.g. 5-5) with status completed and no winner
      s1.draws += 1;
      s2.draws += 1;
    }
  }

  return Array.from(stats.values()).sort((a, b) => {
    // Points: win=2, draw=1 (aligned with other team formats in the app)
    const ptsA = a.wins * 2 + a.draws;
    const ptsB = b.wins * 2 + b.draws;
    if (ptsB !== ptsA) return ptsB - ptsA;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.gameDiff !== a.gameDiff) return b.gameDiff - a.gameDiff;
    if (b.gamesFor !== a.gamesFor) return b.gamesFor - a.gamesFor;
    const seedA = a.seed ?? 9999;
    const seedB = b.seed ?? 9999;
    if (seedA !== seedB) return seedA - seedB;
    return a.name.localeCompare(b.name);
  });
}

function shuffleStable<T>(arr: T[], seedKey: string): T[] {
  const out = [...arr];
  let h = 0;
  for (let i = 0; i < seedKey.length; i++) h = (h * 31 + seedKey.charCodeAt(i)) >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    h = (h * 1664525 + 1013904223) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Order teams for round 1: by seed, else deterministic shuffle from tournament id. */
export function orderTeamsForRound1(teams: SwissTeam[], shuffleKey: string): SwissTeam[] {
  const withSeed = teams.filter(t => t.seed != null && t.seed > 0);
  if (withSeed.length === teams.length && teams.length >= 2) {
    return [...teams].sort((a, b) => (a.seed ?? 9999) - (b.seed ?? 9999) || a.name.localeCompare(b.name));
  }
  return shuffleStable(teams, shuffleKey);
}

function isRematch(
  a: string,
  b: string,
  previousOpponents: Map<string, Set<string>>,
): boolean {
  return !!previousOpponents.get(a)?.has(b);
}

/** Try partner swaps between pairs to eliminate rematches (one-step cross).
 * Prefer nearby boards so a bottom rematch does not destroy 1º vs 2º. */
function resolveRematches(
  pairings: SwissPairing[],
  previousOpponents: Map<string, Set<string>>,
): SwissPairing[] {
  const result = pairings.map(p => ({ ...p }));

  const neighborIndices = (i: number, n: number): number[] => {
    const out: number[] = [];
    for (let d = 1; d < n; d++) {
      if (i - d >= 0) out.push(i - d);
      if (i + d < n) out.push(i + d);
    }
    return out;
  };

  // Fix from bottom boards upward so float stays local
  for (let i = result.length - 1; i >= 0; i--) {
    const p = result[i];
    if (p.isBye || !p.team1Id || !p.team2Id) continue;
    if (!isRematch(p.team1Id, p.team2Id, previousOpponents)) continue;

    let fixed = false;
    for (const j of neighborIndices(i, result.length)) {
      const q = result[j];
      if (q.isBye || !q.team1Id || !q.team2Id) continue;

      const a = p.team1Id;
      const b = p.team2Id;
      const c = q.team1Id;
      const d = q.team2Id;
      const candidates: [SwissPairing, SwissPairing][] = [
        [
          { team1Id: a, team2Id: c, isBye: false },
          { team1Id: b, team2Id: d, isBye: false },
        ],
        [
          { team1Id: a, team2Id: d, isBye: false },
          { team1Id: b, team2Id: c, isBye: false },
        ],
      ];

      for (const [p2, q2] of candidates) {
        if (
          !isRematch(p2.team1Id!, p2.team2Id!, previousOpponents) &&
          !isRematch(q2.team1Id!, q2.team2Id!, previousOpponents)
        ) {
          result[i] = p2;
          result[j] = q2;
          fixed = true;
          break;
        }
      }
      if (fixed) break;
    }
  }

  return result;
}

/**
 * Greedy Swiss pairing: sort by standings, pair adjacent avoiding rematches.
 * Odd count → lowest-ranked eligible team gets a bye (prefer fewer previous byes).
 * If a rematch remains, try crossing partners with another pair.
 */
export function pairSwissRound(
  standings: SwissStanding[],
  previousOpponents: Map<string, Set<string>>,
): SwissPairing[] {
  const pool = [...standings];
  const pairings: SwissPairing[] = [];

  if (pool.length % 2 === 1) {
    // Give bye to lowest-ranked team with fewest byeWins
    let byeIdx = pool.length - 1;
    for (let i = pool.length - 1; i >= 0; i--) {
      if (pool[i].byeWins < pool[byeIdx].byeWins) byeIdx = i;
    }
    const byeTeam = pool.splice(byeIdx, 1)[0];
    pairings.push({ team1Id: byeTeam.teamId, team2Id: null, isBye: true });
  }

  const unpaired = pool.map(s => s.teamId);
  while (unpaired.length >= 2) {
    const a = unpaired.shift()!;
    const played = previousOpponents.get(a) || new Set();
    let bIdx = unpaired.findIndex(id => !played.has(id));
    if (bIdx < 0) bIdx = 0; // temporary; resolveRematches may fix
    const b = unpaired.splice(bIdx, 1)[0];
    pairings.push({ team1Id: a, team2Id: b, isBye: false });
  }

  return resolveRematches(pairings, previousOpponents);
}

/**
 * Last Swiss round = placement finals: 1º vs 2º, 3º vs 4º, …
 * Rematches are allowed (no anti-rematch).
 */
export function pairSwissFinalsRound(standings: SwissStanding[]): SwissPairing[] {
  const pool = [...standings];
  const pairings: SwissPairing[] = [];

  if (pool.length % 2 === 1) {
    const byeTeam = pool.pop()!;
    pairings.push({ team1Id: byeTeam.teamId, team2Id: null, isBye: true });
  }

  for (let i = 0; i + 1 < pool.length; i += 2) {
    pairings.push({
      team1Id: pool[i].teamId,
      team2Id: pool[i + 1].teamId,
      isBye: false,
    });
  }

  return pairings;
}

export function isSwissFinalsRound(roundNumber: number, maxRounds: number): boolean {
  return roundNumber > 0 && maxRounds > 0 && roundNumber === maxRounds;
}

export function pairRound1(teamsOrdered: SwissTeam[]): SwissPairing[] {
  const ids = teamsOrdered.map(t => t.id);
  const pairings: SwissPairing[] = [];
  const list = [...ids];
  if (list.length % 2 === 1) {
    const bye = list.pop()!;
    pairings.push({ team1Id: bye, team2Id: null, isBye: true });
  }
  // Seed style: 1vs(n/2+1), 2vs(n/2+2)... when even; else adjacent after ordering
  const half = list.length / 2;
  const top = list.slice(0, half);
  const bottom = list.slice(half);
  for (let i = 0; i < top.length; i++) {
    pairings.push({ team1Id: top[i], team2Id: bottom[i], isBye: false });
  }
  return pairings;
}

export function getLatestCompletedSwissRound(matches: SwissMatchLike[]): number {
  let maxCompleted = 0;
  const byRound = new Map<number, SwissMatchLike[]>();
  for (const m of matches) {
    const n = parseSwissRoundNumber(m.round || '');
    if (n == null) continue;
    if (!byRound.has(n)) byRound.set(n, []);
    byRound.get(n)!.push(m);
  }
  for (const [n, roundMatches] of byRound) {
    const playable = roundMatches.filter(m => m.team1_id && m.team2_id);
    const byes = roundMatches.filter(m => m.team1_id && !m.team2_id);
    const allPlayableDone = playable.length === 0 || playable.every(matchHasResult);
    const allByesDone = byes.every(matchHasResult);
    if (allPlayableDone && allByesDone && (playable.length > 0 || byes.length > 0)) {
      maxCompleted = Math.max(maxCompleted, n);
    }
  }
  return maxCompleted;
}

export function getHighestSwissRound(matches: SwissMatchLike[]): number {
  let max = 0;
  for (const m of matches) {
    const n = parseSwissRoundNumber(m.round || '');
    if (n != null) max = Math.max(max, n);
  }
  return max;
}

export function isSwissRoundComplete(matches: SwissMatchLike[], roundNumber: number): boolean {
  const roundMatches = matches.filter(m => parseSwissRoundNumber(m.round || '') === roundNumber);
  if (roundMatches.length === 0) return false;
  return roundMatches.every(m => {
    if (m.team1_id && !m.team2_id) return matchHasResult(m);
    if (m.team1_id && m.team2_id) return matchHasResult(m);
    return true;
  });
}

export type BuildSwissRoundOptions = {
  pairings: SwissPairing[];
  roundNumber: number;
  matchNumberOffset?: number;
  numberOfCourts: number;
  courtNames?: string[];
  scheduledTime: string;
};

export function buildSwissRoundMatches(opts: BuildSwissRoundOptions): ScheduledMatch[] {
  const {
    pairings,
    roundNumber,
    matchNumberOffset = 0,
    numberOfCourts,
    courtNames,
    scheduledTime,
  } = opts;
  const round = swissRoundName(roundNumber);
  const matches: ScheduledMatch[] = [];
  let matchNumber = matchNumberOffset + 1;
  let courtIdx = 0;

  for (const p of pairings) {
    if (p.isBye || !p.team2Id) {
      matches.push({
        round,
        match_number: matchNumber++,
        team1_id: p.team1Id,
        team2_id: null,
        scheduled_time: scheduledTime,
        court: 'BYE',
      });
      continue;
    }
    const courtNum = (courtIdx % Math.max(1, numberOfCourts)) + 1;
    const courtLabel = courtNames?.[courtNum - 1] || String(courtNum);
    matches.push({
      round,
      match_number: matchNumber++,
      team1_id: p.team1Id,
      team2_id: p.team2Id,
      scheduled_time: scheduledTime,
      court: courtLabel,
    });
    courtIdx++;
  }

  return matches;
}

export function clampSwissRounds(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 5;
  return Math.min(9, Math.max(3, Math.round(n)));
}

/** Last round behaviour:
 * - finals: 1ºvs2º…, rematches OK, does NOT count in W/D/L (only sets ranking #)
 * - placement: 1ºvs2º…, rematches OK, DOES count in standings (original)
 * - swiss: normal Swiss pairing without rematches, counts in standings
 */
export type SwissLastRoundMode = 'finals' | 'swiss' | 'placement';

export function normalizeSwissLastRoundMode(value: unknown): SwissLastRoundMode {
  if (value === 'swiss') return 'swiss';
  if (value === 'placement') return 'placement';
  return 'finals';
}

/** Last round uses 1ºvs2º / 3ºvs4º pairing (rematches allowed). */
export function usesSwissPlacementPairing(mode: SwissLastRoundMode): boolean {
  return mode === 'finals' || mode === 'placement';
}

/** Matches that feed W/D/L/J stats (excludes last round when mode is finals). */
export function filterSwissMatchesForStandings(
  matches: SwissMatchLike[],
  maxRounds: number,
  lastRoundMode: SwissLastRoundMode,
): SwissMatchLike[] {
  return matches.filter(m => {
    const n = parseSwissRoundNumber(m.round || '');
    if (n == null) return false;
    if (lastRoundMode === 'finals' && n >= maxRounds) return false;
    return true;
  });
}

export function getSwissFinalsMatches(
  matches: SwissMatchLike[],
  maxRounds: number,
): SwissMatchLike[] {
  return matches.filter(m => parseSwissRoundNumber(m.round || '') === maxRounds);
}

/**
 * Placement ranking from finals: 1ºvs2º → places 1–2, 3ºvs4º → 3–4, …
 * Draw / incomplete: keep relative order from pre-final standings.
 */
export function computeSwissPlacementRanking(
  standingsBeforeFinals: SwissStanding[],
  finalsMatches: SwissMatchLike[],
): Array<{ teamId: string; position: number }> {
  const result: Array<{ teamId: string; position: number }> = [];
  const used = new Set<string>();

  const findMatch = (a: string, b: string | null) => {
    if (!b) {
      return finalsMatches.find(
        m => (m.team1_id === a && !m.team2_id) || (m.team2_id === a && !m.team1_id)
      );
    }
    return finalsMatches.find(
      m =>
        (m.team1_id === a && m.team2_id === b) ||
        (m.team1_id === b && m.team2_id === a)
    );
  };

  for (let i = 0; i < standingsBeforeFinals.length; i += 2) {
    const higher = standingsBeforeFinals[i];
    const lower = standingsBeforeFinals[i + 1] ?? null;
    const placeTop = i + 1;
    const placeBottom = i + 2;

    if (!lower) {
      result.push({ teamId: higher.teamId, position: placeTop });
      used.add(higher.teamId);
      continue;
    }

    const m = findMatch(higher.teamId, lower.teamId);
    if (!m || !matchHasResult(m)) {
      result.push({ teamId: higher.teamId, position: placeTop });
      result.push({ teamId: lower.teamId, position: placeBottom });
      used.add(higher.teamId);
      used.add(lower.teamId);
      continue;
    }

    const winner = matchWinnerId(m);
    if (winner === higher.teamId) {
      result.push({ teamId: higher.teamId, position: placeTop });
      result.push({ teamId: lower.teamId, position: placeBottom });
    } else if (winner === lower.teamId) {
      result.push({ teamId: lower.teamId, position: placeTop });
      result.push({ teamId: higher.teamId, position: placeBottom });
    } else {
      // Draw: keep standings order
      result.push({ teamId: higher.teamId, position: placeTop });
      result.push({ teamId: lower.teamId, position: placeBottom });
    }
    used.add(higher.teamId);
    used.add(lower.teamId);
  }

  // Any leftover (should not happen)
  let nextPos = result.length + 1;
  for (const s of standingsBeforeFinals) {
    if (used.has(s.teamId)) continue;
    result.push({ teamId: s.teamId, position: nextPos++ });
  }

  return result.sort((a, b) => a.position - b.position);
}

export function areSwissFinalsComplete(
  matches: SwissMatchLike[],
  maxRounds: number,
): boolean {
  const finals = getSwissFinalsMatches(matches, maxRounds);
  if (finals.length === 0) return false;
  return finals.every(m => {
    if (m.team1_id && !m.team2_id) return matchHasResult(m);
    if (m.team1_id && m.team2_id) return matchHasResult(m);
    return true;
  });
}
