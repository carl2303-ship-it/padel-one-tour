import { supabase } from './supabase';
import {
  computeTournamentPlayerPrice,
  normalizeNameKey,
  normalizePhoneKey,
  type MemberPriceInfo,
} from './playerTournamentPrice';
import { isIndividualTournament } from './tournamentRegistrationCounts';

export type DateFilter = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface TournamentMetric {
  tournamentId: string;
  tournamentName: string;
  startDate: string;
  registrations: number;
  newPlayers: number;
  memberRegistrations: number;
  revenue: number;
  paidCount: number;
}

export interface MembershipMetric {
  totalMembers: number;
  activeMembers: number;
  totalRevenue: number;
  plans: Array<{ name: string; count: number; revenue: number }>;
}

export interface PlayerSpending {
  playerName: string;
  playerPhone: string | null;
  tournamentSpent: number;
  membershipSpent: number;
  totalSpent: number;
  isMember: boolean;
  tournamentCount: number;
}

export function getDateRange(filter: DateFilter, customStart?: string, customEnd?: string): DateRange {
  const now = new Date();
  const toYmd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const end = new Date(now);
  let start = new Date(now);

  switch (filter) {
    case 'today':
      start.setHours(0, 0, 0, 0);
      break;
    case 'week':
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      break;
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'year':
      start = new Date(now.getFullYear(), 0, 1);
      break;
    case 'custom':
      if (customStart && customEnd) {
        return { startDate: customStart, endDate: customEnd };
      }
      start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      break;
    case 'all':
    default:
      return { startDate: '2000-01-01', endDate: toYmd(end) };
  }

  return {
    startDate: toYmd(start),
    endDate: toYmd(end),
  };
}

function subscriptionDate(sub: { created_at?: string | null; start_date?: string | null }): string {
  return (sub.created_at || sub.start_date || '').slice(0, 10);
}

export function filterSubscriptionsByRange<T extends { created_at?: string | null; start_date?: string | null }>(
  subs: T[],
  range: DateRange,
): T[] {
  if (range.startDate === '2000-01-01') return subs;
  return subs.filter(s => {
    const d = subscriptionDate(s);
    if (!d) return false;
    return d >= range.startDate && d <= range.endDate;
  });
}

function normalizeName(name: string): string {
  return normalizeNameKey(name);
}

const PAGE_SIZE = 1000;

export interface PlayerRegistrationRow {
  id: string;
  phone_number: string | null;
  created_at: string;
  tournament_id: string;
}

/** All player registrations for dashboard/charts (paginated; includes super_team_players). */
export async function fetchOrganizerPlayerRegistrations(
  tournaments: Array<{ id: string; format: string }>,
): Promise<PlayerRegistrationRow[]> {
  const all: PlayerRegistrationRow[] = [];
  const regularIds = tournaments.filter(t => t.format !== 'super_teams').map(t => t.id);

  for (let i = 0; i < regularIds.length; i += 50) {
    const batchIds = regularIds.slice(i, i + 50);
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('players')
        .select('id, phone_number, created_at, tournament_id')
        .in('tournament_id', batchIds)
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        console.error('[organizerMetrics] player registrations fetch:', error);
        break;
      }
      if (!data?.length) break;
      all.push(...(data as PlayerRegistrationRow[]));
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  const superTeamTournamentIds = tournaments.filter(t => t.format === 'super_teams').map(t => t.id);
  if (superTeamTournamentIds.length > 0) {
    const { data: superTeams, error: stError } = await supabase
      .from('super_teams')
      .select('id, tournament_id')
      .in('tournament_id', superTeamTournamentIds);
    if (stError) {
      console.error('[organizerMetrics] super_teams fetch:', stError);
      return all;
    }

    const teamToTournament = new Map((superTeams || []).map(st => [st.id, st.tournament_id]));
    const superTeamIds = [...teamToTournament.keys()];

    for (let i = 0; i < superTeamIds.length; i += 50) {
      const batch = superTeamIds.slice(i, i + 50);
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('super_team_players')
          .select('id, phone_number, created_at, super_team_id')
          .in('super_team_id', batch)
          .range(from, from + PAGE_SIZE - 1);
        if (error) {
          console.error('[organizerMetrics] super_team_players fetch:', error);
          break;
        }
        if (!data?.length) break;
        for (const row of data) {
          const tournamentId = teamToTournament.get(row.super_team_id);
          if (!tournamentId) continue;
          all.push({
            id: row.id,
            phone_number: row.phone_number,
            created_at: row.created_at,
            tournament_id: tournamentId,
          });
        }
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
    }
  }

  return all;
}

