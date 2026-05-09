import { supabase } from './supabase'

/**
 * Logs a level change after a rated match is processed.
 * Fire-and-forget — errors are logged but never block the caller.
 */
export async function logLevelChange(
  playerAccountId: string,
  levelBefore: number,
  levelAfter: number,
  delta: number,
  matchType: 'tournament' | 'open_game',
  matchWon: boolean | null,
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
      })

    if (error) {
      console.warn('[LevelHistory] Insert failed:', error.message)
    }
  } catch (err) {
    console.warn('[LevelHistory] Unexpected error:', err)
  }
}
