/**
 * Smoke test against real swissTeamsScheduler.ts
 * Run: npx tsx scripts/smoke-swiss-teams.ts
 */
import {
  buildOpponentMap,
  buildSwissRoundMatches,
  computeSwissStandings,
  isSwissFinalsRound,
  orderTeamsForRound1,
  pairRound1,
  pairSwissFinalsRound,
  pairSwissRound,
  type SwissMatchLike,
  type SwissTeam,
} from '../src/lib/swissTeamsScheduler';

const teams: SwissTeam[] = Array.from({ length: 10 }, (_, i) => ({
  id: `t${i + 1}`,
  name: `Team ${i + 1}`,
  seed: i + 1,
}));

const courts = ['C1', 'C2', 'C3', 'C4', 'C5'];
const allMatches: SwissMatchLike[] = [];
let rematchCount = 0;
const MAX_ROUNDS = 5;

for (let round = 1; round <= MAX_ROUNDS; round++) {
  let pairings;
  if (round === 1) {
    pairings = pairRound1(orderTeamsForRound1(teams, 'smoke-test'));
  } else if (isSwissFinalsRound(round, MAX_ROUNDS)) {
    const standings = computeSwissStandings(teams, allMatches);
    pairings = pairSwissFinalsRound(standings);
  } else {
    const standings = computeSwissStandings(teams, allMatches);
    const opponents = buildOpponentMap(allMatches);
    pairings = pairSwissRound(standings, opponents);
  }

  const built = buildSwissRoundMatches({
    pairings,
    roundNumber: round,
    numberOfCourts: 5,
    courtNames: courts,
    scheduledTime: `2026-01-01T${8 + round}:00:00`,
  });

  const playable = built.filter((m) => m.team2_id);
  if (playable.length !== 5) {
    console.error(`FAIL R${round}: expected 5 playable matches, got ${playable.length}`);
    process.exit(1);
  }

  const isFinals = isSwissFinalsRound(round, MAX_ROUNDS);
  if (isFinals) {
    const standings = computeSwissStandings(teams, allMatches);
    for (let i = 0; i < playable.length; i++) {
      const m = playable[i];
      const expected1 = standings[i * 2]?.teamId;
      const expected2 = standings[i * 2 + 1]?.teamId;
      if (m.team1_id !== expected1 || m.team2_id !== expected2) {
        console.error(
          `FAIL finals pairing #${i}: got ${m.team1_id}-${m.team2_id}, expected ${expected1}-${expected2}`
        );
        process.exit(1);
      }
    }
  } else {
    const opponents = buildOpponentMap(allMatches);
    for (const m of playable) {
      if (m.team1_id && m.team2_id && opponents.get(m.team1_id)?.has(m.team2_id)) {
        rematchCount += 1;
        console.error(`REMATCH R${round}: ${m.team1_id} vs ${m.team2_id}`);
      }
    }
  }

  for (const m of built) {
    if (!m.team2_id) {
      allMatches.push({ ...m, status: 'completed', winner_id: m.team1_id });
      continue;
    }
    const seed1 = parseInt(String(m.team1_id).slice(1), 10);
    const seed2 = parseInt(String(m.team2_id).slice(1), 10);
    const t1Wins = seed1 < seed2;
    allMatches.push({
      ...m,
      status: 'completed',
      team1_score_set1: t1Wins ? 6 : 3,
      team2_score_set1: t1Wins ? 3 : 6,
      winner_id: t1Wins ? m.team1_id : m.team2_id,
    });
  }

  console.log(
    `${isFinals ? 'FINALS' : `R${round}`}:`,
    playable.map((m) => `${m.team1_id}-${m.team2_id}@${m.court}`).join(' | ')
  );
}

const finalStandings = computeSwissStandings(teams, allMatches);
console.log('\nFinal standings:');
finalStandings.forEach((s, i) => {
  console.log(`${i + 1}. ${s.name}: ${s.wins}V GD=${s.gameDiff}`);
});

if (rematchCount > 0) {
  console.error(`\nFAIL: ${rematchCount} rematch(es) in Swiss rounds`);
  process.exit(1);
}
console.log('\nPASS: 10 teams × 4 Swiss + finals (1v2…), zero rematches in Swiss rounds');
