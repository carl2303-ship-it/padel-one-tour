import { supabase } from './supabase';

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
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
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
      return { startDate: '2000-01-01', endDate: end.toISOString().split('T')[0] };
  }

  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}

function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function loadOrganizerTournamentMetrics(
  organizerId: string,
  range: DateRange,
): Promise<TournamentMetric[]> {
  let query = supabase
    .from('tournaments')
    .select('id, name, start_date, registration_fee, member_price, non_member_price')
    .eq('user_id', organizerId)
    .order('start_date', { ascending: false });

  if (range.startDate !== '2000-01-01') {
    query = query.gte('start_date', range.startDate).lte('start_date', range.endDate);
  }

  const { data: tournaments } = await query;
  if (!tournaments?.length) return [];

  const tournamentIds = tournaments.map(t => t.id);

  const [playersResult, categoriesResult, membersResult] = await Promise.all([
    supabase.from('players').select('tournament_id, name, phone_number, category_id, payment_status').in('tournament_id', tournamentIds),
    supabase.from('tournament_categories').select('id, tournament_id, registration_fee, member_price, non_member_price').in('tournament_id', tournamentIds),
    supabase.from('member_subscriptions').select('member_phone').eq('club_owner_id', organizerId).eq('status', 'active').gte('end_date', new Date().toISOString().split('T')[0]),
  ]);

  const allPlayers = playersResult.data || [];
  const allCategories = categoriesResult.data || [];
  const memberPhones = new Set((membersResult.data || []).map(m => m.member_phone).filter(Boolean));

  const sortedTournaments = [...tournaments].sort(
    (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime(),
  );
  const seenPlayerNames = new Set<string>();
  const metricsMap = new Map<string, TournamentMetric>();

  for (const t of sortedTournaments) {
    const tournamentPlayers = allPlayers.filter(p => p.tournament_id === t.id);
    let newPlayers = 0;
    let memberRegistrations = 0;
    const countedPhones = new Set<string>();

    for (const p of tournamentPlayers) {
      const normalName = p.name ? normalizeName(p.name) : '';
      if (normalName && !seenPlayerNames.has(normalName)) newPlayers++;

      const phone = p.phone_number;
      if (phone && !countedPhones.has(phone)) {
        countedPhones.add(phone);
        if (memberPhones.has(phone)) memberRegistrations++;
      }
    }

    for (const p of tournamentPlayers) {
      const normalName = p.name ? normalizeName(p.name) : '';
      if (normalName) seenPlayerNames.add(normalName);
    }

    const tournamentCategories = allCategories.filter(c => c.tournament_id === t.id);
    const paidPlayers = tournamentPlayers.filter(p => p.payment_status === 'paid');
    const tournRegFee = Number(t.registration_fee) || 0;
    const tournMemberPrice = Number(t.member_price) || 0;
    const tournNonMemberPrice = Number(t.non_member_price) || 0;

    let revenue = 0;
    for (const p of paidPlayers) {
      const cat = tournamentCategories.find(c => c.id === p.category_id);
      const catRegFee = Number(cat?.registration_fee) || 0;
      const catMemberPrice = Number(cat?.member_price) || 0;
      const catNonMemberPrice = Number(cat?.non_member_price) || 0;
      const isMember = p.phone_number ? memberPhones.has(p.phone_number) : false;

      revenue += isMember
        ? catMemberPrice || tournMemberPrice || catRegFee || tournRegFee
        : catNonMemberPrice || tournNonMemberPrice || catRegFee || tournRegFee;
    }

    metricsMap.set(t.id, {
      tournamentId: t.id,
      tournamentName: t.name,
      startDate: t.start_date,
      registrations: tournamentPlayers.length,
      newPlayers,
      memberRegistrations,
      revenue,
      paidCount: paidPlayers.length,
    });
  }

  return tournaments.map(t => metricsMap.get(t.id)!);
}

export async function loadOrganizerMembershipMetrics(organizerId: string): Promise<MembershipMetric> {
  const { data: subs } = await supabase
    .from('member_subscriptions')
    .select('id, amount_paid, status, plan:membership_plans(name)')
    .eq('club_owner_id', organizerId);

  if (!subs?.length) {
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

export async function loadOrganizerPlayerSpending(
  organizerId: string,
  range: DateRange,
): Promise<PlayerSpending[]> {
  const { data: memberSubs } = await supabase
    .from('member_subscriptions')
    .select('member_name, member_phone, amount_paid')
    .eq('club_owner_id', organizerId);

  const memberPhoneSet = new Set((memberSubs || []).map(m => m.member_phone).filter(Boolean));
  const memberNameKeys = new Set(
    (memberSubs || []).map(m => (m.member_name ? normalizeName(m.member_name) : '')).filter(Boolean),
  );

  const playerMap = new Map<string, PlayerSpending>();

  const addSpending = (
    name: string,
    phone: string | null,
    tournamentAmount: number,
    membershipAmount: number,
  ) => {
    const key = phone || normalizeName(name);
    if (!key) return;
    const isMember = (phone && memberPhoneSet.has(phone)) || memberNameKeys.has(normalizeName(name));
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

  if (!transactions?.length) {
    const metrics = await loadOrganizerTournamentMetrics(organizerId, range);
    if (metrics.some(m => m.revenue > 0)) {
      const tournamentIds = metrics.map(m => m.tournamentId);
      const { data: paidPlayers } = await supabase
        .from('players')
        .select('name, phone_number, tournament_id, category_id, payment_status')
        .in('tournament_id', tournamentIds)
        .eq('payment_status', 'paid');

      const { data: categories } = await supabase
        .from('tournament_categories')
        .select('id, tournament_id, registration_fee, member_price, non_member_price')
        .in('tournament_id', tournamentIds);

      const { data: tournaments } = await supabase
        .from('tournaments')
        .select('id, registration_fee, member_price, non_member_price')
        .in('id', tournamentIds);

      const tournMap = new Map((tournaments || []).map(t => [t.id, t]));

      (paidPlayers || []).forEach(p => {
        if (!p.name) return;
        const cat = (categories || []).find(c => c.id === p.category_id);
        const tourn = tournMap.get(p.tournament_id);
        const isMember = p.phone_number ? memberPhoneSet.has(p.phone_number) : false;
        const catRegFee = Number(cat?.registration_fee) || 0;
        const catMemberPrice = Number(cat?.member_price) || 0;
        const catNonMemberPrice = Number(cat?.non_member_price) || 0;
        const tournRegFee = Number(tourn?.registration_fee) || 0;
        const tournMemberPrice = Number(tourn?.member_price) || 0;
        const tournNonMemberPrice = Number(tourn?.non_member_price) || 0;
        const fee = isMember
          ? catMemberPrice || tournMemberPrice || catRegFee || tournRegFee
          : catNonMemberPrice || tournNonMemberPrice || catRegFee || tournRegFee;
        if (fee > 0) addSpending(p.name, p.phone_number, fee, 0);
      });
    }
  }

  return Array.from(playerMap.values()).sort((a, b) => b.totalSpent - a.totalSpent);
}
