/**
 * Padel One Rating Engine v3
 * Sistema ELO adaptado para Padel em Duplas
 * 
 * Escala: 0.5 (iniciante) a 7.0 (profissional)
 * Fiabilidade: 0% (0 jogos) a 100% (75+ jogos rated)
 * 
 * v3 Fixes:
 * - K-Factor SIGNIFICATIVAMENTE aumentado para jogadores novos (0.5 vs 0.12)
 *   para que o nível mude visivelmente após cada jogo
 * - Fórmula ELO com divisor ajustado (1.2 vs 2.0) para maior sensibilidade
 * - Intensidade do resultado melhorada (3 sets, vitória dominante, etc.)
 * - Fiabilidade protegida: nunca cai mais de 2% por jogo (preserva avaliação do clube)
 * - Empate (1-1 sets) tratado com base em games totais
 * - Logs detalhados para diagnóstico
 */

import { supabase } from './supabase'

// ============================================
// Types
// ============================================

export interface PlayerRating {
  id: string           // player_accounts.id
  user_id: string      // auth user id
  name: string
  rating: number       // level (ex: 2.5, 4.1)
  matches: number      // total rated matches played
}

export interface MatchScore {
  sets1: number        // sets won by team 1
  sets2: number        // sets won by team 2
  gamesTotal1: number  // total games won by team 1 (across all sets)
  gamesTotal2: number  // total games won by team 2
}

export interface RatingResult {
  skipped?: boolean
  message?: string
  team1?: {
    p1: PlayerRating & { delta: number; won: boolean | null }
    p2: PlayerRating & { delta: number; won: boolean | null }
  }
  team2?: {
    p3: PlayerRating & { delta: number; won: boolean | null }
    p4: PlayerRating & { delta: number; won: boolean | null }
  }
}

// ============================================
// Core Algorithm
// ============================================

/**
 * Calcula os novos ratings de 4 jogadores após um jogo de duplas.
 * Baseado no sistema ELO com adaptações para padel.
 * 
 * Escala 0.5-7.0 (range = 6.5). ELO clássico usa range ~2000.
 * K-Factor proporcional: K_classic=40 → K_padel = 40*(6.5/2000) ≈ 0.13 para veteranos.
 * Para novos jogadores: K muito mais alto para convergência rápida.
 */
