import { supabase, Tournament } from './supabase';

const INDIVIDUAL_FORMATS = ['individual_groups_knockout', 'mixed_american', 'mixed_gender'];

export function isIndividualTournament(
  tournament: Pick<Tournament, 'format' | 'round_robin_type'>
): boolean {
  return (
    INDIVIDUAL_FORMATS.includes(tournament.format) ||
    (tournament.format === 'round_robin' && tournament.round_robin_type === 'individual')
  );
}

/**
 * Contagens para cards de lista / capacidade:
 * - individual / super_teams → jogadores
 * - resto (equipas) → número de equipas (alinhado com max_teams)
 */
export async function fetchTournamentRegistrationCounts(
  tournamentsList: Pick<Tournament, 'id' | 'format' | 'round_robin_type'>[]
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  await Promise.all(
    tournamentsList.map(async (tournament) => {
      const { id, format } = tournament;

      if (format === 'super_teams') {
        const { count } = await supabase
          .from('super_teams')
          .select('id', { count: 'exact', head: true })
          .eq('tournament_id', id);
        counts[id] = count ?? 0;
        return;
      }

      if (isIndividualTournament(tournament)) {
        const { count } = await supabase
          .from('players')
          .select('id', { count: 'exact', head: true })
          .eq('tournament_id', id);
        counts[id] = count ?? 0;
        return;
      }

      const { count: teamCount } = await supabase
        .from('teams')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', id);

      if ((teamCount ?? 0) > 0) {
        counts[id] = teamCount ?? 0;
        return;
      }

      const { count: playerCount } = await supabase
        .from('players')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', id);
      counts[id] = playerCount ?? 0;
    })
  );

  return counts;
}
