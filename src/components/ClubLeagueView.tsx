import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, Loader2, Plus, Trash2, Users, Trophy, ListOrdered, Pencil } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type {
  Tournament,
  TournamentCategory,
  ClubLeagueTeam,
  ClubLeagueMatchday,
  ClubLeagueConfrontation,
  ClubLeagueStanding,
  ClubLeaguePlayer,
} from '../lib/supabase';
import AddClubLeagueTeamModal from './AddClubLeagueTeamModal';
import EditClubLeagueTeamModal from './EditClubLeagueTeamModal';
import ClubLeagueLineupModal from './ClubLeagueLineupModal';
import ClubLeagueResultsModal from './ClubLeagueResultsModal';
import ClubLeagueScheduleModal from './ClubLeagueScheduleModal';
import { formatEuDate, formatEuDateTime, formatEuTime, parseEuDate, parseEuTime } from '../lib/clubLeagueScheduler';

type TeamWithPlayers = ClubLeagueTeam & { club_league_players: ClubLeaguePlayer[] };

type Props = {
  tournament: Tournament;
  categories: TournamentCategory[];
  isOrganizer?: boolean;
  embedded?: boolean;
};

type Tab = 'teams' | 'calendar' | 'standings';
type CalendarMode = 'matchdays' | 'teams';

