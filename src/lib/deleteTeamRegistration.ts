import { supabase } from './supabase';

/**
 * Remove uma equipa de torneio e os jogadores associados, para a lista de
 * inscrições e as métricas (contagem de jogadores) ficarem alinhadas.
 */
export async function deleteTeamAndPlayers(teamId: string): Promise<void> {
  const { data: team, error: teamFetchError } = await supabase
    .from('teams')
    .select('id, tournament_id, name, player1_id, player2_id')
    .eq('id', teamId)
    .maybeSingle();

  if (teamFetchError) throw teamFetchError;
  if (!team) return;

  const playerIds = [team.player1_id, team.player2_id].filter(Boolean) as string[];

  const [m1, m2] = await Promise.all([
    supabase.from('matches').select('id').eq('team1_id', teamId),
    supabase.from('matches').select('id').eq('team2_id', teamId),
  ]);
  const matchIds = [...new Set([
    ...(m1.data || []).map(m => m.id),
    ...(m2.data || []).map(m => m.id),
  ])];

  if (matchIds.length > 0) {
    await supabase.from('court_bookings').delete().in('tournament_match_id', matchIds);
    const { error: matchErr } = await supabase.from('matches').delete().in('id', matchIds);
    if (matchErr) throw matchErr;
  }

  let playerRows: Array<{ id: string; name: string | null; phone_number: string | null }> = [];
  if (playerIds.length > 0) {
    const { data, error } = await supabase
      .from('players')
      .select('id, name, phone_number')
      .in('id', playerIds);
    if (error) throw error;
    playerRows = data || [];
  }

  const { error: teamDeleteError } = await supabase.from('teams').delete().eq('id', teamId);
  if (teamDeleteError) throw teamDeleteError;

  if (playerIds.length > 0) {
    const { error: playersDeleteError } = await supabase.from('players').delete().in('id', playerIds);
    if (playersDeleteError) throw playersDeleteError;
  }

  // Limpar ledger de métricas dos jogadores removidos neste torneio
  if (team.tournament_id && playerRows.length > 0) {
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('user_id')
      .eq('id', team.tournament_id)
      .maybeSingle();

    const ownerId = tournament?.user_id;
    if (ownerId) {
      for (const player of playerRows) {
        if (!player.name) continue;
        const { error: txErr } = await supabase.rpc('delete_player_transaction', {
          p_club_owner_id: ownerId,
          p_reference_id: team.tournament_id,
          p_reference_type: 'tournament',
          p_player_name: player.name.trim(),
          p_player_phone: player.phone_number,
        });
        if (txErr) {
          console.warn('[deleteTeamAndPlayers] transaction cleanup failed:', txErr);
        }
      }
    }
  }
}
