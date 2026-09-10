import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchTournamentRegistrationCounts } from '../lib/tournamentRegistrationCounts';
import { useI18n } from '../lib/i18nContext';
import { useAuth } from '../lib/authContext';
import { Trophy, Users, Calendar, ArrowRight, BarChart3, AlertTriangle } from 'lucide-react';

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
  format: string;
  round_robin_type?: string | null;
}

interface MemberAlertRow {
  id: string;
  status: string;
  end_date: string;
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function OrganizerDashboard({ onNavigate, onOpenTournament }: OrganizerDashboardProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const td = (t as any).organizerDashboard || {};

  const [loading, setLoading] = useState(true);
  const [tournaments, setTournaments] = useState<TournamentRow[]>([]);
  const [registrationCounts, setRegistrationCounts] = useState<Record<string, number>>({});
  const [expiringCount, setExpiringCount] = useState(0);
  const [expiredCount, setExpiredCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const today = toYmd(new Date());
        const [{ data: tournamentsData }, { data: membersData }] = await Promise.all([
          supabase
            .from('tournaments')
            .select('id, name, start_date, end_date, status, format, round_robin_type')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .order('start_date', { ascending: true }),
          supabase
            .from('member_subscriptions')
            .select('id, status, end_date')
            .eq('club_owner_id', user.id)
            .eq('status', 'active'),
        ]);

        if (cancelled) return;

        // Prefer currently running / upcoming actives first
        const activeTournaments = ((tournamentsData || []) as TournamentRow[]).sort((a, b) => {
          const aEnd = (a.end_date || a.start_date).slice(0, 10);
          const bEnd = (b.end_date || b.start_date).slice(0, 10);
          const aOngoing = a.start_date.slice(0, 10) <= today && aEnd >= today ? 0 : 1;
          const bOngoing = b.start_date.slice(0, 10) <= today && bEnd >= today ? 0 : 1;
          if (aOngoing !== bOngoing) return aOngoing - bOngoing;
          return a.start_date.localeCompare(b.start_date);
        });
        setTournaments(activeTournaments);

        if (activeTournaments.length > 0) {
          const counts = await fetchTournamentRegistrationCounts(activeTournaments);
          if (!cancelled) setRegistrationCounts(counts);
        } else {
          setRegistrationCounts({});
        }

        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
        const members = (membersData || []) as MemberAlertRow[];
        setExpiredCount(
          members.filter((m) => new Date(m.end_date) < now).length,
        );
        setExpiringCount(
          members.filter((m) => {
            const end = new Date(m.end_date);
            return end >= nextMonth && end <= endOfNextMonth;
          }).length,
        );
      } catch (err) {
        console.error('Error loading dashboard:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

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

      {(expiringCount > 0 || expiredCount > 0) && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            {td.memberAlerts || 'Membership Alerts'}
          </h2>
          <div className="space-y-3">
            {expiredCount > 0 && (
              <button
                type="button"
                className="w-full flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-100 hover:bg-red-100 transition-colors text-left"
                onClick={() => onNavigate('members')}
              >
                <div>
                  <p className="text-sm font-medium text-red-800">{td.alreadyExpired || 'Already expired'}</p>
                  <p className="text-xs text-red-600">{expiredCount} membros</p>
                </div>
                <ArrowRight className="w-4 h-4 text-red-600" />
              </button>
            )}
            {expiringCount > 0 && (
              <button
                type="button"
                className="w-full flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-100 hover:bg-amber-100 transition-colors text-left"
                onClick={() => onNavigate('members')}
              >
                <div>
                  <p className="text-sm font-medium text-amber-800">{td.expiringNextMonth || 'Expiring next month'}</p>
                  <p className="text-xs text-amber-600">{expiringCount} membros</p>
                </div>
                <ArrowRight className="w-4 h-4 text-amber-600" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-600" />
            {td.activeTournaments || 'Torneios ativos'}
          </h2>
          <button
            onClick={() => onNavigate('list')}
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            {td.viewAll || 'Ver todos'}
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        {tournaments.length === 0 ? (
          <p className="text-sm text-gray-500 py-8 text-center">
            {td.noActiveTournaments || 'Nenhum torneio ativo'}
          </p>
        ) : (
          <div className="space-y-3">
            {tournaments.map((tournament) => {
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
                      {enrolled}{' '}
                      {enrolled === 1
                        ? td.entrySingular || 'inscrito'
                        : td.entriesEnrolled || 'inscritos'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-1 rounded-full">
                      <Users className="w-3 h-3" />
                      {enrolled}
                    </span>
                    <span className="text-xs px-2 py-1 rounded-full font-medium bg-emerald-100 text-emerald-700">
                      active
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-sm text-gray-500">
        Stats, receita e evolução de jogadores estão em{' '}
        <button
          type="button"
          onClick={() => onNavigate('metrics')}
          className="text-indigo-600 hover:underline font-medium"
        >
          Métricas
        </button>
        .
      </p>
    </div>
  );
}