export function calculateNewRatings(
  team1: { p1: PlayerRating; p2: PlayerRating },
  team2: { p3: PlayerRating; p4: PlayerRating },
  score: MatchScore
): RatingResult {
  const { p1, p2 } = team1
  const { p3, p4 } = team2

  // 1. Médias de Nível das Equipas
  const avg1 = (p1.rating + p2.rating) / 2
  const avg2 = (p3.rating + p4.rating) / 2

  console.log(`[RatingEngine] Team averages: ${avg1.toFixed(2)} vs ${avg2.toFixed(2)}`)

  // 2. Verificação de Disparidade (Regra do 2.0)
  // Aumentado de 1.5 para 2.0 para permitir mais jogos entre níveis diferentes
  if (Math.abs(avg1 - avg2) > 2.0) {
    return {
      skipped: true,
      message: `Disparidade demasiado alta (${Math.abs(avg1 - avg2).toFixed(2)} > 2.0), nível inalterado`,
    }
  }

  // 3. Probabilidade de Vitória (Expected Outcome)
  // Divisor 1.2 (vs 2.0 anterior) — torna a fórmula mais sensível a diferenças de nível
  // Com divisor 1.2: diferença de 0.5 → expected ≈ 0.27 (antes era 0.36)
  const expected1 = 1 / (1 + Math.pow(10, (avg2 - avg1) / 1.2))

  // 4. Resultado Actual
  // Se empate em sets (1-1), usar diferença de games para desempatar
  let actual1: number
  if (score.sets1 > score.sets2) {
    actual1 = 1
  } else if (score.sets1 < score.sets2) {
    actual1 = 0
  } else {
    // Empate em sets — usar games totais para determinar vencedor parcial
    if (score.gamesTotal1 > score.gamesTotal2) {
      actual1 = 0.6  // Ligeira vantagem (não vitória completa)
    } else if (score.gamesTotal1 < score.gamesTotal2) {
      actual1 = 0.4
    } else {
      actual1 = 0.5  // Empate verdadeiro
    }
  }

  // 5. Intensidade do Resultado (Multiplicador)
  let intensity = 1.0
  const gameDiff = Math.abs(score.gamesTotal1 - score.gamesTotal2)

  if (score.sets1 + score.sets2 === 3) {
    // Jogo de 3 sets — verificar se foi renhido
    if (gameDiff <= 3) {
      intensity = 0.6   // Muito renhido (ex: 6-4, 4-6, 7-6)
    } else {
      intensity = 0.8   // 3 sets mas com margem
    }
  } else if (gameDiff > 8) {
    intensity = 1.3   // Vitória dominante (ex: 6-1, 6-2)
  } else if (gameDiff > 5) {
    intensity = 1.15  // Vitória clara (ex: 6-3, 6-3)
  }

  console.log(`[RatingEngine] Score: sets ${score.sets1}-${score.sets2}, games ${score.gamesTotal1}-${score.gamesTotal2} | expected: ${expected1.toFixed(4)}, actual: ${actual1}, intensity: ${intensity}`)

  // 6. K-Factor baseado em jogos RATED
  // Muito mais alto para jogadores novos — convergência rápida do nível
  const getKFactor = (matches: number): number => {
    if (matches < 5) return 0.50    // Muito novo — convergência rápida
    if (matches < 10) return 0.35   // Ainda novo
    if (matches < 20) return 0.25   // A construir histórico
    if (matches < 40) return 0.15   // Estabelecido
    if (matches < 60) return 0.10   // Experiente
    return 0.06                      // Veterano
  }

  // 7. Cálculo do Delta
  const calculateDelta = (player: PlayerRating, actual: number, expected: number, intens: number): number => {
    const K = getKFactor(player.matches)
    const change = K * (actual - expected) * intens
    console.log(`[RatingEngine]   ${player.name}: K=${K}, delta=${change.toFixed(4)} (actual=${actual}, expected=${expected.toFixed(4)}, intensity=${intens})`)
    return parseFloat(change.toFixed(4))
  }

  const delta1 = calculateDelta(p1, actual1, expected1, intensity)
  const delta2 = calculateDelta(p2, actual1, expected1, intensity)
  const delta3 = calculateDelta(p3, 1 - actual1, 1 - expected1, intensity)
  const delta4 = calculateDelta(p4, 1 - actual1, 1 - expected1, intensity)

  // 8. Clamp para manter dentro da escala 0.5 - 7.0
  const clamp = (val: number) => Math.max(0.5, Math.min(7.0, parseFloat(val.toFixed(2))))

  // 9. Determinar quem ganhou/perdeu
  const team1Won = actual1 >= 0.6 ? true : actual1 <= 0.4 ? false : null

  console.log(`[RatingEngine] Results: P1 ${p1.rating.toFixed(2)}→${clamp(p1.rating + delta1).toFixed(2)}, P2 ${p2.rating.toFixed(2)}→${clamp(p2.rating + delta2).toFixed(2)}, P3 ${p3.rating.toFixed(2)}→${clamp(p3.rating + delta3).toFixed(2)}, P4 ${p4.rating.toFixed(2)}→${clamp(p4.rating + delta4).toFixed(2)}`)

  return {
    team1: {
      p1: { ...p1, rating: clamp(p1.rating + delta1), delta: delta1, matches: p1.matches + 1, won: team1Won },
      p2: { ...p2, rating: clamp(p2.rating + delta2), delta: delta2, matches: p2.matches + 1, won: team1Won },
    },
    team2: {
      p3: { ...p3, rating: clamp(p3.rating + delta3), delta: delta3, matches: p3.matches + 1, won: team1Won === null ? null : !team1Won },
      p4: { ...p4, rating: clamp(p4.rating + delta4), delta: delta4, matches: p4.matches + 1, won: team1Won === null ? null : !team1Won },
    },
  }
}

