import { supabase, type Player } from './supabase';

const PAGE_SIZE = 1000;

type PlayerRow = Pick<Player, 'id' | 'name' | 'email' | 'phone_number'> & {
  tournament_id?: string;
};

function dedupePlayers<T extends PlayerRow>(players: T[]): T[] {
  return players.reduce((acc: T[], player) => {
    const key = player.phone_number?.replace(/\s+/g, '') || player.name;
    const existing = acc.find(p =>
      (p.phone_number?.replace(/\s+/g, '') === key) ||
      (!p.phone_number && !player.phone_number && p.name === player.name)
    );
    if (!existing) acc.push(player);
    return acc;
  }, []);
}

export async function getOrganizerTournamentIds(organizerId: string): Promise<string[]> {
  const { data } = await supabase
    .from('tournaments')
    .select('id')
    .eq('user_id', organizerId);
  return data?.map(t => t.id) ?? [];
}

/** Fetch all players across organizer tournaments (paginated past PostgREST 1000-row default). */
export async function fetchAllOrganizerPlayers(tournamentIds: string[]): Promise<PlayerRow[]> {
  if (!tournamentIds.length) return [];

  const all: PlayerRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('players')
      .select('id, name, email, phone_number, tournament_id')
      .in('tournament_id', tournamentIds)
      .order('name', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data?.length) break;

    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return dedupePlayers(all);
}

/** Server-side name search (finds players beyond the first 1000 alphabetically). */
export async function searchOrganizerPlayers(
  tournamentIds: string[],
  query: string,
): Promise<PlayerRow[]> {
  const term = query.trim();
  if (term.length < 2 || !tournamentIds.length) return [];

  const { data, error } = await supabase
    .from('players')
    .select('id, name, email, phone_number, tournament_id')
    .in('tournament_id', tournamentIds)
    .ilike('name', `%${term}%`)
    .order('name', { ascending: true })
    .limit(200);

  if (error) throw error;
  return dedupePlayers(data ?? []);
}
