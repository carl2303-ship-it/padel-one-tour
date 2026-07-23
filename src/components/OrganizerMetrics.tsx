import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../lib/authContext';
import {
  type DateFilter,
  type MembershipMetric,
  type PlayerSpending,
  type TournamentMetric,
  type DateRange,
  getDateRange,
  loadOrganizerMembershipMetrics,
  loadOrganizerPeriodRevenue,
  loadOrganizerPlayerSpending,
  loadOrganizerTournamentMetrics,
} from '../lib/organizerMetrics';
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Trophy,
  Users,
} from 'lucide-react';

type Tab = 'overview' | 'spending';

interface OrganizerMetricsProps {
  onOpenTournament?: (tournamentId: string) => void;
}

export default function OrganizerMetrics({ onOpenTournament }: OrganizerMetricsProps) {
  const { user } = useAuth();
  const [hasLoaded, setHasLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>('year');
  const [customDraftStart, setCustomDraftStart] = useState('');
  const [customDraftEnd, setCustomDraftEnd] = useState('');
  const [appliedCustomStart, setAppliedCustomStart] = useState('');
  const [appliedCustomEnd, setAppliedCustomEnd] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [expandedTournaments, setExpandedTournaments] = useState(true);
  const [expandedMemberships, setExpandedMemberships] = useState(true);
  const [spendingFilter, setSpendingFilter] = useState<'all' | 'members' | 'non-members'>('all');

  const [tournamentMetrics, setTournamentMetrics] = useState<TournamentMetric[]>([]);
  const [membershipMetrics, setMembershipMetrics] = useState<MembershipMetric>({
    totalMembers: 0,
    activeMembers: 0,
    totalRevenue: 0,
    plans: [],
  });
  const [playerSpending, setPlayerSpending] = useState<PlayerSpending[]>([]);
  const [periodTournamentRevenue, setPeriodTournamentRevenue] = useState(0);

  const range = useMemo((): DateRange | null => {
    if (dateFilter === 'custom') {
      if (!appliedCustomStart || !appliedCustomEnd) return null;
      return getDateRange('custom', appliedCustomStart, appliedCustomEnd);
    }
    return getDateRange(dateFilter);
  }, [dateFilter, appliedCustomStart, appliedCustomEnd]);

  const loadData = useCallback(async (activeRange: DateRange) => {
    if (!user?.id) return;
    setRefreshing(true);
    try {
      const [tournaments, memberships, spending, periodRevenue] = await Promise.all([
        loadOrganizerTournamentMetrics(user.id, activeRange),
        loadOrganizerMembershipMetrics(user.id, activeRange),
        loadOrganizerPlayerSpending(user.id, activeRange),
        loadOrganizerPeriodRevenue(user.id, activeRange),
      ]);
      setTournamentMetrics(tournaments);
      setMembershipMetrics(memberships);
      setPlayerSpending(spending);
      setPeriodTournamentRevenue(periodRevenue.tournamentRevenue);
      setHasLoaded(true);
    } catch (err) {
      console.error('[OrganizerMetrics] load:', err);
    } finally {
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!range) return;
    void loadData(range);
  }, [range, loadData]);

  const applyCustomRange = () => {
    if (!customDraftStart || !customDraftEnd) return;
    if (customDraftStart > customDraftEnd) return;
    setAppliedCustomStart(customDraftStart);
    setAppliedCustomEnd(customDraftEnd);
  };

  const handleDateFilterChange = (value: DateFilter) => {
    setDateFilter(value);
    if (value !== 'custom') {
      setAppliedCustomStart('');
      setAppliedCustomEnd('');
    }
  };

  const summary = useMemo(() => {
    const tournamentsRevenue = periodTournamentRevenue;
    const registrations = tournamentMetrics.reduce((sum, t) => sum + t.registrations, 0);
    const newPlayers = tournamentMetrics.reduce((sum, t) => sum + t.newPlayers, 0);
    return {
      tournamentsRevenue,
      membershipsRevenue: membershipMetrics.totalRevenue,
      totalRevenue: tournamentsRevenue + membershipMetrics.totalRevenue,
      registrations,
      newPlayers,
      tournamentCount: tournamentMetrics.length,
    };
  }, [tournamentMetrics, membershipMetrics, periodTournamentRevenue]);

  const filteredSpending = useMemo(() => {
    if (spendingFilter === 'members') return playerSpending.filter(p => p.isMember);
    if (spendingFilter === 'non-members') return playerSpending.filter(p => !p.isMember);
    return playerSpending;
  }, [playerSpending, spendingFilter]);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });

  if (!hasLoaded && refreshing) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const customRangeInvalid = customDraftStart && customDraftEnd && customDraftStart > customDraftEnd;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-blue-600" />
            Métricas
            {refreshing && (
              <span className="inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            )}
          </h1>
          <p className="text-sm text-gray-500 mt-1">Torneios, memberships e receita do organizador</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={dateFilter}
            onChange={e => handleDateFilterChange(e.target.value as DateFilter)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            <option value="today">Hoje</option>
            <option value="week">Última semana</option>
            <option value="month">Este mês</option>
            <option value="year">Este ano</option>
            <option value="all">Tudo</option>
            <option value="custom">Personalizado</option>
          </select>
          {dateFilter === 'custom' && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={customDraftStart}
                onChange={e => setCustomDraftStart(e.target.value)}
                className="px-2 py-2 border rounded-lg text-sm"
              />
              <span className="text-gray-400 text-sm">até</span>
              <input
                type="date"
                value={customDraftEnd}
                onChange={e => setCustomDraftEnd(e.target.value)}
                className="px-2 py-2 border rounded-lg text-sm"
              />
              <button
                type="button"
                onClick={applyCustomRange}
                disabled={!customDraftStart || !customDraftEnd || !!customRangeInvalid}
                className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Aplicar
              </button>
            </div>
          )}
        </div>
      </div>

      {dateFilter === 'custom' && !range && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          Seleccione a data inicial e final e clique em Aplicar para ver as métricas do período.
        </p>
      )}

      {customRangeInvalid && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          A data inicial não pode ser posterior à data final.
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="Receita total" value={`${summary.totalRevenue.toFixed(0)}€`} icon={<CreditCard className="w-5 h-5 text-emerald-600" />} bg="bg-emerald-50" />
        <SummaryCard label="Torneios" value={String(summary.tournamentCount)} icon={<Trophy className="w-5 h-5 text-blue-600" />} bg="bg-blue-50" />
        <SummaryCard label="Jogadores inscritos" value={String(summary.registrations)} icon={<Users className="w-5 h-5 text-indigo-600" />} bg="bg-indigo-50" />
        <SummaryCard label="Membros activos" value={String(membershipMetrics.activeMembers)} icon={<Users className="w-5 h-5 text-purple-600" />} bg="bg-purple-50" />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
          <div className="p-3 rounded-lg bg-blue-50">
            <p className="text-xs text-blue-700">Receita torneios</p>
            <p className="text-xl font-bold text-blue-900">{summary.tournamentsRevenue.toFixed(0)}€</p>
          </div>
          <div className="p-3 rounded-lg bg-purple-50">
            <p className="text-xs text-purple-700">Receita memberships</p>
            <p className="text-xl font-bold text-purple-900">{summary.membershipsRevenue.toFixed(0)}€</p>
          </div>
          <div className="p-3 rounded-lg bg-emerald-50">
            <p className="text-xs text-emerald-700">Novos jogadores</p>
            <p className="text-xl font-bold text-emerald-900">{summary.newPlayers}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>Visão geral</TabButton>
        <TabButton active={activeTab === 'spending'} onClick={() => setActiveTab('spending')}>Gastos por jogador</TabButton>
      </div>

      {activeTab === 'overview' ? (
        <div className="space-y-4">
          <Section
            title="Torneios"
            expanded={expandedTournaments}
            onToggle={() => setExpandedTournaments(v => !v)}
          >
            {tournamentMetrics.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">Sem torneios no período seleccionado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-3">Torneio</th>
                      <th className="py-2 pr-3">Data</th>
                      <th className="py-2 pr-3 text-right">Jogadores</th>
                      <th className="py-2 pr-3 text-right">Novos</th>
                      <th className="py-2 pr-3 text-right">Membros</th>
                      <th className="py-2 pr-3 text-right">Pagos</th>
                      <th className="py-2 text-right">Receita</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tournamentMetrics.map(t => (
                      <tr key={t.tournamentId} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2.5 pr-3 font-medium text-gray-900">
                          {onOpenTournament ? (
                            <button
                              type="button"
                              onClick={() => onOpenTournament(t.tournamentId)}
                              className="text-left text-blue-600 hover:text-blue-800 hover:underline font-medium"
                            >
                              {t.tournamentName}
                            </button>
                          ) : (
                            t.tournamentName
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-gray-600">{formatDate(t.startDate)}</td>
                        <td className="py-2.5 pr-3 text-right">{t.registrations}</td>
                        <td className="py-2.5 pr-3 text-right">{t.newPlayers}</td>
                        <td className="py-2.5 pr-3 text-right">{t.memberRegistrations}</td>
                        <td className="py-2.5 pr-3 text-right">{t.paidCount}</td>
                        <td className="py-2.5 text-right font-semibold">{t.revenue.toFixed(0)}€</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section
            title="Memberships"
            expanded={expandedMemberships}
            onToggle={() => setExpandedMemberships(v => !v)}
          >
            <div className="grid grid-cols-3 gap-3 mb-4">
              <MiniStat label="Novos no período" value={membershipMetrics.totalMembers} />
              <MiniStat label="Activos (período)" value={membershipMetrics.activeMembers} />
              <MiniStat label="Receita (período)" value={`${membershipMetrics.totalRevenue.toFixed(0)}€`} />
            </div>
            {membershipMetrics.plans.length === 0 ? (
              <p className="text-sm text-gray-500">Sem planos de membership.</p>
            ) : (
              <div className="space-y-2">
                {membershipMetrics.plans.map(plan => (
                  <div key={plan.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">{plan.name}</p>
                      <p className="text-xs text-gray-500">{plan.count} {plan.count === 1 ? 'membership' : 'memberships'}</p>
                    </div>
                    <p className="font-semibold text-gray-900">{plan.revenue.toFixed(0)}€</p>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
          <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-600">Filtrar:</span>
            {(['all', 'members', 'non-members'] as const).map(key => (
              <button
                key={key}
                type="button"
                onClick={() => setSpendingFilter(key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                  spendingFilter === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {key === 'all' ? 'Todos' : key === 'members' ? 'Membros' : 'Não-membros'}
              </button>
            ))}
          </div>
          {filteredSpending.length === 0 ? (
            <p className="text-sm text-gray-500 p-8 text-center">Sem dados de gastos no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-3 px-4">Jogador</th>
                    <th className="py-3 px-4 text-right">Torneios</th>
                    <th className="py-3 px-4 text-right">Membership</th>
                    <th className="py-3 px-4 text-right">Total</th>
                    <th className="py-3 px-4">Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSpending.slice(0, 100).map(row => (
                    <tr key={`${row.playerName}-${row.playerPhone}`} className="border-b border-gray-50">
                      <td className="py-2.5 px-4">
                        <p className="font-medium text-gray-900">{row.playerName}</p>
                        {row.playerPhone && <p className="text-xs text-gray-500">{row.playerPhone}</p>}
                      </td>
                      <td className="py-2.5 px-4 text-right">{row.tournamentSpent.toFixed(0)}€</td>
                      <td className="py-2.5 px-4 text-right">{row.membershipSpent.toFixed(0)}€</td>
                      <td className="py-2.5 px-4 text-right font-semibold">{row.totalSpent.toFixed(0)}€</td>
                      <td className="py-2.5 px-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${row.isMember ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-700'}`}>
                          {row.isMember ? 'Membro' : 'Jogador'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon, bg }: { label: string; value: string; icon: ReactNode; bg: string }) {
  return (
    <div className={`rounded-xl p-4 ${bg}`}>
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs font-medium text-gray-600">{label}</span></div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-3 bg-gray-50 rounded-lg text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold text-gray-900">{value}</p>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
        active ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  );
}

function Section({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50"
      >
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {expanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
      </button>
      {expanded && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
