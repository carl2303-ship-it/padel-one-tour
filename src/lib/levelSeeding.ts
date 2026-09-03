import { supabase } from './supabase';

function toLevel(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function phoneKey(phone: string | null | undefined): string {
  return (phone || '').replace(/[\s\-\(\)\.+]/g, '');
}

async function loadPlayerLevels(
  players: Array<{ id: string; player_account_id?: string | null; phone_number?: string | null }>
): Promise<Map<string, number>> {
  const levels = new Map<string, number>();
  if (players.length === 0) return levels;

  const accountIds = [...new Set(players.map(p => p.player_account_id).filter((id): id is string => !!id))];
  const phones = [...new Set(players.map(p => phoneKey(p.phone_number)).filter(Boolean))];

  const accounts: Array<{ id: string; phone_number: string | null; level: number | null }> = [];

  if (accountIds.length > 0) {
    const { data } = await supabase
      .from('player_accounts')
      .select('id, phone_number, level')
      .in('id', accountIds);
    if (data) accounts.push(...data);
  }

  if (phones.length > 0) {
    const { data } = await supabase
      .from('player_accounts')
      .select('id, phone_number, level')
      .in('phone_number', phones);
    if (data) {
      const seen = new Set(accounts.map(a => a.id));
      for (const row of data) {
        if (!seen.has(row.id)) accounts.push(row);
      }
    }
  }

  const byAccountId = new Map<string, number>();
  const byPhone = new Map<string, number>();
  for (const account of accounts) {
    const level = toLevel(account.level);
    byAccountId.set(account.id, level);
    const key = phoneKey(account.phone_number);
    if (key) byPhone.set(key, level);
  }

  for (const player of players) {
    if (player.player_account_id && byAccountId.has(player.player_account_id)) {
      levels.set(player.id, byAccountId.get(player.player_account_id)!);
      continue;
    }
    const key = phoneKey(player.phone_number);
    levels.set(player.id, key && byPhone.has(key) ? byPhone.get(key)! : 0);
  }

  return levels;
}

function categoryKey(categoryId: string | null | undefined): string {
  return categoryId || '__none__';
}

async function applyRankedSeeds(
  table: 'teams' | 'players',
  ranked: Array<{ id: string }>
): Promise<Map<string, number>> {
  const seeds = new Map<string, number>();
  await Promise.all(
    ranked.map(async (row, index) => {
      const seed = index + 1;
      seeds.set(row.id, seed);
      const { error } = await supabase.from(table).update({ seed }).eq('id', row.id);
      if (error) {
        console.error(`[LEVEL_SEEDING] Failed to update ${table} ${row.id}:`, error);
      }
    })
  );
  return seeds;
}

/**
 * Assigns CS1, CS2, ... from player levels:
 *  - doubles: sum of the two players' levels (highest sum = CS1)
 *  - individual american: the player's own level (highest = CS1)
 * Rankings are per category.
 */
export async function recalculateSeedsByLevel(
  tournamentId: string,
  categoryId?: string | null
): Promise<{ teamSeeds: Map<string, number>; playerSeeds: Map<string, number> }> {

  let teamsQuery = supabase
    .from('teams')
    .select('id, name, category_id, player1_id, player2_id')
    .eq('tournament_id', tournamentId);
  if (categoryId) teamsQuery = teamsQuery.eq('category_id', categoryId);

  let playersQuery = supabase
    .from('players')
    .select('id, name, category_id, player_account_id, phone_number')
    .eq('tournament_id', tournamentId);
  if (categoryId) playersQuery = playersQuery.eq('category_id', categoryId);

  const [{ data: teams, error: teamsError }, { data: players, error: playersError }] = await Promise.all([
    teamsQuery,
    playersQuery,
  ]);

  if (teamsError) console.error('[LEVEL_SEEDING] Teams fetch error:', teamsError);
  if (playersError) console.error('[LEVEL_SEEDING] Players fetch error:', playersError);

  const teamList = teams || [];
  const playerList = players || [];
  const teamPlayerIds = new Set(teamList.flatMap(t => [t.player1_id, t.player2_id].filter(Boolean)));

  const teamSeeds = new Map<string, number>();
  const playerSeeds = new Map<string, number>();

  if (teamList.length > 0) {
    const neededIds = [...teamPlayerIds] as string[];
    const roster = playerList.filter(p => neededIds.includes(p.id));
    const missingIds = neededIds.filter(id => !roster.some(p => p.id === id));
    if (missingIds.length > 0) {
      const { data: extra } = await supabase
        .from('players')
        .select('id, name, category_id, player_account_id, phone_number')
        .in('id', missingIds);
      if (extra) roster.push(...extra);
    }

    const levels = await loadPlayerLevels(roster);
    const byCategory = new Map<string, typeof teamList>();
    for (const team of teamList) {
      const key = categoryKey(team.category_id);
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(team);
    }

    for (const group of byCategory.values()) {
      const ranked = [...group].sort((a, b) => {
        const sumA = (levels.get(a.player1_id) || 0) + (levels.get(a.player2_id) || 0);
        const sumB = (levels.get(b.player1_id) || 0) + (levels.get(b.player2_id) || 0);
        if (sumB !== sumA) return sumB - sumA;
        return (a.name || '').localeCompare(b.name || '');
      });
      const seeds = await applyRankedSeeds('teams', ranked);
      seeds.forEach((seed, id) => teamSeeds.set(id, seed));
    }
  }

  const individuals = playerList.filter(p => !teamPlayerIds.has(p.id));
  if (individuals.length > 0) {
    const levels = await loadPlayerLevels(individuals);
    const byCategory = new Map<string, typeof individuals>();
    for (const player of individuals) {
      const key = categoryKey(player.category_id);
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(player);
    }

    for (const group of byCategory.values()) {
      const ranked = [...group].sort((a, b) => {
        const levelA = levels.get(a.id) || 0;
        const levelB = levels.get(b.id) || 0;
        if (levelB !== levelA) return levelB - levelA;
        return (a.name || '').localeCompare(b.name || '');
      });
      const seeds = await applyRankedSeeds('players', ranked);
      seeds.forEach((seed, id) => playerSeeds.set(id, seed));
    }
  }

  return { teamSeeds, playerSeeds };
}