async function fetchPlayersForTournaments(tournamentIds: string[]) {
  if (!tournamentIds.length) return [];
  const all: Array<{
    id: string;
    tournament_id: string;
    name: string | null;
    phone_number: string | null;
    category_id: string | null;
    payment_status: string | null;
  }> = [];

  // Batch by tournament id to avoid PostgREST IN + 1000-row truncation
  for (let i = 0; i < tournamentIds.length; i += 50) {
    const batchIds = tournamentIds.slice(i, i + 50);
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('players')
        .select('id, tournament_id, name, phone_number, category_id, payment_status')
        .in('tournament_id', batchIds)
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        console.error('[organizerMetrics] players fetch:', error);
        break;
      }
      if (!data?.length) break;
      all.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  return all;
}

async function fetchTeamLinkedPlayerIds(tournamentIds: string[]): Promise<Set<string>> {
  const linked = new Set<string>();
  if (!tournamentIds.length) return linked;

  for (let i = 0; i < tournamentIds.length; i += 50) {
    const batchIds = tournamentIds.slice(i, i + 50);
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('teams')
        .select('player1_id, player2_id')
        .in('tournament_id', batchIds)
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        console.error('[organizerMetrics] teams fetch:', error);
        break;
      }
      if (!data?.length) break;
      for (const team of data) {
        if (team.player1_id) linked.add(team.player1_id);
        if (team.player2_id) linked.add(team.player2_id);
      }
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  return linked;
}

async function fetchRegistrationCounts(
  tournaments: Array<{ id: string; format: string; round_robin_type?: string | null }>,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await Promise.all(
    tournaments.map(async (t) => {
      if (t.format === 'super_teams') {
        const { data: superTeams } = await supabase
          .from('super_teams')
          .select('id')
          .eq('tournament_id', t.id);
        if (!superTeams?.length) {
          counts.set(t.id, 0);
          return;
        }
        const { count } = await supabase
          .from('super_team_players')
          .select('id', { count: 'exact', head: true })
          .in('super_team_id', superTeams.map(st => st.id));
        counts.set(t.id, count ?? 0);
        return;
      }

      if (isIndividualTournament(t)) {
        const { count } = await supabase
          .from('players')
          .select('id', { count: 'exact', head: true })
          .eq('tournament_id', t.id);
        counts.set(t.id, count ?? 0);
        return;
      }

      // Equipas: só jogadores ainda ligados a uma equipa (evita órfãos após deletes)
      const { data: teams } = await supabase
        .from('teams')
        .select('player1_id, player2_id')
        .eq('tournament_id', t.id);
      const ids = new Set<string>();
      (teams || []).forEach(team => {
        if (team.player1_id) ids.add(team.player1_id);
        if (team.player2_id) ids.add(team.player2_id);
      });
      counts.set(t.id, ids.size);
    }),
  );
  return counts;
}

function buildMemberLookup(
  members: Array<{
    member_phone: string | null;
    member_name?: string | null;
    plan?: { name?: string; tournament_discount_percent?: number } | null;
  }>,
): Map<string, MemberPriceInfo> {
  const map = new Map<string, MemberPriceInfo>();
  members.forEach(m => {
    const planName = m.plan?.name || null;
    const isStaff = !!(planName && planName.toLowerCase().includes('staff'));
    const info: MemberPriceInfo = {
      isMember: true,
      isStaff,
      planName,
      discountPercent: Number(m.plan?.tournament_discount_percent) || 0,
    };
    const phone = normalizePhoneKey(m.member_phone);
    const name = normalizeNameKey(m.member_name);
    if (phone) map.set(phone, info);
    if (name) map.set(name, info);
  });
  return map;
}

