import { supabase, type Player } from './supabase';
import { normalizePhoneKey } from './phoneUtils';

const PAGE_SIZE = 1000;

type PlayerRow = Pick<Player, 'id' | 'name' | 'email' | 'phone_number'> & {
  tournament_id?: string | null;
  player_account_id?: string | null;
};

type PlayerIdentity = {
  name: string;
  email?: string | null;
  phone_number?: string | null;
  player_account_id?: string | null;
};

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase('pt').replace(/\s+/g, ' ');
}

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLocaleLowerCase('pt') ?? '';
}

export function isSameOrganizerPlayer(
  first: PlayerIdentity,
  second: PlayerIdentity,
): boolean {
  if (
    first.player_account_id &&
    second.player_account_id &&
    first.player_account_id === second.player_account_id
  ) {
    return true;
  }

  const firstPhone = normalizePhoneKey(first.phone_number);
  const secondPhone = normalizePhoneKey(second.phone_number);
  if (firstPhone && secondPhone && firstPhone === secondPhone) return true;

  const firstEmail = normalizeEmail(first.email);
  const secondEmail = normalizeEmail(second.email);
  if (firstEmail && secondEmail && firstEmail === secondEmail) return true;

  const sameName = normalizeName(first.name) === normalizeName(second.name);
  const compatibleEmail = !firstEmail || !secondEmail || firstEmail === secondEmail;
  return sameName && compatibleEmail && (!firstPhone || !secondPhone);
}

function playerScore(player: PlayerRow, preferredTournamentId?: string): number {
  return (
    (player.tournament_id === preferredTournamentId ? 100 : 0) +
    (player.player_account_id ? 10 : 0) +
    (player.email ? 4 : 0) +
    (normalizePhoneKey(player.phone_number) ? 2 : 0)
  );
}

function mergePlayerRows<T extends PlayerRow>(
  first: T,
  second: T,
  preferredTournamentId?: string,
): T {
  const primary = playerScore(second, preferredTournamentId) > playerScore(first, preferredTournamentId)
    ? second
    : first;
  const fallback = primary === first ? second : first;

  return {
    ...fallback,
    ...primary,
    email: primary.email || fallback.email,
    phone_number: normalizePhoneKey(primary.phone_number || fallback.phone_number) || null,
    player_account_id: primary.player_account_id || fallback.player_account_id,
  };
}

function dedupePlayers<T extends PlayerRow>(
  players: T[],
  preferredTournamentId?: string,
): T[] {
  return players.reduce((unique: T[], player) => {
    const index = unique.findIndex(existing => isSameOrganizerPlayer(existing, player));
    if (index === -1) {
      unique.push({
        ...player,
        phone_number: normalizePhoneKey(player.phone_number) || null,
      });
    } else {
      unique[index] = mergePlayerRows(unique[index], player, preferredTournamentId);
    }
    return unique;
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
export async function fetchAllOrganizerPlayers(
  tournamentIds: string[],
  preferredTournamentId?: string,
): Promise<PlayerRow[]> {
  if (!tournamentIds.length) return [];

  const all: PlayerRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('players')
      .select('id, name, email, phone_number, tournament_id, player_account_id')
      .in('tournament_id', tournamentIds)
      .order('name', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data?.length) break;

    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return dedupePlayers(all, preferredTournamentId);
}

/** Server-side name search (finds players beyond the first 1000 alphabetically). */
export async function searchOrganizerPlayers(
  tournamentIds: string[],
  query: string,
  preferredTournamentId?: string,
): Promise<PlayerRow[]> {
  const term = query.trim();
  if (term.length < 2 || !tournamentIds.length) return [];

  const { data, error } = await supabase
    .from('players')
    .select('id, name, email, phone_number, tournament_id, player_account_id')
    .in('tournament_id', tournamentIds)
    .ilike('name', `%${term}%`)
    .order('name', { ascending: true })
    .limit(200);

  if (error) throw error;
  return dedupePlayers(data ?? [], preferredTournamentId);
}
