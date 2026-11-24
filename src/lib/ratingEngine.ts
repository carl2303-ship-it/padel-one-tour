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
import { reverseRatingForSource } from './levelHistory'

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
  /** Soft-failure that should surface to the organizer (not silent). */
  error?: boolean
  team1?: {
    p1: PlayerRating & { delta: number; won: boolean | null }
    p2: PlayerRating & { delta: number; won: boolean | null }
  }
  team2?: {
    p3: PlayerRating & { delta: number; won: boolean | null }
    p4: PlayerRating & { delta: number; won: boolean | null }
  }
}

/** Champion / finalist ELO podium bonuses (same as Player app). */
export const PODIUM_BONUS_CHAMPION = 0.10
export const PODIUM_BONUS_FINALIST = 0.05

export interface PodiumBonusResult {
  applied: boolean
  message?: string
  champions: Array<{ id: string; name: string; levelBefore: number; levelAfter: number; bonus: number }>
  finalists: Array<{ id: string; name: string; levelBefore: number; levelAfter: number; bonus: number }>
}

export interface TournamentRatingReport {
  processed: number
  skipped: number
  errors: number
  total: number
  remainingUnrated: number
  details: string[]
  podium: PodiumBonusResult
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
 * 
 * Curva de potência (expoente 0.65) — crescimento gradual:
 *   1 jogo=4%, 2=6%, 5=12%, 10=19%, 20=30%, 30=38%, 50=54%, 75=100%
 */
export function calculateReliability(totalMatches: number): number {
  if (totalMatches <= 0) return 0
  if (totalMatches >= 75) return 100
  const reliability = Math.min(100, Math.round(100 * Math.pow(totalMatches / 75, 0.65)))
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
  const matches = Math.round(75 * Math.pow(reliability / 100, 1 / 0.65))
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
      id, team1_id, team2_id, status, rating_processed,
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
    return null
  }

  // Evita duplicar deltas de rating se a função for chamada mais que uma vez
  // para o mesmo jogo (retry, race condition, re-scan em lote). Para
  // reprocessar de propósito, o chamador deve repor rating_processed=false
  // antes (como já faz TournamentDetail/EditTournamentModal ao "Reprocessar").
  if (match.rating_processed) {
    return { skipped: true, message: 'Already processed' }
  }

  const s1 = [match.team1_score_set1 ?? 0, match.team2_score_set1 ?? 0] as [number, number]
  const s2 = [match.team1_score_set2 ?? 0, match.team2_score_set2 ?? 0] as [number, number]
  const s3 = [match.team1_score_set3 ?? 0, match.team2_score_set3 ?? 0] as [number, number]

  const sets1 = (s1[0] > s1[1] ? 1 : 0) + (s2[0] > s2[1] ? 1 : 0) + (s3[0] > s3[1] ? 1 : 0)
  const sets2 = (s1[1] > s1[0] ? 1 : 0) + (s2[1] > s2[0] ? 1 : 0) + (s3[1] > s3[0] ? 1 : 0)
  const gamesTotal1 = s1[0] + s2[0] + s3[0]
  const gamesTotal2 = s1[1] + s2[1] + s3[1]

  if (sets1 === 0 && sets2 === 0) {
    return { error: true, skipped: true, message: 'Sem sets válidos (scores a 0)' }
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
      return { error: true, skipped: true, message: 'Equipas do jogo não encontradas' }
    }

