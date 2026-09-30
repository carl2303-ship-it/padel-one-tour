/** Standings for Club League: 3 pts win / 1 pt loss; tiebreakers H2H → W → set diff → sets won. */

export type ClubLeagueStandingInput = {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  setsWon: number;
  setsLost: number;
  points: number;
};

export type ClubLeagueResultInput = {
  homeTeamId: string;
  awayTeamId: string;
  winnerTeamId: string;
  homeSetsWon: number;
  awaySetsWon: number;
};

export type RankedStanding = ClubLeagueStandingInput & {
  setsDiff: number;
  position: number;
};

function h2hPoints(
  a: string,
  b: string,
  results: ClubLeagueResultInput[]
): { aPts: number; bPts: number; aSets: number; bSets: number } {
  let aPts = 0;
  let bPts = 0;
  let aSets = 0;
  let bSets = 0;
  for (const r of results) {
    const involves =
      (r.homeTeamId === a && r.awayTeamId === b) ||
      (r.homeTeamId === b && r.awayTeamId === a);
    if (!involves) continue;
    if (r.winnerTeamId === a) aPts += 3;
    else if (r.winnerTeamId === b) bPts += 3;
    if (r.winnerTeamId === a) bPts += 1;
    else if (r.winnerTeamId === b) aPts += 1;

    if (r.homeTeamId === a) {
      aSets += r.homeSetsWon;
      bSets += r.awaySetsWon;
    } else {
      aSets += r.awaySetsWon;
      bSets += r.homeSetsWon;
    }
  }
  return { aPts, bPts, aSets, bSets };
}

export function compareClubLeagueStandings(
  a: ClubLeagueStandingInput,
  b: ClubLeagueStandingInput,
  results: ClubLeagueResultInput[]
): number {
  if (b.points !== a.points) return b.points - a.points;

  const h2h = h2hPoints(a.teamId, b.teamId, results);
  if (h2h.aPts !== h2h.bPts) return h2h.bPts - h2h.aPts;

  if (b.won !== a.won) return b.won - a.won;

  const aDiff = a.setsWon - a.setsLost;
  const bDiff = b.setsWon - b.setsLost;
  if (bDiff !== aDiff) return bDiff - aDiff;

  if (b.setsWon !== a.setsWon) return b.setsWon - a.setsWon;

  return 0;
}

export function rankClubLeagueStandings(
  standings: ClubLeagueStandingInput[],
  results: ClubLeagueResultInput[]
): RankedStanding[] {
  const sorted = [...standings].sort((a, b) => compareClubLeagueStandings(a, b, results));
  return sorted.map((s, i) => ({
    ...s,
    setsDiff: s.setsWon - s.setsLost,
    position: i + 1,
  }));
}

export function buildStandingsFromResults(
  teamIds: string[],
  results: ClubLeagueResultInput[]
): RankedStanding[] {
  const map = new Map<string, ClubLeagueStandingInput>();
  for (const id of teamIds) {
    map.set(id, {
      teamId: id,
      played: 0,
      won: 0,
      lost: 0,
      setsWon: 0,
      setsLost: 0,
      points: 0,
    });
  }

  for (const r of results) {
    const home = map.get(r.homeTeamId);
    const away = map.get(r.awayTeamId);
    if (!home || !away) continue;

    home.played += 1;
    away.played += 1;
    home.setsWon += r.homeSetsWon;
    home.setsLost += r.awaySetsWon;
    away.setsWon += r.awaySetsWon;
    away.setsLost += r.homeSetsWon;

    if (r.winnerTeamId === r.homeTeamId) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
      away.points += 1;
    } else if (r.winnerTeamId === r.awayTeamId) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
      home.points += 1;
    }
  }

  return rankClubLeagueStandings([...map.values()], results);
}

/** Sets won in a duo match: set1, set2, optional STB. Winner needs 2. */
export function duoMatchSets(
  homeSet1: number,
  awaySet1: number,
  homeSet2: number,
  awaySet2: number,
  homeStb: number | null,
  awayStb: number | null
): { homeSets: number; awaySets: number; winner: 'home' | 'away' | null } {
  let homeSets = 0;
  let awaySets = 0;
  if (homeSet1 > awaySet1) homeSets++;
  else if (awaySet1 > homeSet1) awaySets++;
  if (homeSet2 > awaySet2) homeSets++;
  else if (awaySet2 > homeSet2) awaySets++;

  if (homeSets === 1 && awaySets === 1) {
    if (homeStb == null || awayStb == null) {
      return { homeSets, awaySets, winner: null };
    }
    if (homeStb > awayStb) homeSets++;
    else if (awayStb > homeStb) awaySets++;
  }

  if (homeSets >= 2) return { homeSets, awaySets, winner: 'home' };
  if (awaySets >= 2) return { homeSets, awaySets, winner: 'away' };
  return { homeSets, awaySets, winner: null };
}
