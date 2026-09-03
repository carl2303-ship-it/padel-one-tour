import { supabase } from './supabase'

export interface LevelHistoryEntry {
  id: string
  player_account_id: string
  level_before: number
  level_after: number
  delta: number
  match_type: 'tournament' | 'open_game'
  match_won: boolean | null
  source_id?: string | null
  created_at: string
}

/**
 * Logs a level change after a rated match is processed.
 * Fire-and-forget — errors are logged but never block the caller.
 *
 * Nota: para jogos processados via RPC `update_player_rating` (com
 * p_source_id), o histórico já é gravado dentro do próprio RPC — não chamar
 * esta função nesse caso, para não duplicar linhas em player_level_history.
 */
export async function logLevelChange(
  playerAccountId: string,
  levelBefore: number,
  levelAfter: number,
  delta: number,
  matchType: 'tournament' | 'open_game',
  matchWon: boolean | null,
  sourceId?: string | null,
): Promise<void> {
  try {
    const { error } = await supabase
      .from('player_level_history')
      .insert({
        player_account_id: playerAccountId,
        level_before: parseFloat(levelBefore.toFixed(2)),
        level_after: parseFloat(levelAfter.toFixed(2)),
        delta: parseFloat(delta.toFixed(4)),
        match_type: matchType,
        match_won: matchWon,
        source_id: sourceId || null,
      })

    if (error) {
      console.warn('[LevelHistory] Insert failed:', error.message)
    }
  } catch (err) {
    console.warn('[LevelHistory] Unexpected error:', err)
  }
}

/**
 * Fetches level history for a player, ordered by most recent first.
 */
export async function fetchLevelHistory(
  playerAccountId: string,
  limit = 20,
): Promise<LevelHistoryEntry[]> {
  try {
    const { data, error } = await supabase
      .from('player_level_history')
      .select('*')
      .eq('player_account_id', playerAccountId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.warn('[LevelHistory] Fetch failed:', error.message)
      return []
    }

    return (data ?? []) as LevelHistoryEntry[]
  } catch {
    return []
  }
}

/**
 * Reverses all rating changes logged for a match / open game, and deletes those history rows.
 * Safe to call when no history exists (returns 0).
 */
export async function reverseRatingForSource(sourceId: string): Promise<number> {
  if (!sourceId) return 0
  try {
    const { data, error } = await supabase.rpc('reverse_rating_for_source', {
      p_source_id: sourceId,
    })
    if (error) {
      console.warn('[LevelHistory] reverse_rating_for_source failed:', error.message)
      // Fallback: try client-side reverse if RPC missing
      return await reverseRatingForSourceClient(sourceId)
    }
    return typeof data === 'number' ? data : 0
  } catch (err) {
    console.warn('[LevelHistory] reverseRatingForSource error:', err)
    return await reverseRatingForSourceClient(sourceId)
  }
}

async function reverseRatingForSourceClient(sourceId: string): Promise<number> {
  const { data: rows, error } = await supabase
    .from('player_level_history')
    .select('id, player_account_id, delta, match_won')
    .eq('source_id', sourceId)

  if (error || !rows?.length) return 0

  let count = 0
  for (const row of rows) {
    const { error: rpcErr } = await supabase.rpc('reverse_player_rating', {
      p_player_account_id: row.player_account_id,
      p_delta: row.delta,
      p_match_won: row.match_won,
    })
    if (rpcErr) {
      // Manual fallback if reverse RPC also missing
      const { data: acct } = await supabase
        .from('player_accounts')
        .select('level, rated_matches, wins, losses')
        .eq('id', row.player_account_id)
        .maybeSingle()
      if (acct) {
        await supabase
          .from('player_accounts')
          .update({
            level: Math.max(0.5, Number(acct.level ?? 3) - Number(row.delta ?? 0)),
            rated_matches: Math.max(0, (acct.rated_matches ?? 0) - 1),
            wins: row.match_won === true ? Math.max(0, (acct.wins ?? 0) - 1) : (acct.wins ?? 0),
            losses: row.match_won === false ? Math.max(0, (acct.losses ?? 0) - 1) : (acct.losses ?? 0),
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.player_account_id)
      }
    }
    await supabase.from('player_level_history').delete().eq('id', row.id)
    count++
  }
  return count
}
