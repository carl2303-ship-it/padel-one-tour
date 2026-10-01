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

type TeamWithPlayers = ClubLeagueTeam & { club_league_players: ClubLeaguePlayer[] };

type Props = {
  tournament: Tournament;
  categories: TournamentCategory[];
  isOrganizer?: boolean;
  embedded?: boolean;
};

type Tab = 'teams' | 'calendar' | 'standings';

export default function ClubLeagueView({
  tournament,
  categories,
  isOrganizer = true,
  embedded = false,
}: Props) {
  const [tab, setTab] = useState<Tab>('teams');
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

  const updateMatchdaySchedule = async (
    matchday: ClubLeagueMatchday,
    date: string,
    time: string
  ) => {
    setBusy(true);
    setError('');
    try {
      const { error: mdErr } = await supabase
        .from('club_league_matchdays')
        .update({ matchday_date: date || null })
        .eq('id', matchday.id);
      if (mdErr) throw mdErr;

      const list = confrontations.filter(c => c.matchday_id === matchday.id);
      if (list.length > 0 && date && time) {
        const timeFull = time.length === 5 ? `${time}:00` : time;
        const scheduled = `${date}T${timeFull}`;
        const { error: confErr } = await supabase
          .from('club_league_confrontations')
          .update({ scheduled_time: scheduled })
          .eq('matchday_id', matchday.id);
        if (confErr) throw confErr;
      }
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar jornada');
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
          {matchdays.map(md => {
            const list = confrontationsByMatchday.get(md.id) || [];
            const firstTime = list.find(c => c.scheduled_time)?.scheduled_time;
            const timeValue = firstTime
              ? new Date(firstTime).toTimeString().slice(0, 5)
              : '18:00';
            return (
              <div key={md.id} className="bg-white rounded-xl shadow-lg p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                  <div>
                    <h3 className="font-semibold">
                      {md.label || `Jornada ${md.matchday_number}`}
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        {md.leg === 'away' ? 'volta' : 'ida'}
                      </span>
                    </h3>
                  </div>
                  {isOrganizer ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        defaultValue={md.matchday_date || ''}
                        disabled={busy}
                        onBlur={e => {
                          const date = e.target.value;
                          if (date !== (md.matchday_date || '')) {
                            void updateMatchdaySchedule(md, date, timeValue);
                          }
                        }}
                        className="border rounded-lg px-2 py-1 text-sm"
                      />
                      <input
                        type="time"
                        defaultValue={timeValue}
                        disabled={busy}
                        onBlur={e => {
                          const time = e.target.value;
                          if (time !== timeValue) {
                            void updateMatchdaySchedule(md, md.matchday_date || '', time);
                          }
                        }}
                        className="border rounded-lg px-2 py-1 text-sm"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-gray-500">
                      {md.matchday_date || ''}
                      {firstTime
                        ? ` · ${new Date(firstTime).toLocaleTimeString('pt-PT', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}`
                        : ''}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {list.map(c => {
                    const home = c.home_team_id ? teamById.get(c.home_team_id) : null;
                    const away = c.away_team_id ? teamById.get(c.away_team_id) : null;
                    return (
                      <div
                        key={c.id}
                        className="border rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-2 justify-between"
                      >
                        <div>
                          <div className="font-medium text-sm">
                            {home?.name || '?'} <span className="text-gray-400">vs</span>{' '}
                            {away?.name || '?'}
                          </div>
                          <div className="text-xs text-gray-500">
                            {c.scheduled_time
                              ? new Date(c.scheduled_time).toLocaleString('pt-PT')
                              : 'Sem hora'}
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
