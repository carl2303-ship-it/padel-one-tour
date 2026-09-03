/**
 * Smoke: groups_knockout seeding + draw handling (APC Sep2 regression).
 * Run: npx tsx scripts/smoke-groups-knockout.ts
 */

type T = { id: string; name: string; wins: number; gd: number };

/** Copy of buildTwoGroupKnockoutPairs from src/lib/groups.ts */
function buildTwoGroupKnockoutPairs<T extends { id: string }>(
  rankA: T[],
  rankB: T[],
  numMatches: number
): Array<[T, T]> {
  const pairs: Array<[T, T]> = [];
  let seedOrder = [0];
  while (seedOrder.length < numMatches) {
    const offset = seedOrder.length;
    seedOrder = seedOrder.flatMap(seed => [seed, seed + offset]);
  }
  for (const rankIndex of seedOrder.slice(0, numMatches)) {
    const a = rankA[rankIndex];
    const b = rankB[numMatches - 1 - rankIndex];
    if (a && b) pairs.push([a, b]);
  }
  return pairs;
}

function rank(teams: T[]): T[] {
  return [...teams].sort((a, b) => {
    if (a.wins !== b.wins) return b.wins - a.wins;
    return b.gd - a.gd;
  });
}

/** Old draw bug: draw counted as win for team2. */
function rankWithDrawBug(teams: T[], drawAsTeam2Win: { team1: string; team2: string }[]): T[] {
  const copy = teams.map(t => ({ ...t }));
  for (const d of drawAsTeam2Win) {
    const t2 = copy.find(t => t.id === d.team2);
    if (t2) t2.wins += 1;
  }
  return rank(copy);
}

const groupA: T[] = [
  { id: 'a1', name: 'Nuno - João', wins: 2, gd: 8 },
  { id: 'a2', name: 'David - Martin', wins: 2, gd: 3 },
  { id: 'a3', name: 'Miguel - João', wins: 1, gd: -5 },
  { id: 'a4', name: 'Luís - Paulo', wins: 0, gd: -6 },
];

const groupB: T[] = [
  { id: 'b1', name: 'Luis e Mauro', wins: 3, gd: 10 },
  { id: 'b2', name: 'Carlos - João', wins: 1, gd: 1 },
  { id: 'b3', name: 'Be Brave', wins: 1, gd: -4 },
  { id: 'b4', name: 'Jorge - Gil', wins: 0, gd: -7 },
];

const correctA = rank(groupA);
const correctB = rank(groupB);
const pairs = buildTwoGroupKnockoutPairs(correctA, correctB, 4);

const expected = [
  ['a1', 'b4'],
  ['a3', 'b2'],
  ['a2', 'b3'],
  ['a4', 'b1'],
];

const got = pairs.map(([a, b]) => [a.id, b.id]);
if (JSON.stringify(got) !== JSON.stringify(expected)) {
  console.error('FAIL expected', expected, 'got', got);
  process.exit(1);
}

console.log('Correct QF pairs:');
pairs.forEach(([a, b], i) => console.log(`  J${i + 1}: ${a.name} vs ${b.name}`));

const buggyA = rankWithDrawBug(groupA, [{ team1: 'a1', team2: 'a2' }]);
const buggyPairs = buildTwoGroupKnockoutPairs(buggyA, correctB, 4);
const buggyGot = buggyPairs.map(([a, b]) => [a.id, b.id]);
const sep2ActualWrong = [
  ['a2', 'b4'],
  ['a3', 'b2'],
  ['a1', 'b3'],
  ['a4', 'b1'],
];

console.log('\nWith draw bug (yesterday):');
buggyPairs.forEach(([a, b], i) => console.log(`  J${i + 1}: ${a.name} vs ${b.name}`));

if (JSON.stringify(buggyGot) !== JSON.stringify(sep2ActualWrong)) {
  console.error('FAIL: draw-bug pairing mismatch', buggyGot);
  process.exit(1);
}

const half1 = new Set([pairs[0][0].id, pairs[0][1].id, pairs[1][0].id, pairs[1][1].id]);
if (half1.has('a1') === half1.has('a2')) {
  console.error('FAIL: A1 and A2 in same SF half');
  process.exit(1);
}
if (half1.has('b1') === half1.has('b2')) {
  console.error('FAIL: B1 and B2 in same SF half');
  process.exit(1);
}

console.log('\nPASS: groups_knockout seeding + draw regression');
