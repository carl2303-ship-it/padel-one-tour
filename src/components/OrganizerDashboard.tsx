import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
  fetchOrganizerPlayerRegistrations,
  filterSubscriptionsByRange,
  getDateRange,
  loadOrganizerPeriodRevenue,
  type PlayerRegistrationRow,
} from '../lib/organizerMetrics';
import { fetchTournamentRegistrationCounts } from '../lib/tournamentRegistrationCounts';
import { useI18n } from '../lib/i18nContext';
import { useAuth } from '../lib/authContext';
import { Trophy, Users, UserPlus, CreditCard, Calendar, AlertTriangle, TrendingUp, ArrowRight, BarChart3 } from 'lucide-react';

interface OrganizerDashboardProps {
  onNavigate: (view: string) => void;
  onOpenTournament?: (tournamentId: string) => void;
}

interface TournamentRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  registration_fee: number | null;
  format: string;
  round_robin_type?: string | null;
}

interface MemberSubscription {
  id: string;
  status: string;
  created_at: string;
  amount_paid: number | null;
  end_date: string;
  start_date: string;
  member_name: string | null;
  member_phone: string | null;
  plan: { name: string } | null;
}

type DateRange = 'week' | 'month' | '3months' | '6months' | 'year' | 'all';

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDateRangeStart(range: DateRange): Date | null {
  const now = new Date();
  switch (range) {
    case 'week': return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    case 'month': return new Date(now.getFullYear(), now.getMonth(), 1);
    case '3months': return new Date(now.getFullYear(), now.getMonth() - 2, 1);
    case '6months': return new Date(now.getFullYear(), now.getMonth() - 5, 1);
    case 'year': return new Date(now.getFullYear(), 0, 1);
    case 'all': return null;
  }
}

function dashboardRangeToMetrics(range: DateRange) {
  if (range === 'week') return getDateRange('week');
  if (range === 'month') return getDateRange('month');
  if (range === 'year') return getDateRange('year');
  if (range === 'all') return getDateRange('all');
  const start = getDateRangeStart(range)!;
  const end = new Date();
  return { startDate: toYmd(start), endDate: toYmd(end) };
}