// ============================================
// Fiabilidade (Reliability)
// ============================================

/**
 * Calcula a fiabilidade baseada em jogos rated.
 * 0 jogos = 0%, 75+ jogos = 100%
 */
export function calculateReliability(totalMatches: number): number {
  if (totalMatches <= 0) return 0
  if (totalMatches >= 75) return 100
  const reliability = Math.min(100, Math.round(100 * (Math.log(totalMatches + 1) / Math.log(76))))
  return reliability
}

/**
 * Calcula a fiabilidade "protegida" — nunca cai mais de 2% por jogo.
 * Isto preserva a avaliação feita pelo clube/management.
 * 
 * @param newReliability - fiabilidade calculada a partir dos rated_matches
 * @param currentReliability - fiabilidade actual no player_accounts
 * @returns fiabilidade a guardar (máximo entre fórmula e decaimento lento)
 */
export function calculateProtectedReliability(newReliability: number, currentReliability: number): number {
  return Math.max(newReliability, currentReliability - 2)
}

export function calculateMatchesFromReliability(reliability: number): number {
  if (reliability <= 0) return 0
  if (reliability >= 100) return 75
  const matches = Math.round(Math.exp((reliability / 100) * Math.log(76)) - 1)
  return Math.max(0, Math.min(75, matches))
}

// ============================================
// Player Cache (para acumular durante batch)
// ============================================

export interface CachedPlayer {
  id: string
  user_id: string
  name: string
  rating: number
  matchCount: number
  currentReliability: number
}

export type PlayerCache = Map<string, CachedPlayer>

// ============================================
// Supabase Integration
// ============================================

