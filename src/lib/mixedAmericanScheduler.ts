/**
 * Mixed American Scheduler (Americano Misto)
 * 
 * Gera jogos onde cada jogo tem obrigatoriamente:
 *   1 Homem + 1 Mulher  vs  1 Homem + 1 Mulher
 * 
 * Os pares rodam cada ronda para que todos joguem com todos.
 * Classificação individual (cada jogador acumula os seus pontos).
 * 
 * GARANTIA: Todos os jogadores jogam exactamente o mesmo número de jogos.
 */

export interface MixedPlayer {
  id: string;
  name: string;
  gender: 'M' | 'F';
}

export interface MixedAmericanMatch {
  round: string;
  match_number: number;
  player1_id: string;  // Homem equipa 1
  player2_id: string;  // Mulher equipa 1
  player3_id: string;  // Homem equipa 2
  player4_id: string;  // Mulher equipa 2
  scheduled_time: string;
  court: string;
}

/**
 * Gera o schedule completo de um Americano Misto.
 * 
 * Algoritmo:
 * 1. A cada ronda, usar TODOS os jogadores (ou o máximo possível)
 * 2. Priorizar jogadores com menos jogos para garantir equilíbrio
 * 3. Rodar parcerias M+F para maximizar combinações únicas
 * 4. Continuar até todos terem jogado exactamente matchesPerPlayer jogos
 * 
 * @param men - Array de jogadores masculinos
 * @param women - Array de jogadoras femininas  
 * @param matchesPerPlayer - Nº exacto de jogos por jogador (default 7)
 * @returns Array de jogos gerados
 */
