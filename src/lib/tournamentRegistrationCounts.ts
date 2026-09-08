import { supabase, Tournament } from './supabase';
import { selectInChunks } from './selectInChunks';

const INDIVIDUAL_FORMATS = ['individual_groups_knockout', 'mixed_american', 'mixed_gender'];

export function isIndividualTournament(
  tournament: Pick<Tournament, 'format' | 'round_robin_type'>
): boolean {
  return (
    INDIVIDUAL_FORMATS.includes(tournament.format) ||
    (tournament.format === 'round_robin' && tournament.round_robin_type === 'individual')
  );
}

function countByTournamentId(rows: { tournament_id: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.tournament_id] = (counts[row.tournament_id] || 0) + 1;
  }
  return counts;
}

/**
 * Contagens para cards de lista / capacidade:
 * - individual / super_teams → jogadores
 * - resto (equipas) → número de equipas (alinhado com max_teams)
 *
 * Usa poucas queries em batch (não 1 COUNT por torneio).
 */
export async function fetchTournamentRegistrationCounts(
  tournamentsList: Pick<Tournament, 'id' | 'format' | 'round_robin_type'>[]
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (tournamentsList.length === 0) return counts;

  const individualIds: string[] = [];
  const superIds: string[] = [];
  const teamFormatIds: string[] = [];

  for (const tournament of tournamentsList) {
    counts[tournament.id] = 0;
    if (tournament.format === 'super_teams') {
      superIds.push(tournament.id);
    } else if (isIndividualTournament(tournament)) {
      individualIds.push(tournament.id);
    } else {
      teamFormatIds.push(tournament.id);
    }
  }

  const [teamRows, superRows] = await Promise.all([
    teamFormatIds.length > 0
      ? selectInChunks<{ tournament_id: string }>('teams', 'tournament_id', 'tournament_id', teamFormatIds)
      : Promise.resolve([] as { tournament_id: string }[]),
    superIds.length > 0
      ? selectInChunks<{ tournament_id: string }>('super_teams', 'tournament_id', 'tournament_id', superIds)
      : Promise.resolve([] as { tournament_id: string }[]),
  ]);

  const teamCounts = countByTournamentId(teamRows);
  const superCounts = countByTournamentId(superRows);

  for (const id of superIds) {
    counts[id] = superCounts[id] || 0;
  }
  for (const id of teamFormatIds) {
    counts[id] = teamCounts[id] || 0;
  }

  const playerFallbackIds = [
    ...individualIds,
    ...teamFormatIds.filter((id) => (teamCounts[id] || 0) === 0),
  ];

  if (playerFallbackIds.length > 0) {
    const playerRows = await selectInChunks<{ tournament_id: string }>(
      'players',
      'tournament_id',
      'tournament_id',
      playerFallbackIds
    );
    const playerCounts = countByTournamentId(playerRows);
    for (const id of playerFallbackIds) {
      counts[id] = playerCounts[id] || 0;
    }
  }

  return counts;
}