export async function processMatchRating(matchId: string, cache?: PlayerCache): Promise<RatingResult | null> {
  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select(`
      id, team1_id, team2_id, status,
      team1_score_set1, team2_score_set1,
      team1_score_set2, team2_score_set2,
      team1_score_set3, team2_score_set3,
      player1_individual_id, player2_individual_id,
      player3_individual_id, player4_individual_id
    `)
    .eq('id', matchId)
    .single()

  if (matchErr || !match) {
    console.error('[RatingEngine] Match not found:', matchId, matchErr)
    return null
  }

  if (match.status !== 'completed') {
    console.log('[RatingEngine] Match not completed, skipping:', matchId)
    return null
  }

  const s1 = [match.team1_score_set1 ?? 0, match.team2_score_set1 ?? 0] as [number, number]
  const s2 = [match.team1_score_set2 ?? 0, match.team2_score_set2 ?? 0] as [number, number]
  const s3 = [match.team1_score_set3 ?? 0, match.team2_score_set3 ?? 0] as [number, number]

  const sets1 = (s1[0] > s1[1] ? 1 : 0) + (s2[0] > s2[1] ? 1 : 0) + (s3[0] > s3[1] ? 1 : 0)
  const sets2 = (s1[1] > s1[0] ? 1 : 0) + (s2[1] > s2[0] ? 1 : 0) + (s3[1] > s3[0] ? 1 : 0)
  const gamesTotal1 = s1[0] + s2[0] + s3[0]
  const gamesTotal2 = s1[1] + s2[1] + s3[1]

  if (sets1 === 0 && sets2 === 0) {
    console.log('[RatingEngine] No sets played, skipping:', matchId)
    return null
  }

  const score: MatchScore = { sets1, sets2, gamesTotal1, gamesTotal2 }

  let playerIds: string[] = []
  const isIndividual = match.player1_individual_id || match.player2_individual_id
  if (isIndividual) {
    playerIds = [
      match.player1_individual_id,
      match.player2_individual_id,
      match.player3_individual_id,
      match.player4_individual_id,
    ].filter(Boolean)
  } else if (match.team1_id && match.team2_id) {
    const { data: teams } = await supabase
      .from('teams')
      .select('id, player1_id, player2_id')
      .in('id', [match.team1_id, match.team2_id])

    if (!teams || teams.length < 2) {
      console.error('[RatingEngine] Could not find teams for match:', matchId)
      return null
    }

    const t1 = teams.find((t: any) => t.id === match.team1_id)
    const t2 = teams.find((t: any) => t.id === match.team2_id)
    playerIds = [t1?.player1_id, t1?.player2_id, t2?.player1_id, t2?.player2_id].filter(Boolean)
  }

  if (playerIds.length < 4) {
    console.log('[RatingEngine] Less than 4 players found, skipping:', matchId, 'found:', playerIds.length)
    return null
  }

  const { data: playersData } = await supabase
    .from('players')
    .select('id, name, phone_number, user_id')
    .in('id', playerIds)

  if (!playersData || playersData.length < 4) {
    console.log('[RatingEngine] Could not fetch all player entries:', matchId)
    return null
  }

  const accountsMap = new Map<string, any>()
  const selectFields = 'id, user_id, name, level, rated_matches, wins, losses, level_reliability_percent'

  for (const p of playersData) {
    let account: any = null

    if (p.user_id) {
      const { data } = await supabase
        .from('player_accounts')
        .select(selectFields)
        .eq('user_id', p.user_id)
        .maybeSingle()
      if (data) account = data
    }

    if (!account && p.phone_number) {
      const { data } = await supabase
        .from('player_accounts')
        .select(selectFields)
        .eq('phone_number', p.phone_number)
        .maybeSingle()
      if (data) account = data
    }

    if (!account && p.name) {
      const { data } = await supabase
        .from('player_accounts')
        .select(selectFields)
        .ilike('name', p.name)
        .maybeSingle()
      if (data) account = data
    }

    if (account) {
      accountsMap.set(p.id, account)
    }
  }

  if (accountsMap.size < 4) {
    console.log('[RatingEngine] Could not map all players to accounts:', matchId, 'mapped:', accountsMap.size)
    return null
  }

  const buildRating = (playerId: string): PlayerRating | null => {
    const acct = accountsMap.get(playerId)
    if (!acct) return null

    const cached = cache?.get(acct.id)
    if (cached) {
      return {
        id: cached.id,
        user_id: cached.user_id,
        name: cached.name,
        rating: cached.rating,
        matches: cached.matchCount,
      }
    }

    return {
      id: acct.id,
      user_id: acct.user_id || '',
      name: acct.name || '',
      rating: acct.level ?? 3.0,
      matches: acct.rated_matches ?? ((acct.wins ?? 0) + (acct.losses ?? 0)),
    }
  }

  const p1 = buildRating(playerIds[0])
  const p2 = buildRating(playerIds[1])
  const p3 = buildRating(playerIds[2])
  const p4 = buildRating(playerIds[3])

  if (!p1 || !p2 || !p3 || !p4) {
    console.log('[RatingEngine] Could not build all player ratings')
    return null
  }

  const result = calculateNewRatings({ p1, p2 }, { p3, p4 }, score)

  if (result.skipped) {
    console.log('[RatingEngine] Match skipped:', result.message)
    return result
  }

  if (result.team1 && result.team2) {
    const allUpdatedPlayers = [result.team1.p1, result.team1.p2, result.team2.p3, result.team2.p4]

    for (const rp of allUpdatedPlayers) {
      const formulaReliability = calculateReliability(rp.matches)
      // Get current reliability from account or cache
      const acctData = Array.from(accountsMap.values()).find((a: any) => a.id === rp.id)
      const currentReliability = cache?.get(rp.id)?.currentReliability ?? acctData?.level_reliability_percent ?? 0
      const protectedReliability = calculateProtectedReliability(formulaReliability, currentReliability)

      if (cache) {
        cache.set(rp.id, {
          id: rp.id,
          user_id: rp.user_id,
          name: rp.name,
          rating: rp.rating,
          matchCount: rp.matches,
          currentReliability: protectedReliability,
        })
      }

      const { error } = await supabase.rpc('update_player_rating', {
        p_player_account_id: rp.id,
        p_new_level: rp.rating,
        p_new_reliability: protectedReliability,
        p_match_won: rp.won,
      })

      if (error) {
        console.error('[RatingEngine] Error updating player:', rp.id, error)
      }
    }

    const { error: markError } = await supabase.rpc('mark_match_rating_processed', {
      p_match_id: matchId,
    })
    if (markError) {
      console.error('[RatingEngine] Error marking match as processed:', matchId, markError)
    }

    console.log('[RatingEngine] Updated ratings for match:', matchId)
    const logPlayer = (before: PlayerRating, after: PlayerRating & { delta: number }) => {
      const K = getKFactorForLog(after.matches)
      console.log(`  ${after.name}: ${before.rating.toFixed(2)} → ${after.rating.toFixed(2)} (Δ${after.delta >= 0 ? '+' : ''}${after.delta.toFixed(4)}) | K=${K} | jogos: ${after.matches} | fiab: ${calculateReliability(after.matches)}%`)
    }
    logPlayer(p1, result.team1.p1)
    logPlayer(p2, result.team1.p2)
    logPlayer(p3, result.team2.p3)
    logPlayer(p4, result.team2.p4)
  }

  return result
}