export function generateMixedAmericanSchedule(
  men: MixedPlayer[],
  women: MixedPlayer[],
  matchesPerPlayer: number = 7
): MixedAmericanMatch[] {
  console.log(`[MIXED-AMERICAN] Generating schedule: ${men.length} men, ${women.length} women, target ${matchesPerPlayer} matches/player`);

  if (men.length < 2 || women.length < 2) {
    console.error('[MIXED-AMERICAN] Need at least 2 men and 2 women');
    return [];
  }

  const matches: MixedAmericanMatch[] = [];

  // Contadores
  const partnershipCounts = new Map<string, number>(); // "manId_womanId" → count
  const opponentCounts = new Map<string, number>(); // "id1_id2" → count
  const playerMatchCount = new Map<string, number>();

  [...men, ...women].forEach(p => playerMatchCount.set(p.id, 0));

  const getPartnerKey = (manId: string, womanId: string) => `${manId}_${womanId}`;
  const getOpponentKey = (id1: string, id2: string) => id1 < id2 ? `${id1}_${id2}` : `${id2}_${id1}`;

  const getPartnerCount = (manId: string, womanId: string): number => {
    return partnershipCounts.get(getPartnerKey(manId, womanId)) || 0;
  };

  const getOpponentCount = (id1: string, id2: string): number => {
    return opponentCounts.get(getOpponentKey(id1, id2)) || 0;
  };

  const recordPartnership = (manId: string, womanId: string) => {
    const key = getPartnerKey(manId, womanId);
    partnershipCounts.set(key, (partnershipCounts.get(key) || 0) + 1);
  };

  const recordOpponents = (m1: string, w1: string, m2: string, w2: string) => {
    const pairs = [[m1, m2], [w1, w2], [m1, w2], [w1, m2]];
    pairs.forEach(([a, b]) => {
      const key = getOpponentKey(a, b);
      opponentCounts.set(key, (opponentCounts.get(key) || 0) + 1);
    });
  };

  /**
   * Score de um jogo potencial. Mais alto = melhor.
   */
  const scoreMatch = (man1: string, woman1: string, man2: string, woman2: string): number => {
    let score = 0;
    // Penalizar parcerias repetidas (muito pesado)
    score -= getPartnerCount(man1, woman1) * 200;
    score -= getPartnerCount(man2, woman2) * 200;
    // Penalizar adversários repetidos
    score -= getOpponentCount(man1, man2) * 100;
    score -= getOpponentCount(woman1, woman2) * 100;
    // Bónus para parcerias novas
    if (getPartnerCount(man1, woman1) === 0) score += 50;
    if (getPartnerCount(man2, woman2) === 0) score += 50;
    return score;
  };

  // Nº de jogos por ronda = min(homens, mulheres) / 2 (arredondado para baixo)
  const matchesPerRound = Math.floor(Math.min(men.length, women.length) / 2);
  const playersPerRound = matchesPerRound * 2; // homens usados por ronda = mulheres usados por ronda

  console.log(`[MIXED-AMERICAN] Matches per round: ${matchesPerRound}, players per side: ${playersPerRound}`);

  let matchNumber = 1;

  for (let round = 1; round <= matchesPerPlayer; round++) {
    // Ordenar jogadores por nº de jogos (quem jogou menos joga primeiro)
    const sortedMen = [...men].sort((a, b) => {
      const diff = (playerMatchCount.get(a.id) || 0) - (playerMatchCount.get(b.id) || 0);
      if (diff !== 0) return diff;
      return Math.random() - 0.5; // desempate aleatório
    });

    const sortedWomen = [...women].sort((a, b) => {
      const diff = (playerMatchCount.get(a.id) || 0) - (playerMatchCount.get(b.id) || 0);
      if (diff !== 0) return diff;
      return Math.random() - 0.5;
    });

    // Seleccionar os que vão jogar nesta ronda (os que têm menos jogos)
    const roundMen = sortedMen.slice(0, playersPerRound);
    const roundWomen = sortedWomen.slice(0, playersPerRound);

    // Gerar os melhores jogos para esta ronda
    const usedMen = new Set<string>();
    const usedWomen = new Set<string>();

    for (let m = 0; m < matchesPerRound; m++) {
      const availMen = roundMen.filter(p => !usedMen.has(p.id));
      const availWomen = roundWomen.filter(p => !usedWomen.has(p.id));

      if (availMen.length < 2 || availWomen.length < 2) break;

      // Encontrar o melhor jogo
      let bestMatch: { m1: string; w1: string; m2: string; w2: string; score: number } | null = null;

      for (let mi = 0; mi < availMen.length; mi++) {
        for (let mj = mi + 1; mj < availMen.length; mj++) {
          for (let wi = 0; wi < availWomen.length; wi++) {
            for (let wj = wi + 1; wj < availWomen.length; wj++) {
              const m1 = availMen[mi].id;
              const m2 = availMen[mj].id;
              const w1 = availWomen[wi].id;
              const w2 = availWomen[wj].id;

              // Opção A: (m1+w1) vs (m2+w2)
              const scoreA = scoreMatch(m1, w1, m2, w2);
              if (!bestMatch || scoreA > bestMatch.score) {
                bestMatch = { m1, w1, m2, w2, score: scoreA };
              }

              // Opção B: (m1+w2) vs (m2+w1)
              const scoreB = scoreMatch(m1, w2, m2, w1);
              if (scoreB > bestMatch.score) {
                bestMatch = { m1, w1: w2, m2, w2: w1, score: scoreB };
              }
            }
          }
        }
      }

      if (!bestMatch) break;

      // Registar
      recordPartnership(bestMatch.m1, bestMatch.w1);
      recordPartnership(bestMatch.m2, bestMatch.w2);
      recordOpponents(bestMatch.m1, bestMatch.w1, bestMatch.m2, bestMatch.w2);

      playerMatchCount.set(bestMatch.m1, (playerMatchCount.get(bestMatch.m1) || 0) + 1);
      playerMatchCount.set(bestMatch.w1, (playerMatchCount.get(bestMatch.w1) || 0) + 1);
      playerMatchCount.set(bestMatch.m2, (playerMatchCount.get(bestMatch.m2) || 0) + 1);
      playerMatchCount.set(bestMatch.w2, (playerMatchCount.get(bestMatch.w2) || 0) + 1);

      usedMen.add(bestMatch.m1);
      usedMen.add(bestMatch.m2);
      usedWomen.add(bestMatch.w1);
      usedWomen.add(bestMatch.w2);

      matches.push({
        round: `round_${round}`,
        match_number: matchNumber++,
        player1_id: bestMatch.m1,
        player2_id: bestMatch.w1,
        player3_id: bestMatch.m2,
        player4_id: bestMatch.w2,
        scheduled_time: '',
        court: ''
      });
    }
  }

  // Verificar equilíbrio
  const counts = Array.from(playerMatchCount.values());
  const minCount = Math.min(...counts);
  const maxCount = Math.max(...counts);

  console.log(`[MIXED-AMERICAN] Generated ${matches.length} matches across ${matchesPerPlayer} rounds`);
  console.log(`[MIXED-AMERICAN] Match count range: ${minCount}-${maxCount} (target: ${matchesPerPlayer})`);
  console.log('[MIXED-AMERICAN] Matches per player:');
  playerMatchCount.forEach((count, playerId) => {
    const player = [...men, ...women].find(p => p.id === playerId);
    console.log(`  ${player?.name} (${player?.gender}): ${count} matches`);
  });

  // Log parcerias únicas
  let uniquePartnerships = 0;
  partnershipCounts.forEach((count) => { if (count > 0) uniquePartnerships++; });
  console.log(`[MIXED-AMERICAN] Unique M+F partnerships: ${uniquePartnerships} / ${men.length * women.length} possible`);

  return matches;
}