export default function OrganizerDashboard({ onNavigate, onOpenTournament }: OrganizerDashboardProps) {
  const { t } = useI18n();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [tournaments, setTournaments] = useState<TournamentRow[]>([]);
  const [players, setPlayers] = useState<PlayerRegistrationRow[]>([]);
  const [members, setMembers] = useState<MemberSubscription[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [revenue, setRevenue] = useState(0);
  const [registrationCounts, setRegistrationCounts] = useState<Record<string, number>>({});
  const [revenueLoading, setRevenueLoading] = useState(false);

  const rangeStart = getDateRangeStart(dateRange);
  const metricsRange = useMemo(() => dashboardRangeToMetrics(dateRange), [dateRange]);

  useEffect(() => {
    if (user) fetchDashboardData();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setRevenueLoading(true);
      try {
        const period = await loadOrganizerPeriodRevenue(user.id, metricsRange);
        if (!cancelled) setRevenue(period.total);
      } catch (err) {
        console.error('Error loading period revenue:', err);
      } finally {
        if (!cancelled) setRevenueLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, metricsRange]);

  async function fetchDashboardData() {
    setLoading(true);
    try {
      const { data: tournamentsData } = await supabase
        .from('tournaments')
        .select('id, name, start_date, end_date, status, registration_fee, format, round_robin_type')
        .eq('user_id', user!.id);

      const fetchedTournaments = (tournamentsData || []) as TournamentRow[];
      setTournaments(fetchedTournaments);

      if (fetchedTournaments.length > 0) {
        const [registrations, counts] = await Promise.all([
          fetchOrganizerPlayerRegistrations(fetchedTournaments),
          fetchTournamentRegistrationCounts(fetchedTournaments),
        ]);
        setPlayers(registrations);
        setRegistrationCounts(counts);
      } else {
        setPlayers([]);
        setRegistrationCounts({});
      }

      const { data: membersData } = await supabase
        .from('member_subscriptions')
        .select('id, status, created_at, amount_paid, end_date, start_date, member_name, member_phone, plan:membership_plans(name)')
        .eq('club_owner_id', user!.id);

      setMembers((membersData || []) as MemberSubscription[]);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }

  const filteredTournaments = useMemo(() => {
    if (!rangeStart) return tournaments;
    return tournaments.filter(tr => {
      const start = tr.start_date.slice(0, 10);
      return start >= metricsRange.startDate && start <= metricsRange.endDate;
    });
  }, [tournaments, rangeStart, metricsRange]);

  const filteredPlayers = useMemo(() => {
    if (!rangeStart) return players;
    const filteredTournamentIds = new Set(filteredTournaments.map(tr => tr.id));
    return players.filter(p => filteredTournamentIds.has(p.tournament_id));
  }, [players, filteredTournaments, rangeStart]);

  const stats = useMemo(() => {
    const uniquePhones = new Set(filteredPlayers.map(p => p.phone_number).filter(Boolean));

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const phoneFirstDates = new Map<string, Date>();
    players.forEach(p => {
      if (!p.phone_number) return;
      const created = new Date(p.created_at);
      const existing = phoneFirstDates.get(p.phone_number);
      if (!existing || created < existing) {
        phoneFirstDates.set(p.phone_number, created);
      }
    });

    const effectiveStart = rangeStart || currentMonthStart;
    const newPlayers = Array.from(phoneFirstDates.values()).filter(d => d >= effectiveStart).length;

    const activeMembers = filterSubscriptionsByRange(members, metricsRange)
      .filter(m => m.status === 'active').length;

    return {
      totalTournaments: filteredTournaments.length,
      uniquePlayers: uniquePhones.size,
      newPlayers,
      activeMembers,
      revenue,
    };
  }, [filteredTournaments, filteredPlayers, members, rangeStart, players, metricsRange, revenue]);

  // Alinha com Métricas: jogadores atribuídos ao mês do start_date do torneio (não created_at)
  const chartData = useMemo(() => {
    const numMonths = dateRange === 'week' ? 4 : dateRange === 'month' ? 4 : dateRange === '3months' ? 3 : dateRange === 'year' ? 12 : 6;
    const now = new Date();
    const months: { month: string; count: number }[] = [];
    const tournamentStartById = new Map(
      tournaments.map(tr => [tr.id, tr.start_date.slice(0, 10)]),
    );

    for (let i = numMonths - 1; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthLabel = date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
      const year = date.getFullYear();
      const month = date.getMonth(); // 0-based
      const count = players.filter(p => {
        const start = tournamentStartById.get(p.tournament_id);
        if (!start) return false;
        const [y, m] = start.split('-').map(Number);
        return y === year && m - 1 === month;
      }).length;
      months.push({ month: monthLabel, count });
    }
    return months;
  }, [players, tournaments, dateRange]);

  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);

  const expiringMembers = members.filter(m => {
    if (m.status !== 'active') return false;
    const end = new Date(m.end_date);
    return end >= nextMonth && end <= endOfNextMonth;
  });

  const expiredMembers = members.filter(m => {
    const end = new Date(m.end_date);
    return m.status === 'active' && end < now;
  });

  const todayYmd = toYmd(new Date());
  const upcomingTournaments = tournaments
    .filter(tr => {
      if (tr.status === 'cancelled' || tr.status === 'completed') return false;
      const start = tr.start_date.slice(0, 10);
      const end = (tr.end_date || tr.start_date).slice(0, 10);
      // Hoje, futuros, ou a decorrer
      return start >= todayYmd || (start <= todayYmd && end >= todayYmd);
    })
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .slice(0, 5);

  const maxCount = Math.max(...chartData.map(d => d.count), 1);
  const td = (t as any).organizerDashboard || {};

  const rangeLabels: Record<DateRange, string> = {
    week: td.lastWeek || 'Last 7 days',
    month: td.thisMonth || 'This month',
    '3months': td.last3Months || 'Last 3 months',
    '6months': td.last6Months || 'Last 6 months',
    year: td.thisYear || 'This year',
    all: td.allTime || 'All time',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{td.title || 'Dashboard'}</h1>
        <div className="flex items-center gap-3">
          <select
            value={dateRange}
            onChange={e => setDateRange(e.target.value as DateRange)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {(Object.keys(rangeLabels) as DateRange[]).map(key => (
              <option key={key} value={key}>{rangeLabels[key]}</option>
            ))}
          </select>
          <button
            onClick={() => onNavigate('list')}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <Trophy className="w-4 h-4" />
            {t.nav?.tournaments || 'Tournaments'}
          </button>
          <button
            onClick={() => onNavigate('metrics')}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
          >
            <BarChart3 className="w-4 h-4" />
            Métricas
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          icon={<Trophy className="w-5 h-5 text-blue-600" />}
          label={td.totalTournaments || 'Tournaments'}
          value={stats.totalTournaments}
          bgColor="bg-blue-50"
        />
        <StatCard
          icon={<Users className="w-5 h-5 text-indigo-600" />}
          label={td.uniquePlayers || 'Unique Players'}
          value={stats.uniquePlayers}
          bgColor="bg-indigo-50"
        />
        <StatCard
          icon={<UserPlus className="w-5 h-5 text-emerald-600" />}
          label={td.newPlayersMonth || 'New Players'}
          value={stats.newPlayers}
          bgColor="bg-emerald-50"
        />
        <StatCard
          icon={<CreditCard className="w-5 h-5 text-purple-600" />}
          label={td.activeMembers || 'Active Members'}
          value={stats.activeMembers}
          bgColor="bg-purple-50"
          onClick={() => onNavigate('members')}
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5 text-emerald-600" />}
          label={td.periodRevenue || 'Receita do Período'}
          value={revenueLoading ? '…' : `${stats.revenue.toFixed(0)}€`}
          bgColor="bg-emerald-50"
          onClick={() => onNavigate('metrics')}
        />
      </div>

      {(expiringMembers.length > 0 || expiredMembers.length > 0) && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            {td.memberAlerts || 'Membership Alerts'}
          </h2>
          <div className="space-y-3">
            {expiredMembers.length > 0 && (
              <div
                className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-100 cursor-pointer hover:bg-red-100 transition-colors"
                onClick={() => onNavigate('members')}
              >
                <div>
                  <p className="text-sm font-medium text-red-800">{td.alreadyExpired || 'Already expired'}</p>
                  <p className="text-xs text-red-600">{expiredMembers.length} membros</p>
                </div>
                <ArrowRight className="w-4 h-4 text-red-600" />
              </div>
            )}
            {expiringMembers.length > 0 && (
              <div
                className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-100 cursor-pointer hover:bg-amber-100 transition-colors"
                onClick={() => onNavigate('members')}
              >
                <div>
                  <p className="text-sm font-medium text-amber-800">{td.expiringNextMonth || 'Expiring next month'}</p>
                  <p className="text-xs text-amber-600">{expiringMembers.length} membros</p>
                </div>
                <ArrowRight className="w-4 h-4 text-amber-600" />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600" />
              {td.upcomingTournaments || 'Upcoming Tournaments'}
            </h2>
            <button
              onClick={() => onNavigate('list')}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              {td.viewAll || 'View All'}
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {upcomingTournaments.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">{td.noUpcoming || 'No upcoming tournaments'}</p>
          ) : (
            <div className="space-y-3">
              {upcomingTournaments.map(tournament => {
                const enrolled = registrationCounts[tournament.id] || 0;
                return (
                  <button
                    key={tournament.id}
                    type="button"
                    onClick={() => onOpenTournament?.(tournament.id)}
                    className="w-full flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-blue-700 hover:underline truncate">
                        {tournament.name}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {tournament.start_date.slice(0, 10).split('-').reverse().join('/')}
                        {' · '}
                        {enrolled} {enrolled === 1 ? (td.entrySingular || 'inscrito') : (td.entriesEnrolled || 'inscritos')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-1 rounded-full">
                        <Users className="w-3 h-3" />
                        {enrolled}
                      </span>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        tournament.status === 'active' ? 'bg-emerald-100 text-emerald-700'
                        : tournament.status === 'completed' ? 'bg-gray-100 text-gray-700'
                        : 'bg-blue-100 text-blue-700'
                      }`}>
                        {tournament.status}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            {td.playerEvolution || 'Player Evolution'}
          </h2>
          {chartData.every(d => d.count === 0) ? (
            <p className="text-sm text-gray-500 py-8 text-center">{td.noData || 'No data available'}</p>
          ) : (
            <div className="flex items-end gap-2 h-48">
              {chartData.map((data, index) => (
                <div key={index} className="flex-1 flex flex-col items-center justify-end h-full">
                  <span className="text-xs font-semibold text-gray-700 mb-1">{data.count}</span>
                  <div
                    className="w-full bg-blue-500 rounded-t-md transition-all duration-500 min-h-[4px]"
                    style={{ height: `${(data.count / maxCount) * 85}%` }}
                  />
                  <span className="text-[10px] text-gray-500 mt-2 truncate w-full text-center">{data.month}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  bgColor,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  bgColor: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={`bg-white rounded-xl shadow-sm border border-gray-100 p-4 ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${bgColor}`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-xs text-gray-500 font-medium truncate">{label}</p>
          <p className="text-xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}