export default function ClubLeagueView({
  tournament,
  categories,
  isOrganizer = true,
  embedded = false,
}: Props) {
  const [tab, setTab] = useState<Tab>('teams');
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('teams');
  const [calendarTeamId, setCalendarTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [teams, setTeams] = useState<TeamWithPlayers[]>([]);
  const [matchdays, setMatchdays] = useState<ClubLeagueMatchday[]>([]);
  const [confrontations, setConfrontations] = useState<ClubLeagueConfrontation[]>([]);
  const [standings, setStandings] = useState<ClubLeagueStanding[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamWithPlayers | null>(null);
  const [lineupCtx, setLineupCtx] = useState<{
    confrontation: ClubLeagueConfrontation;
    team: TeamWithPlayers;
  } | null>(null);
  const [resultsCtx, setResultsCtx] = useState<ClubLeagueConfrontation | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(
    categories[0]?.id ?? null
  );

  useEffect(() => {
    if (!selectedCategory && categories[0]?.id) {
      setSelectedCategory(categories[0].id);
    }
  }, [categories, selectedCategory]);

  const teamById = useMemo(() => {
    const m = new Map<string, TeamWithPlayers>();
    teams.forEach(t => m.set(t.id, t));
    return m;
  }, [teams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let teamsQ = supabase
        .from('club_league_teams')
        .select('*, club_league_players!club_league_players_team_id_fkey(*)')
        .eq('tournament_id', tournament.id)
        .order('registration_order');
      if (selectedCategory) teamsQ = teamsQ.eq('category_id', selectedCategory);

      let mdQ = supabase
        .from('club_league_matchdays')
        .select('*')
        .eq('tournament_id', tournament.id)
        .order('matchday_number');
      if (selectedCategory) mdQ = mdQ.eq('category_id', selectedCategory);

      let confQ = supabase
        .from('club_league_confrontations')
        .select('*')
        .eq('tournament_id', tournament.id)
        .order('scheduled_time', { ascending: true, nullsFirst: false });
      if (selectedCategory) confQ = confQ.eq('category_id', selectedCategory);

      let stQ = supabase
        .from('club_league_standings')
        .select('*')
        .eq('tournament_id', tournament.id)
        .order('position', { ascending: true, nullsFirst: false });
      if (selectedCategory) stQ = stQ.eq('category_id', selectedCategory);

      const [teamsRes, mdRes, confRes, stRes] = await Promise.all([teamsQ, mdQ, confQ, stQ]);
      if (teamsRes.error) throw teamsRes.error;
      if (mdRes.error) throw mdRes.error;
      if (confRes.error) throw confRes.error;
      if (stRes.error) throw stRes.error;

      setTeams((teamsRes.data || []) as TeamWithPlayers[]);
      setMatchdays((mdRes.data || []) as ClubLeagueMatchday[]);
      setConfrontations((confRes.data || []) as ClubLeagueConfrontation[]);
      setStandings((stRes.data || []) as ClubLeagueStanding[]);
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : err instanceof Error
            ? err.message
            : 'Erro ao carregar liga';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [tournament.id, selectedCategory]);

  useEffect(() => {
    load();
  }, [load]);

  const deleteTeam = async (teamId: string) => {
    if (!confirm('Apagar este clube e o respetivo plantel?')) return;
    setBusy(true);
    await supabase.from('club_league_standings').delete().eq('team_id', teamId);
    await supabase.from('club_league_teams').delete().eq('id', teamId);
    await load();
    setBusy(false);
  };

  const updateMatchdayDates = async (
    matchday: ClubLeagueMatchday,
    day1Eu: string,
    day2Eu: string
  ) => {
    const day1 = parseEuDate(day1Eu);
    if (!day1) {
      setError(`Data dia 1 inválida na jornada ${matchday.matchday_number} (dd/MM/aaaa)`);
      return;
    }
    let day2: string | null = null;
    if (day2Eu.trim()) {
      day2 = parseEuDate(day2Eu);
      if (!day2) {
        setError(`Data dia 2 inválida na jornada ${matchday.matchday_number} (dd/MM/aaaa)`);
        return;
      }
    }
    setBusy(true);
    setError('');
    try {
      const { error: mdErr } = await supabase
        .from('club_league_matchdays')
        .update({ matchday_date: day1, matchday_date_2: day2 })
        .eq('id', matchday.id);
      if (mdErr) throw mdErr;
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar jornada');
    } finally {
      setBusy(false);
    }
  };

  const updateConfrontationSchedule = async (
    confrontationId: string,
    dateEu: string,
    time: string
  ) => {
    const dateIso = parseEuDate(dateEu);
    if (!dateIso) {
      setError('Data do jogo inválida (usa dd/MM/aaaa).');
      return;
    }
    if (!parseEuTime(time)) {
      setError('Hora do jogo inválida (usa HH:mm em 24h, ex: 18:30).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const hhmm = parseEuTime(time);
      const { error: confErr } = await supabase
        .from('club_league_confrontations')
        .update({ scheduled_time: `${dateIso}T${hhmm}:00` })
        .eq('id', confrontationId);
      if (confErr) throw confErr;
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar jogo');
    } finally {
      setBusy(false);
    }
  };

  const confrontationsByMatchday = useMemo(() => {
    const map = new Map<string, ClubLeagueConfrontation[]>();
    for (const c of confrontations) {
      const key = c.matchday_id || 'none';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [confrontations]);

  const matchdayById = useMemo(() => {
    const m = new Map<string, ClubLeagueMatchday>();
    matchdays.forEach(md => m.set(md.id, md));
    return m;
  }, [matchdays]);

  useEffect(() => {
    if (teams.length === 0) {
      setCalendarTeamId(null);
      return;
    }
    if (!calendarTeamId || !teams.some(t => t.id === calendarTeamId)) {
      setCalendarTeamId(teams[0].id);
    }
  }, [teams, calendarTeamId]);

  const teamCalendar = useMemo(() => {
    if (!calendarTeamId) return [];
    return confrontations
      .filter(c => c.home_team_id === calendarTeamId || c.away_team_id === calendarTeamId)
      .map(c => {
        const md = c.matchday_id ? matchdayById.get(c.matchday_id) : undefined;
        const isHome = c.home_team_id === calendarTeamId;
        const opponentId = isHome ? c.away_team_id : c.home_team_id;
        const sortTime = c.scheduled_time
          ? new Date(c.scheduled_time).getTime()
          : md?.matchday_date
            ? new Date(md.matchday_date + 'T12:00:00').getTime()
            : (md?.matchday_number || 0) * 1e12;
        return { c, md, isHome, opponentId, sortTime };
      })
      .sort((a, b) => {
        if (a.sortTime !== b.sortTime) return a.sortTime - b.sortTime;
        return (a.md?.matchday_number || 0) - (b.md?.matchday_number || 0);
      });
  }, [confrontations, calendarTeamId, matchdayById]);

  const rankedStandings = useMemo(() => {
    return [...standings].sort((a, b) => {
      if ((a.position || 999) !== (b.position || 999)) {
        return (a.position || 999) - (b.position || 999);
      }
      return b.points - a.points;
    });
  }, [standings]);

  if (loading) {
    return (
      <div className={`flex justify-center py-16 ${embedded ? '' : 'bg-white rounded-xl'}`}>
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>
      )}

      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {categories.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedCategory(c.id)}
              className={`px-3 py-1.5 text-sm rounded-lg ${
                selectedCategory === c.id ? 'bg-emerald-600 text-white' : 'bg-white border'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-lg p-3 flex flex-wrap gap-2 items-center">
        {(
          [
            ['teams', Users, 'Clubes'],
            ['calendar', Calendar, 'Calendário'],
            ['standings', ListOrdered, 'Classificação'],
          ] as const
        ).map(([id, Icon, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg ${
              tab === id ? 'bg-emerald-600 text-white' : 'hover:bg-gray-100'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}

        {isOrganizer && (
          <div className="ml-auto flex flex-wrap gap-2">
            {tab === 'teams' && (
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg"
              >
                <Plus className="w-4 h-4" /> Inscrever clube
              </button>
            )}
            <button
              type="button"
              disabled={busy || teams.length < 2}
              onClick={() => setShowScheduleModal(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg disabled:opacity-50"
            >
              <Calendar className="w-4 h-4" />
              {confrontations.length > 0 ? 'Redefinir calendário' : 'Definir datas e gerar'}
            </button>
          </div>
        )}
      </div>

      {tab === 'teams' && (
        <div className="bg-white rounded-xl shadow-lg p-4 space-y-3">
          <p className="text-sm text-gray-600">
            {teams.length} clubes · pode inscrever só o capitão e completar o plantel depois (lineup exige 6)
          </p>
          {teams.length === 0 && (
            <p className="text-gray-500 text-sm">Ainda sem clubes. O organizador faz as inscrições.</p>
          )}
          {teams.map(team => {
            const roster = [...(team.club_league_players || [])].sort(
              (a, b) => a.player_order - b.player_order
            );
            return (
              <div key={team.id} className="border rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{team.name}</h3>
                    <p className="text-xs text-gray-500">
                      {roster.length} jogadores · Capitão:{' '}
                      {roster.find(p => p.is_captain)?.name || '—'}
                    </p>
                  </div>
                  {isOrganizer && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditingTeam(team)}
                        className="text-blue-600 p-1 hover:bg-blue-50 rounded"
                        title="Editar plantel"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => deleteTeam(team.id)}
                        className="text-red-500 p-1 hover:bg-red-50 rounded"
                        title="Apagar clube"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {roster.map(p => (
                    <span
                      key={p.id}
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        p.is_captain ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {p.name} · {Number(p.fpp_points)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'calendar' && (
        <div className="space-y-4">
          {matchdays.length === 0 && (
            <div className="bg-white rounded-xl shadow-lg p-6 text-center text-gray-500 text-sm space-y-3">
              <p>Sem jornadas. Define as datas/horas e gera o calendário casa/fora.</p>
              {isOrganizer && (
                <button
                  type="button"
                  disabled={teams.length < 2}
                  onClick={() => setShowScheduleModal(true)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg disabled:opacity-50"
                >
                  <Calendar className="w-4 h-4" />
                  Definir datas e gerar
                </button>
              )}
            </div>
          )}

          {matchdays.length > 0 && (
            <div className="bg-white rounded-xl shadow-lg p-3 space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCalendarMode('teams')}
                  className={`px-3 py-1.5 text-sm rounded-lg ${
                    calendarMode === 'teams' ? 'bg-emerald-600 text-white' : 'border hover:bg-gray-50'
                  }`}
                >
                  Por equipa
                </button>
                <button
                  type="button"
                  onClick={() => setCalendarMode('matchdays')}
                  className={`px-3 py-1.5 text-sm rounded-lg ${
                    calendarMode === 'matchdays'
                      ? 'bg-emerald-600 text-white'
                      : 'border hover:bg-gray-50'
                  }`}
                >
                  Por jornadas
                </button>
              </div>

              {calendarMode === 'teams' && (
                <div className="flex flex-wrap gap-2">
                  {teams.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setCalendarTeamId(t.id)}
                      className={`px-3 py-1.5 text-xs sm:text-sm rounded-lg border ${
                        calendarTeamId === t.id
                          ? 'bg-emerald-50 border-emerald-500 text-emerald-800 font-medium'
                          : 'hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {calendarMode === 'teams' && matchdays.length > 0 && (
            <div className="bg-white rounded-xl shadow-lg p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <h3 className="font-semibold">
                  {calendarTeamId ? teamById.get(calendarTeamId)?.name : 'Equipa'}
                </h3>
                <p className="text-xs text-gray-500">
                  {teamCalendar.length} jogo{teamCalendar.length === 1 ? '' : 's'} · casa/fora
                </p>
              </div>
              {teamCalendar.length === 0 ? (
                <p className="text-sm text-gray-500">Sem jogos para esta equipa.</p>
              ) : (
                <div className="space-y-2">
                  {teamCalendar.map(({ c, md, isHome, opponentId }) => {
                    const opponent = opponentId ? teamById.get(opponentId) : null;
                    const myTeam = calendarTeamId ? teamById.get(calendarTeamId) : null;
                    return (
                      <div key={c.id} className="border rounded-lg p-3 flex flex-col gap-2">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <span
                                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                                  isHome
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-sky-100 text-sky-800'
                                }`}
                              >
                                {isHome ? 'Casa' : 'Fora'}
                              </span>
                              <span className="text-xs text-gray-500">
                                {md?.label ||
                                  (md ? `Jornada ${md.matchday_number}` : 'Jornada')}
                                {md?.leg === 'away' ? ' · volta' : md ? ' · ida' : ''}
                              </span>
                            </div>
                            <div className="font-medium text-sm">
                              vs {opponent?.name || '?'}
                            </div>
                            <div className="text-xs text-gray-500">
                              {formatEuDateTime(c.scheduled_time) || 'Sem data/hora'}
                              {c.venue ? ` · ${c.venue}` : ''}
                              {c.status === 'completed'
                                ? ` · ${c.home_duos_won}-${c.away_duos_won}`
                                : ''}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {myTeam && (
                              <button
                                type="button"
                                onClick={() => setLineupCtx({ confrontation: c, team: myTeam })}
                                className="text-xs px-2 py-1 border rounded-lg"
                              >
                                Lineup
                              </button>
                            )}
                            {isOrganizer && (
                              <button
                                type="button"
                                onClick={() => setResultsCtx(c)}
                                className="text-xs px-2 py-1 bg-emerald-600 text-white rounded-lg"
                              >
                                Resultado
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {calendarMode === 'matchdays' &&
            matchdays.map(md => {
            const list = [...(confrontationsByMatchday.get(md.id) || [])].sort((a, b) => {
              const ta = a.scheduled_time ? new Date(a.scheduled_time).getTime() : 0;
              const tb = b.scheduled_time ? new Date(b.scheduled_time).getTime() : 0;
              return ta - tb;
            });
            const dayOptions = [md.matchday_date, md.matchday_date_2].filter(Boolean) as string[];
            return (
              <div key={md.id} className="bg-white rounded-xl shadow-lg p-4">
                <div className="flex flex-col gap-3 mb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h3 className="font-semibold">
                      {md.label || `Jornada ${md.matchday_number}`}
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        {md.leg === 'away' ? 'volta' : 'ida'}
                      </span>
                    </h3>
                    {!isOrganizer && (
                      <span className="text-xs text-gray-500">
                        {formatEuDate(md.matchday_date)}
                        {md.matchday_date_2 ? ` – ${formatEuDate(md.matchday_date_2)}` : ''}
                      </span>
                    )}
                  </div>
                  {isOrganizer && (
                    <div className="flex flex-wrap items-end gap-2 text-sm">
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-0.5">Dia 1</label>
                        <input
                          type="text"
                          placeholder="dd/MM/aaaa"
                          defaultValue={formatEuDate(md.matchday_date)}
                          key={`d1-${md.id}-${md.matchday_date}`}
                          disabled={busy}
                          onBlur={e => {
                            const next = e.target.value.trim();
                            const prev = formatEuDate(md.matchday_date);
                            if (next && next !== prev) {
                              void updateMatchdayDates(md, next, formatEuDate(md.matchday_date_2));
                            }
                          }}
                          className="border rounded-lg px-2 py-1 w-[8.5rem]"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-0.5">Dia 2</label>
                        <input
                          type="text"
                          placeholder="dd/MM/aaaa"
                          defaultValue={formatEuDate(md.matchday_date_2)}
                          key={`d2-${md.id}-${md.matchday_date_2}`}
                          disabled={busy}
                          onBlur={e => {
                            const next = e.target.value.trim();
                            const prev = formatEuDate(md.matchday_date_2);
                            if (next !== prev) {
                              void updateMatchdayDates(
                                md,
                                formatEuDate(md.matchday_date) || next,
                                next
                              );
                            }
                          }}
                          className="border rounded-lg px-2 py-1 w-[8.5rem]"
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  {list.map(c => {
                    const home = c.home_team_id ? teamById.get(c.home_team_id) : null;
                    const away = c.away_team_id ? teamById.get(c.away_team_id) : null;
                    const scheduled = c.scheduled_time ? new Date(c.scheduled_time) : null;
                    const dateIso =
                      scheduled && !Number.isNaN(scheduled.getTime())
                        ? `${scheduled.getFullYear()}-${String(scheduled.getMonth() + 1).padStart(2, '0')}-${String(scheduled.getDate()).padStart(2, '0')}`
                        : md.matchday_date || '';
                    const timeValue =
                      scheduled && !Number.isNaN(scheduled.getTime())
                        ? formatEuTime(c.scheduled_time)
                        : '18:00';
                    return (
                      <div
                        key={c.id}
                        className="border rounded-lg p-3 flex flex-col gap-2"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                          <div>
                            <div className="font-medium text-sm">
                              {home?.name || '?'} <span className="text-gray-400">vs</span>{' '}
                              {away?.name || '?'}
                            </div>
                            <div className="text-xs text-gray-500">
                              {formatEuDateTime(c.scheduled_time) || 'Sem data/hora'}
                              {c.venue ? ` · Casa: ${c.venue}` : ''}
                              {c.status === 'completed'
                                ? ` · ${c.home_duos_won}-${c.away_duos_won}`
                                : ''}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {home && (
                              <button
                                type="button"
                                onClick={() => setLineupCtx({ confrontation: c, team: home })}
                                className="text-xs px-2 py-1 border rounded-lg"
                              >
                                Lineup casa
                              </button>
                            )}
                            {away && (
                              <button
                                type="button"
                                onClick={() => setLineupCtx({ confrontation: c, team: away })}
                                className="text-xs px-2 py-1 border rounded-lg"
                              >
                                Lineup fora
                              </button>
                            )}
                            {isOrganizer && (
                              <button
                                type="button"
                                onClick={() => setResultsCtx(c)}
                                className="text-xs px-2 py-1 bg-emerald-600 text-white rounded-lg"
                              >
                                Resultado
                              </button>
                            )}
                          </div>
                        </div>
                        {isOrganizer && (
                          <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-gray-50">
                            <div>
                              <label className="block text-[10px] text-gray-500 mb-0.5">
                                Dia do jogo
                              </label>
                              {dayOptions.length > 0 ? (
                                <select
                                  key={`sel-${c.id}-${c.scheduled_time}`}
                                  defaultValue={dateIso}
                                  disabled={busy}
                                  onChange={e => {
                                    void updateConfrontationSchedule(c.id, formatEuDate(e.target.value), timeValue);
                                  }}
                                  className="border rounded-lg px-2 py-1 text-sm"
                                >
                                  {dayOptions.map(d => (
                                    <option key={d} value={d}>
                                      {formatEuDate(d)}
                                    </option>
                                  ))}
                                  {dateIso && !dayOptions.includes(dateIso) && (
                                    <option value={dateIso}>{formatEuDate(dateIso)}</option>
                                  )}
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  placeholder="dd/MM/aaaa"
                                  defaultValue={formatEuDate(dateIso)}
                                  key={`dt-${c.id}-${c.scheduled_time}`}
                                  disabled={busy}
                                  onBlur={e => {
                                    const next = e.target.value.trim();
                                    if (next && next !== formatEuDate(dateIso)) {
                                      void updateConfrontationSchedule(c.id, next, timeValue);
                                    }
                                  }}
                                  className="border rounded-lg px-2 py-1 text-sm w-[8.5rem]"
                                />
                              )}
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-500 mb-0.5">
                                Hora 24h (HH:mm)
                              </label>
                              <input
                                type="text"
                                inputMode="numeric"
                                placeholder="18:00"
                                defaultValue={timeValue}
                                key={`tm-${c.id}-${c.scheduled_time}`}
                                disabled={busy}
                                onBlur={e => {
                                  const next = parseEuTime(e.target.value);
                                  if (next && next !== timeValue) {
                                    void updateConfrontationSchedule(
                                      c.id,
                                      formatEuDate(dateIso) || formatEuDate(md.matchday_date),
                                      next
                                    );
                                  } else if (e.target.value.trim() && !next) {
                                    setError('Hora inválida (usa HH:mm em 24h, ex: 18:30).');
                                    e.target.value = timeValue;
                                  }
                                }}
                                className="border rounded-lg px-2 py-1 text-sm font-mono w-[5.5rem]"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'standings' && (
        <div className="bg-white rounded-xl shadow-lg overflow-x-auto">
          <div className="p-4 border-b flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            <h3 className="font-semibold">Classificação</h3>
            <span className="text-xs text-gray-500">
              Vitória 3 pts · Derrota 1 pt · Desempate: H2H → V → Diff sets → Sets ganhos
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Clube</th>
                <th className="px-3 py-2 text-center">J</th>
                <th className="px-3 py-2 text-center">V</th>
                <th className="px-3 py-2 text-center">D</th>
                <th className="px-3 py-2 text-center">Sets</th>
                <th className="px-3 py-2 text-center">Diff</th>
                <th className="px-3 py-2 text-center">Pts</th>
              </tr>
            </thead>
            <tbody>
              {rankedStandings.map(row => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2">{row.position ?? '—'}</td>
                  <td className="px-3 py-2 font-medium">
                    {teamById.get(row.team_id)?.name || '—'}
                  </td>
                  <td className="px-3 py-2 text-center">{row.played}</td>
                  <td className="px-3 py-2 text-center">{row.won}</td>
                  <td className="px-3 py-2 text-center">{row.lost}</td>
                  <td className="px-3 py-2 text-center">
                    {row.sets_won}-{row.sets_lost}
                  </td>
                  <td className="px-3 py-2 text-center">{row.sets_diff}</td>
                  <td className="px-3 py-2 text-center font-semibold">{row.points}</td>
                </tr>
              ))}
              {rankedStandings.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-gray-500">
                    Sem classificação ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showScheduleModal && (
        <ClubLeagueScheduleModal
          tournament={tournament}
          teams={teams}
          categoryId={selectedCategory}
          hasExistingCalendar={confrontations.length > 0 || matchdays.length > 0}
          onClose={() => setShowScheduleModal(false)}
          onSuccess={() => {
            setShowScheduleModal(false);
            setTab('calendar');
            load();
          }}
        />
      )}

      {showAdd && (
        <AddClubLeagueTeamModal
          tournamentId={tournament.id}
          categories={categories.map(c => ({ id: c.id, name: c.name }))}
          selectedCategory={selectedCategory}
          onClose={() => setShowAdd(false)}
          onSuccess={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}

      {editingTeam && (
        <EditClubLeagueTeamModal
          team={editingTeam}
          onClose={() => setEditingTeam(null)}
          onSuccess={() => {
            setEditingTeam(null);
            load();
          }}
        />
      )}

      {lineupCtx && (
        <ClubLeagueLineupModal
          confrontation={lineupCtx.confrontation}
          team={lineupCtx.team}
          isOrganizer={isOrganizer}
          onClose={() => setLineupCtx(null)}
          onSuccess={() => {
            setLineupCtx(null);
            load();
          }}
        />
      )}

      {resultsCtx && (
        <ClubLeagueResultsModal
          confrontation={resultsCtx}
          homeTeam={resultsCtx.home_team_id ? teamById.get(resultsCtx.home_team_id) : null}
          awayTeam={resultsCtx.away_team_id ? teamById.get(resultsCtx.away_team_id) : null}
          onClose={() => setResultsCtx(null)}
          onSuccess={() => {
            setResultsCtx(null);
            load();
          }}
        />
      )}
    </div>
  );
}