// Helper for logging
function getKFactorForLog(matches: number): number {
  if (matches < 5) return 0.50
  if (matches < 10) return 0.35
  if (matches < 20) return 0.25
  if (matches < 40) return 0.15
  if (matches < 60) return 0.10
  return 0.06
}

export async function processAllUnratedMatches(
  since?: string,
  onProgress?: (current: number, total: number, info: string) => void,
  tournamentId?: string
): Promise<{ processed: number; skipped: number; errors: number; total: number }> {
  let query = supabase
    .from('matches')
    .select('id, scheduled_time, tournament_id')
    .eq('status', 'completed')
    .or('rating_processed.is.null,rating_processed.eq.false')
    .order('scheduled_time', { ascending: true })

  if (tournamentId) {
    query = query.eq('tournament_id', tournamentId)
  }

  if (since) {
    query = query.gte('scheduled_time', since)
  }

  const { data: matches, error } = await query

  if (error) {
    console.error('[RatingEngine] Error fetching matches:', error)
    return { processed: 0, skipped: 0, errors: 1, total: 0 }
  }

  if (!matches || matches.length === 0) {
    console.log('[RatingEngine] No matches to process')
    return { processed: 0, skipped: 0, errors: 0, total: 0 }
  }

  console.log(`[RatingEngine] Found ${matches.length} completed matches to process`)
  onProgress?.(0, matches.length, 'A iniciar processamento...')

  const playerCache: PlayerCache = new Map()

  let processed = 0
  let skipped = 0
  let errors = 0

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    try {
      const result = await processMatchRating(match.id, playerCache)
      if (!result) {
        errors++
      } else if (result.skipped) {
        skipped++
      } else {
        processed++
      }
    } catch (err) {
      console.error('[RatingEngine] Error processing match:', match.id, err)
      errors++
    }

    if ((i + 1) % 5 === 0 || i === matches.length - 1) {
      onProgress?.(i + 1, matches.length, `Processados: ${processed} | Saltados: ${skipped} | Erros: ${errors}`)
    }
  }

  const uniquePlayers = playerCache.size
  const maxMatches = Math.max(0, ...Array.from(playerCache.values()).map(p => p.matchCount))
  const summary = `CONCLUÍDO: ${processed} processados, ${skipped} saltados, ${errors} erros de ${matches.length} total | ${uniquePlayers} jogadores atualizados (max ${maxMatches} jogos rated)`
  console.log(`[RatingEngine] ${summary}`)
  onProgress?.(matches.length, matches.length, summary)

  return { processed, skipped, errors, total: matches.length }
}

