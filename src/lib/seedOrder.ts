import { supabase } from './supabase';

export type SeedParticipant = {
  id: string;
  name: string;
  seed?: number | null;
  subtitle?: string;
};

/** Persist CS1..N from an ordered list (teams or players). Sets seed_mode = manual. */
export async function applyManualSeedOrder(params: {
  tournamentId: string;
  isIndividual: boolean;
  orderedIds: string[];
}): Promise<{ error: string | null }> {
  const updates = params.orderedIds.map((id, index) => ({ id, seed: index + 1 }));

  const { error: rpcError } = await supabase.rpc('set_tournament_seeds', {
    p_tournament_id: params.tournamentId,
    p_player_updates: params.isIndividual ? updates : [],
    p_team_updates: params.isIndividual ? [] : updates,
  });

  if (rpcError) {
    return { error: rpcError.message };
  }

  const { error: modeError } = await supabase
    .from('tournaments')
    .update({ seed_mode: 'manual' })
    .eq('id', params.tournamentId);

  if (modeError) {
    return { error: modeError.message };
  }

  return { error: null };
}

export async function setTournamentSeedMode(
  tournamentId: string,
  mode: 'level' | 'manual'
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('tournaments')
    .update({ seed_mode: mode })
    .eq('id', tournamentId);
  return { error: error?.message || null };
}
