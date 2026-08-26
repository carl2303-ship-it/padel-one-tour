/**
 * Smoke test against real swissTeamsScheduler.ts
 * Run: npx tsx scripts/smoke-swiss-teams.ts
 */
import {
  areSwissFinalsComplete,
  buildOpponentMap,
  buildSwissRoundMatches,
  computeSwissPlacementRanking,
  computeSwissStandings,
  filterSwissMatchesForStandings,
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
const MAX_ROUNDS = 5;

function simulate(lastRoundMode: 'finals' | 'swiss') {
  const allMatches: SwissMatchLike[] = [];
  let rematchCount = 0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    let pairings;
    if (round === 1) {
      pairings = pairRound1(orderTeamsForRound1(teams, 'smoke-test'));
    } else if (isSwissFinalsRound(round, MAX_ROUNDS) && lastRoundMode === 'finals') {
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
      console.error(`FAIL ${lastRoundMode} R${round}: expected 5 playable, got ${playable.length}`);
      process.exit(1);
    }

    const isFinals = isSwissFinalsRound(round, MAX_ROUNDS) && lastRoundMode === 'finals';
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
          console.error(`REMATCH ${lastRoundMode} R${round}: ${m.team1_id} vs ${m.team2_id}`);
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
  }

  if (rematchCount > 0) {
    console.error(`FAIL ${lastRoundMode}: ${rematchCount} rematch(es) in Swiss rounds`);
    process.exit(1);
  }

  const forStandings = filterSwissMatchesForStandings(allMatches, MAX_ROUNDS, lastRoundMode);
  const standings = computeSwissStandings(teams, forStandings);

  if (lastRoundMode === 'finals') {
    if (!areSwissFinalsComplete(allMatches, MAX_ROUNDS)) {
      console.error('FAIL finals: finals not complete');
      process.exit(1);
    }
    if (standings.some((s) => s.played !== 4)) {
      console.error('FAIL finals: standings should exclude last round (J=4)');
      process.exit(1);
    }
    const ranking = computeSwissPlacementRanking(
      standings,
      allMatches.filter((m) => m.round === 'swiss_r5')
    );
    if (ranking.length !== 10 || ranking[0].position !== 1) {
      console.error('FAIL finals ranking', ranking);
      process.exit(1);
    }
    console.log('PASS mode=finals: J excludes R5, placement ranking OK');
  } else {
    if (standings.some((s) => s.played !== 5)) {
      console.error('FAIL swiss: standings should include last round (J=5)');
      process.exit(1);
    }
    console.log('PASS mode=swiss: last round counts in standings, no rematches');
  }
}

simulate('finals');
simulate('swiss');
console.log('\nAll Swiss last-round mode smoke tests passed');