export async function loadOrganizerTournamentMetrics(
  organizerId: string,
  range: DateRange,
): Promise<TournamentMetric[]> {
  let query = supabase
    .from('tournaments')
    .select('id, name, start_date, registration_fee, member_price, non_member_price, format, round_robin_type')
    .eq('user_id', organizerId)
    .order('start_date', { ascending: false });

  if (range.startDate !== '2000-01-01') {
    query = query.gte('start_date', range.startDate).lte('start_date', range.endDate);
  }

  const { data: tournaments } = await query;
  if (!tournaments?.length) return [];

  const tournamentIds = tournaments.map(t => t.id);
  const teamFormatIds = tournaments
    .filter(t => t.format !== 'super_teams' && !isIndividualTournament(t))
    .map(t => t.id);

  const [allPlayersRaw, categoriesResult, membersResult, registrationCounts, linkedPlayerIds] =
    await Promise.all([
      fetchPlayersForTournaments(tournamentIds),
      supabase
        .from('tournament_categories')
        .select('id, tournament_id, registration_fee, member_price, non_member_price')
        .in('tournament_id', tournamentIds),
      supabase
        .from('member_subscriptions')
        .select('member_phone, member_name, plan:membership_plans(name, tournament_discount_percent)')
        .eq('club_owner_id', organizerId)
        .eq('status', 'active')
        .gte('end_date', new Date().toISOString().split('T')[0]),
      fetchRegistrationCounts(tournaments),
      fetchTeamLinkedPlayerIds(teamFormatIds),
    ]);

  const allPlayers = allPlayersRaw.filter(p => {
    if (!teamFormatIds.includes(p.tournament_id)) return true;
    return linkedPlayerIds.has(p.id);
  });

  const allCategories = categoriesResult.data || [];
  const memberLookup = buildMemberLookup((membersResult.data || []) as any[]);

  const sortedTournaments = [...tournaments].sort(
    (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime(),
  );
  const seenPlayerNames = new Set<string>();
  const metricsMap = new Map<string, TournamentMetric>();

  for (const t of sortedTournaments) {
    const tournamentPlayers = allPlayers.filter(p => p.tournament_id === t.id);
    let newPlayers = 0;
    let memberRegistrations = 0;
    const countedKeys = new Set<string>();

    for (const p of tournamentPlayers) {
      const normalName = p.name ? normalizeName(p.name) : '';
      if (normalName && !seenPlayerNames.has(normalName)) newPlayers++;

      const phoneKey = normalizePhoneKey(p.phone_number);
      const nameKey = normalizeNameKey(p.name);
      const member = (phoneKey && memberLookup.get(phoneKey)) || (nameKey && memberLookup.get(nameKey));
      const dedupeKey = phoneKey || nameKey;
      if (dedupeKey && !countedKeys.has(dedupeKey)) {
        countedKeys.add(dedupeKey);
        if (member?.isMember && !member.isStaff) memberRegistrations++;
      }
    }

    for (const p of tournamentPlayers) {
      const normalName = p.name ? normalizeName(p.name) : '';
      if (normalName) seenPlayerNames.add(normalName);
    }

    const tournamentCategories = allCategories.filter(c => c.tournament_id === t.id);
    const paidPlayers = tournamentPlayers.filter(p => p.payment_status === 'paid');

    let revenue = 0;
    for (const p of paidPlayers) {
      const cat = tournamentCategories.find(c => c.id === p.category_id);
      const phoneKey = normalizePhoneKey(p.phone_number);
      const nameKey = normalizeNameKey(p.name);
      const member = (phoneKey && memberLookup.get(phoneKey)) || (nameKey && memberLookup.get(nameKey)) || {
        isMember: false,
        isStaff: false,
        planName: null,
        discountPercent: 0,
      };
      const { amount } = computeTournamentPlayerPrice(
        {
          registrationFee: Number(t.registration_fee) || 0,
          memberPrice: Number(t.member_price) || 0,
          nonMemberPrice: Number(t.non_member_price) || 0,
          categoryRegistrationFee: Number(cat?.registration_fee) || 0,
          categoryMemberPrice: Number(cat?.member_price) || 0,
          categoryNonMemberPrice: Number(cat?.non_member_price) || 0,
        },
        member,
      );
      revenue += amount;
    }

    metricsMap.set(t.id, {
      tournamentId: t.id,
      tournamentName: t.name,
      startDate: t.start_date,
      registrations: registrationCounts.get(t.id) ?? tournamentPlayers.length,
      newPlayers,
      memberRegistrations,
      revenue,
      paidCount: paidPlayers.length,
    });
  }

  return tournaments.map(t => metricsMap.get(t.id)!);
}

export async function loadOrganizerMembershipMetrics(
  organizerId: string,
  range: DateRange,
): Promise<MembershipMetric> {
  const { data: allSubs } = await supabase
    .from('member_subscriptions')
    .select('id, amount_paid, status, created_at, start_date, plan:membership_plans(name)')
    .eq('club_owner_id', organizerId);

  const subs = filterSubscriptionsByRange(allSubs || [], range);

  if (!subs.length) {
    return { totalMembers: 0, activeMembers: 0, totalRevenue: 0, plans: [] };
  }

  const active = subs.filter(s => s.status === 'active');
  const totalRevenue = subs.reduce((sum, s) => sum + (Number(s.amount_paid) || 0), 0);
  const planMap = new Map<string, { count: number; revenue: number }>();

  subs.forEach(s => {
    const plan = s.plan as { name?: string } | null;
    const name = plan?.name || 'Sem plano';
    const entry = planMap.get(name) || { count: 0, revenue: 0 };
    entry.count++;
    entry.revenue += Number(s.amount_paid) || 0;
    planMap.set(name, entry);
  });

  return {
    totalMembers: subs.length,
    activeMembers: active.length,
    totalRevenue,
    plans: Array.from(planMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue),
  };
}

/**
 * Receita do período alinhada com o toggle de pagamento no torneio:
 * torneios = soma das métricas por payment_status='paid' (mesma fonte da tabela).
 * memberships = amount_paid das subscrições no intervalo.
 */
export async function loadOrganizerPeriodRevenue(
  organizerId: string,
  range: DateRange,
): Promise<{ tournamentRevenue: number; membershipRevenue: number; total: number }> {
  const [tournamentMetrics, membershipMetrics] = await Promise.all([
    loadOrganizerTournamentMetrics(organizerId, range),
    loadOrganizerMembershipMetrics(organizerId, range),
  ]);

  const tournamentRevenue = tournamentMetrics.reduce((sum, m) => sum + (m.revenue || 0), 0);
  const membershipRevenue = membershipMetrics.totalRevenue;
  return {
    tournamentRevenue,
    membershipRevenue,
    total: tournamentRevenue + membershipRevenue,
  };
}

export async function loadOrganizerPlayerSpending(
  organizerId: string,
  range: DateRange,
): Promise<PlayerSpending[]> {
  const { data: memberSubsRaw } = await supabase
    .from('member_subscriptions')
    .select('member_name, member_phone, amount_paid, created_at, start_date')
    .eq('club_owner_id', organizerId);

  const memberSubs = filterSubscriptionsByRange(memberSubsRaw || [], range);

  const memberPhoneSet = new Set(
    (memberSubs || []).map(m => normalizePhoneKey(m.member_phone)).filter(Boolean),
  );
  const memberNameKeys = new Set(
    (memberSubs || []).map(m => normalizeNameKey(m.member_name)).filter(Boolean),
  );

  const playerMap = new Map<string, PlayerSpending>();

  const addSpending = (
    name: string,
    phone: string | null,
    tournamentAmount: number,
    membershipAmount: number,
  ) => {
    const phoneKey = normalizePhoneKey(phone);
    const key = phoneKey || normalizeName(name);
    if (!key) return;
    const isMember = (phoneKey && memberPhoneSet.has(phoneKey)) || memberNameKeys.has(normalizeName(name));
    const existing = playerMap.get(key);
    if (existing) {
      existing.tournamentSpent += tournamentAmount;
      existing.membershipSpent += membershipAmount;
      existing.totalSpent += tournamentAmount + membershipAmount;
      if (tournamentAmount > 0) existing.tournamentCount += 1;
    } else {
      playerMap.set(key, {
        playerName: name.trim(),
        playerPhone: phone,
        tournamentSpent: tournamentAmount,
        membershipSpent: membershipAmount,
        totalSpent: tournamentAmount + membershipAmount,
        isMember,
        tournamentCount: tournamentAmount > 0 ? 1 : 0,
      });
    }
  };

  let txQuery = supabase
    .from('player_transactions')
    .select('player_name, player_phone, amount, transaction_date, reference_type, transaction_type')
    .eq('club_owner_id', organizerId)
    .order('transaction_date', { ascending: false });

  if (range.startDate !== '2000-01-01') {
    txQuery = txQuery.gte('transaction_date', range.startDate).lte('transaction_date', range.endDate);
  }

  const { data: transactions } = await txQuery;
  const hasTournamentTx = (transactions || []).some(
    tx => tx.transaction_type === 'tournament' || tx.reference_type === 'tournament',
  );

  (transactions || []).forEach(tx => {
    const isTournament = tx.transaction_type === 'tournament' || tx.reference_type === 'tournament';
    if (isTournament) {
      addSpending(tx.player_name, tx.player_phone, Number(tx.amount) || 0, 0);
    }
  });

  (memberSubs || []).forEach(sub => {
    if (!sub.member_name) return;
    const paid = Number(sub.amount_paid) || 0;
    if (paid <= 0) return;
    addSpending(sub.member_name, sub.member_phone, 0, paid);
  });

  // Prefer ledger when present; otherwise estimate from currently paid players
  // so spending stays consistent with payment toggles / tournament metrics.
  if (!hasTournamentTx) {
    const metrics = await loadOrganizerTournamentMetrics(organizerId, range);
    if (metrics.some(m => m.revenue > 0)) {
      const tournamentIds = metrics.map(m => m.tournamentId);
      const paidPlayers = (await fetchPlayersForTournaments(tournamentIds)).filter(
        p => p.payment_status === 'paid',
      );

      const { data: categories } = await supabase
        .from('tournament_categories')
        .select('id, tournament_id, registration_fee, member_price, non_member_price')
        .in('tournament_id', tournamentIds);

      const { data: tournaments } = await supabase
        .from('tournaments')
        .select('id, registration_fee, member_price, non_member_price')
        .in('id', tournamentIds);

      const tournMap = new Map((tournaments || []).map(t => [t.id, t]));
      const memberLookup = buildMemberLookup(
        (memberSubs || []).map(m => ({ ...m, plan: null })),
      );

      paidPlayers.forEach(p => {
        if (!p.name) return;
        const cat = (categories || []).find(c => c.id === p.category_id);
        const tourn = tournMap.get(p.tournament_id);
        const phoneKey = normalizePhoneKey(p.phone_number);
        const nameKey = normalizeNameKey(p.name);
        const member = (phoneKey && memberLookup.get(phoneKey)) || (nameKey && memberLookup.get(nameKey)) || {
          isMember: !!(phoneKey && memberPhoneSet.has(phoneKey)),
          isStaff: false,
          planName: null,
          discountPercent: 0,
        };
        const { amount } = computeTournamentPlayerPrice(
          {
            registrationFee: Number(tourn?.registration_fee) || 0,
            memberPrice: Number(tourn?.member_price) || 0,
            nonMemberPrice: Number(tourn?.non_member_price) || 0,
            categoryRegistrationFee: Number(cat?.registration_fee) || 0,
            categoryMemberPrice: Number(cat?.member_price) || 0,
            categoryNonMemberPrice: Number(cat?.non_member_price) || 0,
          },
          member,
        );
        if (amount > 0) addSpending(p.name, p.phone_number, amount, 0);
      });
    }
  }

  return Array.from(playerMap.values()).sort((a, b) => b.totalSpent - a.totalSpent);
}