// ============================================
// Tournament Reward Points
// ============================================

export async function awardTournamentRewardPoints(
  tournamentId: string
): Promise<{ awarded: number; skipped: number; errors: number; details: string[] }> {
  const details: string[] = []
  let awarded = 0
  let skipped = 0
  let errors = 0

  const { data: tournament, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, club_id')
    .eq('id', tournamentId)
    .single()

  if (tErr || !tournament) {
    console.error('[Rewards] Tournament not found:', tournamentId, tErr)
    return { awarded: 0, skipped: 0, errors: 1, details: ['Torneio não encontrado'] }
  }

  if (!tournament.club_id) {
    console.log('[Rewards] Tournament has no club_id, cannot award rewards')
    return { awarded: 0, skipped: 0, errors: 0, details: ['Torneio sem clube associado - sem rewards'] }
  }

  const { data: rule } = await supabase
    .from('reward_rules')
    .select('id, points')
    .eq('club_id', tournament.club_id)
    .eq('action_type', 'tournament_played')
    .eq('is_active', true)
    .maybeSingle()

  if (!rule) {
    console.log('[Rewards] No active tournament_played rule for club:', tournament.club_id)
    return { awarded: 0, skipped: 0, errors: 0, details: ['Sem regra de reward "tournament_played" ativa neste clube'] }
  }

  const { data: players } = await supabase
    .from('players')
    .select('id, name, user_id, phone_number')
    .eq('tournament_id', tournamentId)

  if (!players || players.length === 0) {
    return { awarded: 0, skipped: 0, errors: 0, details: ['Sem jogadores no torneio'] }
  }

  console.log(`[Rewards] Found ${players.length} players in tournament ${tournament.name}`)

  for (const player of players) {
    let playerAccountId: string | null = null

    if (player.user_id) {
      const { data } = await supabase
        .from('player_accounts')
        .select('id')
        .eq('user_id', player.user_id)
        .maybeSingle()
      if (data) playerAccountId = data.id
    }

    if (!playerAccountId && player.phone_number) {
      const { data } = await supabase
        .from('player_accounts')
        .select('id')
        .eq('phone_number', player.phone_number)
        .maybeSingle()
      if (data) playerAccountId = data.id
    }

    if (!playerAccountId && player.name) {
      const { data } = await supabase
        .from('player_accounts')
        .select('id')
        .ilike('name', player.name)
        .maybeSingle()
      if (data) playerAccountId = data.id
    }

    if (!playerAccountId) {
      skipped++
      details.push(`⚠️ ${player.name}: sem conta encontrada`)
      continue
    }

    const { data: result, error: awardErr } = await supabase.rpc('award_reward_points', {
      p_player_account_id: playerAccountId,
      p_club_id: tournament.club_id,
      p_action_type: 'tournament_played',
      p_reference_id: tournamentId,
      p_custom_description: `Participou no torneio "${tournament.name}"`,
    })

    if (awardErr) {
      console.error('[Rewards] Error awarding points to:', player.name, awardErr)
      errors++
      details.push(`❌ ${player.name}: erro ao atribuir pontos`)
    } else if (result && !result.success) {
      skipped++
      details.push(`⏭️ ${player.name}: ${result.error || 'já tinha pontos'}`)
    } else {
      awarded++
      details.push(`✅ ${player.name}: +${result?.points_earned || rule.points} pts (total: ${result?.new_total || '?'})`)
    }
  }

  console.log(`[Rewards] Tournament rewards: ${awarded} awarded, ${skipped} skipped, ${errors} errors`)
  return { awarded, skipped, errors, details }
}