    const t1 = teams.find((t: any) => t.id === match.team1_id)
    const t2 = teams.find((t: any) => t.id === match.team2_id)
    playerIds = [t1?.player1_id, t1?.player2_id, t2?.player1_id, t2?.player2_id].filter(Boolean)
  }

  if (playerIds.length < 4) {
    return { error: true, skipped: true, message: `Jogadores incompletos (${playerIds.length}/4)` }
  }

  const { data: playersData } = await supabase
    .from('players')
    .select('id, name, phone_number, user_id, player_account_id')
    .in('id', playerIds)

  if (!playersData || playersData.length < 4) {
    return { error: true, skipped: true, message: `Players em falta na BD (${playersData?.length || 0}/4)` }
  }

  const accountsMap = new Map<string, any>()
  const selectFields = 'id, user_id, name, level, rated_matches, wins, losses, level_reliability_percent'
  const normalizePhoneDigits = (phone: string) => {
    let cleaned = phone.replace(/[\s\-\(\)\.]/g, '')
    let hadPrefix = false
    if (cleaned.startsWith('+00')) { cleaned = cleaned.slice(3); hadPrefix = true }
    else if (cleaned.startsWith('+')) { cleaned = cleaned.slice(1); hadPrefix = true }
    else if (cleaned.startsWith('00')) { cleaned = cleaned.slice(2); hadPrefix = true }
    if (hadPrefix) {
      cleaned = cleaned.replace(/^351(?=\d{9})/, '')
    } else {
      cleaned = cleaned.replace(/^351(?=[29]\d{8}$)/, '')
    }
    return cleaned
  }

  for (const p of playersData) {
    let account: any = null

    if ((p as any).player_account_id) {
      const { data } = await supabase
        .from('player_accounts')
        .select(selectFields)
        .eq('id', (p as any).player_account_id)
        .maybeSingle()
      if (data) account = data
    }

    if (!account && p.user_id) {
      const { data } = await supabase
        .from('player_accounts')
        .select(selectFields)
        .eq('user_id', p.user_id)
        .maybeSingle()
      if (data) account = data
    }

    if (!account && p.phone_number) {
      const normalized = normalizePhoneDigits(p.phone_number)
      const { data } = await supabase
        .from('player_accounts')
        .select(selectFields)
        .eq('phone_number', normalized)
        .maybeSingle()
      if (data) account = data
      if (!account && normalized !== p.phone_number) {
        const { data: data2 } = await supabase
          .from('player_accounts')
          .select(selectFields)
          .eq('phone_number', p.phone_number)
          .maybeSingle()
        if (data2) account = data2
      }
    }

    if (!account && p.name) {
      const { data } = await supabase
        .from('player_accounts')
        .select(selectFields)
        .eq('name', p.name.trim())
        .maybeSingle()
      if (data) account = data
    }

    if (account) {
      accountsMap.set(p.id, account)
    }
  }

  const accountIds = Array.from(accountsMap.values()).map((a: any) => a.id)
  if (new Set(accountIds).size < accountIds.length) {
    console.error('[RatingEngine] Duplicate player_account mapping in match — skipping to avoid corrupt history:', matchId)
    return { error: true, skipped: true, message: 'Mapeamento duplicado de player_account — rating bloqueado' }
  }

  if (accountsMap.size < 4) {
    return { error: true, skipped: true, message: `Contas em falta (${accountsMap.size}/4)` }
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
    return { error: true, skipped: true, message: 'Não foi possível construir ratings dos 4 jogadores' }
  }

  const result = calculateNewRatings({ p1, p2 }, { p3, p4 }, score)

  if (result.skipped) {
    // Mark disparity (and similar soft skips) so we don't leave "unrated" forever
    // or retry the same no-op on every finalize — same behaviour as Player app.
    try {
      await supabase.rpc('mark_match_rating_processed', { p_match_id: matchId })
    } catch {
      /* ignore */
    }
    await supabase.from('matches').update({ rating_processed: true }).eq('id', matchId)
    return result
  }

  if (result.team1 && result.team2) {
    const allUpdatedPlayers = [result.team1.p1, result.team1.p2, result.team2.p3, result.team2.p4]
    let updateErrors = 0

    for (const rp of allUpdatedPlayers) {
      const formulaReliability = calculateReliability(rp.matches)
      // Get current reliability from account or cache
      const acctData = Array.from(accountsMap.values()).find((a: any) => a.id === rp.id)
      const currentReliability = cache?.get(rp.id)?.currentReliability ?? acctData?.level_reliability_percent ?? 0
      const protectedReliability = calculateProtectedReliability(formulaReliability, currentReliability)

      const { error } = await supabase.rpc('update_player_rating', {
        p_player_account_id: rp.id,
        p_new_level: rp.rating,
        p_new_reliability: protectedReliability,
        p_match_won: rp.won,
        p_source_id: matchId,
        p_match_type: 'tournament',
      })

      if (error) {
        console.error('[RatingEngine] Error updating player:', rp.id, error)
        updateErrors++
      } else {
        // Nota: o histórico (player_level_history) já é gravado dentro do RPC
        // update_player_rating com o source_id do jogo — não duplicar aqui
        // com uma segunda chamada client-side (isso impedia reverseRatingForSource
        // de encontrar/desfazer o delta certo ao reprocessar).
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
      }
    }

    // Only mark match as processed if ALL player updates succeeded
    if (updateErrors === 0) {
      const { error: markError } = await supabase.rpc('mark_match_rating_processed', {
        p_match_id: matchId,
      })
      if (markError) {
        console.error('[RatingEngine] Error marking match as processed:', matchId, markError)
      }
    } else {
      console.error(`[RatingEngine] Match ${matchId}: ${updateErrors}/4 player updates FAILED — match NOT marked as processed (will retry next time)`)
    }
    const logPlayer = (before: PlayerRating, after: PlayerRating & { delta: number }) => {
      const K = getKFactorForLog(after.matches)
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

/**
 * Desfaz o rating aplicado anteriormente para este jogo (via histórico) e
 * volta a aplicá-lo com os scores actuais.
 *
 * Segurança: se o jogo já tinha sido processado antes mas não foi possível
 * encontrar/desfazer o histórico correspondente (source_id em falta — ex.:
 * jogos processados antes desta função existir), o reprocessamento é
 * BLOQUEADO em vez de reaplicar um novo delta em cima do nível já alterado
 * (o que duplicaria/corromperia nível, jogos e V/D a cada reprocessamento).
 */
export async function reprocessMatchRating(matchId: string, cache?: PlayerCache): Promise<RatingResult | null> {
  const { data: match } = await supabase
    .from('matches')
    .select('id, rating_processed')
    .eq('id', matchId)
    .maybeSingle()

  const wasProcessed = !!match?.rating_processed
  const reversed = await reverseRatingForSource(matchId)

  if (wasProcessed && reversed === 0) {
    console.error(`[RatingEngine] BLOCKED reprocess for match ${matchId}: already rated but no history found to reverse safely.`)
    return { skipped: true, message: 'Reprocessamento bloqueado: histórico do jogo não encontrado para reverter em segurança.' }
  }

  await supabase
    .from('matches')
    .update({ rating_processed: false })
    .eq('id', matchId)

  return processMatchRating(matchId, cache)
}

/**
 * Reprocessa (com reversão segura por jogo) todos os jogos completos de um
 * torneio, por ordem cronológica. Substitui o padrão antigo de "reset em
 * massa da flag + processAllUnratedMatches", que reaplicava o delta em cima
 * do nível já alterado sem nunca o desfazer primeiro.
 */
export async function reprocessTournamentRatings(
  tournamentId: string,
  onProgress?: (current: number, total: number, info: string) => void,
): Promise<{ processed: number; skipped: number; blocked: number; errors: number; total: number; details: string[] }> {
  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, scheduled_time, match_number')
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed')
    .order('scheduled_time', { ascending: true })
    .order('match_number', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    console.error('[RatingEngine] Error fetching tournament matches:', error)
    return { processed: 0, skipped: 0, blocked: 0, errors: 1, total: 0, details: [error.message] }
  }

  if (!matches || matches.length === 0) {
    return { processed: 0, skipped: 0, blocked: 0, errors: 0, total: 0, details: [] }
  }

  const cache: PlayerCache = new Map()
  let processed = 0
  let skipped = 0
  let blocked = 0
  let errors = 0
  const details: string[] = []

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    try {
      const result = await reprocessMatchRating(m.id, cache)
      if (!result) {
        errors++
        details.push(`❌ ${m.id}: reprocess falhou (null)`)
      } else if (result.skipped) {
        if (result.message?.startsWith('Reprocessamento bloqueado')) {
          blocked++
          details.push(`🚫 ${m.id}: ${result.message}`)
        } else {
          skipped++
          if (result.message) details.push(`⏭️ ${m.id}: ${result.message}`)
        }
      } else if (result.error) {
        errors++
        details.push(`❌ ${m.id}: ${result.message || 'erro'}`)
      } else {
        processed++
      }
    } catch (err) {
      console.error('[RatingEngine] Error reprocessing match:', m.id, err)
      errors++
      details.push(`❌ ${m.id}: ${err instanceof Error ? err.message : String(err)}`)
    }

    if ((i + 1) % 5 === 0 || i === matches.length - 1) {
      onProgress?.(i + 1, matches.length, `Processados: ${processed} | Saltados: ${skipped} | Bloqueados: ${blocked} | Erros: ${errors}`)
    }
  }

  return { processed, skipped, blocked, errors, total: matches.length, details }
}

async function countUnratedCompleted(tournamentId: string): Promise<number> {
  const { count } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed')
    .or('rating_processed.is.null,rating_processed.eq.false')
  return count ?? 0
}

/**
 * Process all unrated completed matches in stable chronological order.
 * Collects visible failure details (no silent nulls).
 */
export async function processAllUnratedMatches(
  since?: string,
  onProgress?: (current: number, total: number, info: string) => void,
  tournamentId?: string
): Promise<{ processed: number; skipped: number; errors: number; total: number; details: string[]; remainingUnrated: number }> {
  let query = supabase
    .from('matches')
    .select('id, scheduled_time, match_number, tournament_id')
    .eq('status', 'completed')
    .or('rating_processed.is.null,rating_processed.eq.false')
    .order('scheduled_time', { ascending: true })
    .order('match_number', { ascending: true })
    .order('id', { ascending: true })

  if (tournamentId) {
    query = query.eq('tournament_id', tournamentId)
  }

  if (since) {
    query = query.gte('scheduled_time', since)
  }

  const { data: matches, error } = await query

  if (error) {
    console.error('[RatingEngine] Error fetching matches:', error)
    return { processed: 0, skipped: 0, errors: 1, total: 0, details: [error.message], remainingUnrated: -1 }
  }

  if (!matches || matches.length === 0) {
    const remaining = tournamentId ? await countUnratedCompleted(tournamentId) : 0
    return { processed: 0, skipped: 0, errors: 0, total: 0, details: [], remainingUnrated: remaining }
  }

  onProgress?.(0, matches.length, 'A iniciar processamento...')

  const playerCache: PlayerCache = new Map()
  let processed = 0
  let skipped = 0
  let errors = 0
  const details: string[] = []

  const runBatch = async (batch: typeof matches) => {
    for (let i = 0; i < batch.length; i++) {
      const match = batch[i]
      try {
        const result = await processMatchRating(match.id, playerCache)
        if (!result) {
          errors++
          details.push(`❌ ${match.id}: falha desconhecida`)
        } else if (result.error) {
          errors++
          details.push(`❌ ${match.id}: ${result.message || 'erro'}`)
        } else if (result.skipped) {
          skipped++
          if (result.message && result.message !== 'Already processed') {
            details.push(`⏭️ ${match.id}: ${result.message}`)
          }
        } else {
          processed++
        }
      } catch (err) {
        console.error('[RatingEngine] Error processing match:', match.id, err)
        errors++
        details.push(`❌ ${match.id}: ${err instanceof Error ? err.message : String(err)}`)
      }

      if ((i + 1) % 5 === 0 || i === batch.length - 1) {
        onProgress?.(i + 1, batch.length, `Processados: ${processed} | Saltados: ${skipped} | Erros: ${errors}`)
      }
    }
  }

  await runBatch(matches)

  // One automatic retry for remaining unrated (transient RPC / network)
  if (tournamentId) {
    let remaining = await countUnratedCompleted(tournamentId)
    if (remaining > 0) {
      details.push(`⟳ Retry automático: ${remaining} jogo(s) ainda sem rating`)
      const { data: retryMatches } = await supabase
        .from('matches')
        .select('id, scheduled_time, match_number, tournament_id')
        .eq('tournament_id', tournamentId)
        .eq('status', 'completed')
        .or('rating_processed.is.null,rating_processed.eq.false')
        .order('scheduled_time', { ascending: true })
        .order('match_number', { ascending: true })
        .order('id', { ascending: true })
      if (retryMatches && retryMatches.length > 0) {
        await runBatch(retryMatches)
      }
      remaining = await countUnratedCompleted(tournamentId)
    }
  }

  const remainingUnrated = tournamentId ? await countUnratedCompleted(tournamentId) : 0
  if (remainingUnrated > 0) {
    details.push(`⚠️ FICARAM ${remainingUnrated} jogo(s) completed SEM rating — usar «Reprocessar ratings»`)
  }

  const summary = `CONCLUÍDO: ${processed} processados, ${skipped} saltados, ${errors} erros de ${matches.length} | por processar: ${remainingUnrated}`
  onProgress?.(matches.length, matches.length, summary)

  return { processed, skipped, errors, total: matches.length, details, remainingUnrated }
}

// ============================================
// Pódio (bónus ELO campeão/finalista) — parity with Player app
// ============================================

function resolveTournamentTierForPodium(tournament: {
  name?: string | null
  format?: string | null
  round_robin_type?: string | null
  ranking_tier?: string | null
}): 'master' | 'regular' | 'social' {
  const explicit = String(tournament.ranking_tier || '').toLowerCase().trim()
  if (explicit === 'master' || explicit === 'oficial' || explicit === 'oficial_apc') return 'master'
  if (explicit === 'regular' || explicit === 'open') return 'regular'
  if (explicit === 'social' || explicit === 'americano' || explicit === 'american') return 'social'
  const name = String(tournament.name || '').toUpperCase()
  const format = String(tournament.format || '').toLowerCase()
  const rr = String(tournament.round_robin_type || '').toLowerCase()
  if (/\bMASTER\b/.test(name) || /\bOFICIAL\b/.test(name)) return 'master'
  if (/\bAPC\b/.test(name) && !/SOCIAL|AMERICANO/.test(name)) return 'master'
  if (format === 'mixed_american' || rr === 'individual' || /SOCIAL|AMERICANO|AMERICAN/.test(name)) return 'social'
  return 'regular'
}

const TIER_PLACEMENT_POINTS: Record<'master' | 'regular' | 'social', { first: number; second: number }> = {
  master: { first: 1000, second: 600 },
  regular: { first: 500, second: 300 },
  social: { first: 250, second: 150 },
}

/**
 * Applies fixed podium ELO bonuses: champion +0.10 / finalist +0.05.
 * Idempotent via player_level_history (source_id=tournamentId, delta=bonus).
 * Also writes ranking_point_transactions for 12m ranking.
 */
export async function applyTournamentPodiumBonuses(
  tournamentId: string,
  categoryId?: string | null,
): Promise<PodiumBonusResult> {
  const empty: PodiumBonusResult = { applied: false, champions: [], finalists: [] }

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, club_id, name, format, round_robin_type, ranking_tier')
    .eq('id', tournamentId)
    .maybeSingle()

  if (!tournament) {
    return { ...empty, message: 'Torneio não encontrado' }
  }

  const organizationId = (tournament.club_id as string | null) || null
  const tier = resolveTournamentTierForPodium(tournament)

  let championPlayerIds: string[] = []
  let finalistPlayerIds: string[] = []

  let teamsQuery = supabase
    .from('teams')
    .select('id, player1_id, player2_id, final_position, category_id')
    .eq('tournament_id', tournamentId)
    .in('final_position', [1, 2])
  if (categoryId) teamsQuery = teamsQuery.eq('category_id', categoryId)
  const { data: podiumTeams } = await teamsQuery

  if (podiumTeams && podiumTeams.length > 0) {
    for (const t of podiumTeams) {
      const ids = [t.player1_id, t.player2_id].filter(Boolean) as string[]
      if (t.final_position === 1) championPlayerIds.push(...ids)
      else if (t.final_position === 2) finalistPlayerIds.push(...ids)
    }
  }

  if (championPlayerIds.length === 0 && finalistPlayerIds.length === 0) {
    let playersQuery = supabase
      .from('players')
      .select('id, final_position, category_id')
      .eq('tournament_id', tournamentId)
      .in('final_position', [1, 2])
    if (categoryId) playersQuery = playersQuery.eq('category_id', categoryId)
    const { data: podiumPlayers } = await playersQuery
    if (podiumPlayers) {
      for (const p of podiumPlayers) {
        if (p.final_position === 1) championPlayerIds.push(p.id)
        else if (p.final_position === 2) finalistPlayerIds.push(p.id)
      }
    }
  }

  championPlayerIds = [...new Set(championPlayerIds)]
  finalistPlayerIds = [...new Set(finalistPlayerIds)].filter((id) => !championPlayerIds.includes(id))

  if (championPlayerIds.length === 0 && finalistPlayerIds.length === 0) {
    return { ...empty, message: 'Não foi possível determinar campeões/finalistas (final_position)' }
  }

  const allPlayerIds = [...championPlayerIds, ...finalistPlayerIds]
  const { data: playersData } = await supabase
    .from('players')
    .select('id, name, user_id, player_account_id, phone_number')
    .in('id', allPlayerIds)

  if (!playersData?.length) {
    return { ...empty, message: 'Jogadores do pódio não encontrados' }
  }

  const accountByPlayer = new Map<string, any>()
  for (const p of playersData) {
    let account: any = null
    if ((p as any).player_account_id) {
      const { data } = await supabase
        .from('player_accounts')
        .select('id, user_id, name, level, rated_matches')
        .eq('id', (p as any).player_account_id)
        .maybeSingle()
      account = data
    }
    if (!account && p.user_id) {
      const { data } = await supabase
        .from('player_accounts')
        .select('id, user_id, name, level, rated_matches')
        .eq('user_id', p.user_id)
        .maybeSingle()
      account = data
    }
    if (account) accountByPlayer.set(p.id, account)
  }

  const champions: PodiumBonusResult['champions'] = []
  const finalists: PodiumBonusResult['finalists'] = []

  const applyBonus = async (
    playerId: string,
    bonus: number,
    reason: 'tournament_winner' | 'tournament_finalist',
    position: 1 | 2,
  ) => {
    const acct = accountByPlayer.get(playerId)
    if (!acct) return

    const { data: already } = await supabase
      .from('player_level_history')
      .select('id')
      .eq('player_account_id', acct.id)
      .eq('source_id', tournamentId)
      .eq('delta', bonus)
      .limit(1)
    if (already && already.length > 0) return

    const levelBefore = Number(acct.level ?? 3.0)
    const levelAfter = Math.max(0.5, Math.min(7.0, parseFloat((levelBefore + bonus).toFixed(2))))

    const { error: updErr } = await supabase
      .from('player_accounts')
      .update({ level: levelAfter, updated_at: new Date().toISOString() })
      .eq('id', acct.id)
    if (updErr) {
      console.error('[RatingEngine] Podium level update failed:', acct.id, updErr)
      return
    }

    await supabase.from('player_level_history').insert({
      player_account_id: acct.id,
      level_before: parseFloat(levelBefore.toFixed(2)),
      level_after: parseFloat(levelAfter.toFixed(2)),
      delta: parseFloat(bonus.toFixed(4)),
      match_type: 'tournament',
      match_won: reason === 'tournament_winner',
      source_id: tournamentId,
    })

    if (organizationId && acct.user_id) {
      const points = position === 1 ? TIER_PLACEMENT_POINTS[tier].first : TIER_PLACEMENT_POINTS[tier].second
      const { data: existingTx } = await supabase
        .from('ranking_point_transactions')
        .select('id')
        .eq('user_id', acct.user_id)
        .eq('reference_id', tournamentId)
        .eq('reason', reason)
        .limit(1)
      if (!existingTx?.length) {
        await supabase.from('ranking_point_transactions').insert({
          user_id: acct.user_id,
          organization_id: organizationId,
          points_awarded: points,
          reason,
          reference_id: tournamentId,
        })
      }
    }

    const row = {
      id: acct.id as string,
      name: (acct.name || '') as string,
      levelBefore,
      levelAfter,
      bonus,
    }
    if (position === 1) champions.push(row)
    else finalists.push(row)
  }

  for (const pid of championPlayerIds) {
    await applyBonus(pid, PODIUM_BONUS_CHAMPION, 'tournament_winner', 1)
  }
  for (const pid of finalistPlayerIds) {
    await applyBonus(pid, PODIUM_BONUS_FINALIST, 'tournament_finalist', 2)
  }

  return {
    applied: champions.length + finalists.length > 0,
    champions,
    finalists,
    message: champions.length + finalists.length > 0
      ? `Pódio: ${champions.length} campeão(ões) +${PODIUM_BONUS_CHAMPION}, ${finalists.length} finalista(s) +${PODIUM_BONUS_FINALIST}`
      : 'Pódio já aplicado ou sem contas',
  }
}

/**
 * Full tournament rating close-out: chronological unrated batch + verify + podium.
 * Use from Finalizar / Reprocessar so organizers never get silent partial runs.
 */
export async function finalizeTournamentRatings(
  tournamentId: string,
  onProgress?: (current: number, total: number, info: string) => void,
): Promise<TournamentRatingReport> {
  const rating = await processAllUnratedMatches(undefined, onProgress, tournamentId)
  const podium = await applyTournamentPodiumBonuses(tournamentId)
  const remainingUnrated = await countUnratedCompleted(tournamentId)
  const details = [...(rating.details || [])]
  if (podium.message) details.push(`🏆 ${podium.message}`)
  for (const c of podium.champions) {
    details.push(`🥇 ${c.name}: ${c.levelBefore.toFixed(2)} → ${c.levelAfter.toFixed(2)} (+${c.bonus})`)
  }
  for (const f of podium.finalists) {
    details.push(`🥈 ${f.name}: ${f.levelBefore.toFixed(2)} → ${f.levelAfter.toFixed(2)} (+${f.bonus})`)
  }
  if (remainingUnrated > 0) {
    details.push(`⚠️ AINDA HÁ ${remainingUnrated} jogo(s) sem rating — NÃO está OK`)
  }
  return {
    processed: rating.processed,
    skipped: rating.skipped,
    errors: rating.errors,
    total: rating.total,
    remainingUnrated,
    details,
    podium,
  }
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
    return { awarded: 0, skipped: 0, errors: 0, details: ['Sem regra de reward "tournament_played" ativa neste clube'] }
  }

  const { data: players } = await supabase
    .from('players')
    .select('id, name, user_id, phone_number')
    .eq('tournament_id', tournamentId)

  if (!players || players.length === 0) {
    return { awarded: 0, skipped: 0, errors: 0, details: ['Sem jogadores no torneio'] }
  }


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

  return { awarded, skipped, errors, details }
}
