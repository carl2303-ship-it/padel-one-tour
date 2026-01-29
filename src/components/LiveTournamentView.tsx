import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../lib/i18nContext';
import { useCustomLogo } from '../lib/useCustomLogo';
import { Calendar, Clock, MapPin, Trophy, Users, RefreshCw } from 'lucide-react';

interface Match {
  id: string;
  match_number: number;
  round: string;
  scheduled_time: string;
  court: string;
  team1_id: string | null;
  team2_id: string | null;
  team1_score_set1: number | null;
  team2_score_set1: number | null;
  team1_score_set2: number | null;
  team2_score_set2: number | null;
  team1_score_set3: number | null;
  team2_score_set3: number | null;
  status: string;
  player1_individual_id?: string | null;
  player2_individual_id?: string | null;
  player3_individual_id?: string | null;
  player4_individual_id?: string | null;
}

const getMatchScores = (match: Match): { team1: number | null; team2: number | null } => {
  const t1s1 = match.team1_score_set1 ?? 0;
  const t1s2 = match.team1_score_set2 ?? 0;
  const t1s3 = match.team1_score_set3 ?? 0;
  const t2s1 = match.team2_score_set1 ?? 0;
  const t2s2 = match.team2_score_set2 ?? 0;
  const t2s3 = match.team2_score_set3 ?? 0;

  if (match.team1_score_set1 === null && match.team2_score_set1 === null) {
    return { team1: null, team2: null };
  }

  return {
    team1: t1s1 + t1s2 + t1s3,
    team2: t2s1 + t2s2 + t2s3
  };
};

interface Team {
  id: string;
  team_name: string;
  group_name: string | null;
}

interface Player {
  id: string;
  name: string;
  group_name?: string | null;
}

interface Tournament {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  format: string;
  number_of_courts: number;
  image_url?: string;
}

interface Standing {
  entity_id: string;
  entity_name: string;
  entity_type: string;
  group_name: string;
  wins: number;
  losses: number;
  points_for: number;
  points_against: number;
  points_diff: number;
  points: number;
  position: number;
}

const calculateStandings = (matches: Match[], teams: Team[], players: Player[]): Standing[] => {
  const standings = new Map<string, Standing>();
  const isIndividualFormat = teams.length === 0 && players.length > 0;

  if (isIndividualFormat) {
    players.forEach(player => {
      standings.set(player.id, {
        entity_id: player.id,
        entity_name: player.name,
        entity_type: 'player',
        group_name: player.group_name || 'Geral',
        wins: 0,
        losses: 0,
        points_for: 0,
        points_against: 0,
        points_diff: 0,
        points: 0,
        position: 0
      });
    });

    matches.forEach(match => {
      const scores = getMatchScores(match);
      if (match.status !== 'completed' || scores.team1 === null || scores.team2 === null) {
        return;
      }

      const team1Players = [match.player1_individual_id, match.player2_individual_id].filter(Boolean);
      const team2Players = [match.player3_individual_id, match.player4_individual_id].filter(Boolean);

      team1Players.forEach(playerId => {
        const standing = standings.get(playerId!);
        if (standing) {
          standing.points_for += scores.team1!;
          standing.points_against += scores.team2!;
          if (scores.team1! > scores.team2!) {
            standing.wins++;
            standing.points += 2;
          } else {
            standing.losses++;
            standing.points += 1;
          }
          standing.points_diff = standing.points_for - standing.points_against;
        }
      });

      team2Players.forEach(playerId => {
        const standing = standings.get(playerId!);
        if (standing) {
          standing.points_for += scores.team2!;
          standing.points_against += scores.team1!;
          if (scores.team2! > scores.team1!) {
            standing.wins++;
            standing.points += 2;
          } else {
            standing.losses++;
            standing.points += 1;
          }
          standing.points_diff = standing.points_for - standing.points_against;
        }
      });
    });
  } else {
    teams.forEach(team => {
      standings.set(team.id, {
        entity_id: team.id,
        entity_name: team.team_name,
        entity_type: 'team',
        group_name: team.group_name || 'Geral',
        wins: 0,
        losses: 0,
        points_for: 0,
        points_against: 0,
        points_diff: 0,
        points: 0,
        position: 0
      });
    });

    matches.forEach(match => {
      const scores = getMatchScores(match);
      if (match.status !== 'completed' || scores.team1 === null || scores.team2 === null) {
        return;
      }

      const team1Standing = standings.get(match.team1_id || '');
      const team2Standing = standings.get(match.team2_id || '');

      if (team1Standing && team2Standing) {
        team1Standing.points_for += scores.team1;
        team1Standing.points_against += scores.team2;
        team2Standing.points_for += scores.team2;
        team2Standing.points_against += scores.team1;

        if (scores.team1 > scores.team2) {
          team1Standing.wins++;
          team1Standing.points += 2;
          team2Standing.losses++;
          team2Standing.points += 1;
        } else if (scores.team2 > scores.team1) {
          team2Standing.wins++;
          team2Standing.points += 2;
          team1Standing.losses++;
          team1Standing.points += 1;
        }

        team1Standing.points_diff = team1Standing.points_for - team1Standing.points_against;
        team2Standing.points_diff = team2Standing.points_for - team2Standing.points_against;
      }
    });
  }

  // Group and sort
  const grouped = new Map<string, Standing[]>();
  standings.forEach(standing => {
    const group = standing.group_name;
    if (!grouped.has(group)) {
      grouped.set(group, []);
    }
    grouped.get(group)!.push(standing);
  });

  const result: Standing[] = [];
  grouped.forEach((groupStandings, groupName) => {
    groupStandings.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.points_diff !== a.points_diff) return b.points_diff - a.points_diff;
      if (b.points_for !== a.points_for) return b.points_for - a.points_for;
      return (a.entity_name || '').localeCompare(b.entity_name || '');
    });

    groupStandings.forEach((standing, index) => {
      standing.position = index + 1;
      result.push(standing);
    });
  });

  return result;
};

export default function LiveTournamentView() {
  const { t } = useI18n();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const { logoUrl } = useCustomLogo(tournament?.user_id);
  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [activeTab, setActiveTab] = useState<'schedule' | 'standings'>('schedule');

  const tournamentId = window.location.pathname.split('/')[2];

  const fetchTournamentData = async () => {
    try {
      const { data: tournamentData, error: tournamentError } = await supabase
        .from('tournaments')
        .select('id, name, start_date, end_date, format, round_robin_type, number_of_courts, image_url, user_id')
        .eq('id', tournamentId)
        .single();

      if (tournamentError) throw tournamentError;
      setTournament(tournamentData);

      const { data: matchesData, error: matchesError } = await supabase
        .from('matches')
        .select('id, match_number, round, scheduled_time, court, team1_id, team2_id, team1_score_set1, team2_score_set1, team1_score_set2, team2_score_set2, team1_score_set3, team2_score_set3, status, player1_individual_id, player2_individual_id, player3_individual_id, player4_individual_id')
        .eq('tournament_id', tournamentId)
        .order('scheduled_time', { ascending: true });

      if (matchesError) throw matchesError;
      setMatches(matchesData || []);

      const { data: teamsData, error: teamsError } = await supabase
        .from('teams')
        .select('id, team_name:name, group_name')
        .eq('tournament_id', tournamentId);

      if (teamsError) throw teamsError;
      setTeams(teamsData || []);

      const { data: playersData, error: playersError } = await supabase
        .from('players')
        .select('id, name, group_name')
        .eq('tournament_id', tournamentId);

      if (playersError) throw playersError;
      setPlayers(playersData || []);

      if (matchesData && teamsData) {
        const calculatedStandings = calculateStandings(matchesData, teamsData, playersData || []);
        setStandings(calculatedStandings);
      }

      setLastUpdate(new Date());
      setLoading(false);
    } catch (err) {
      console.error('Error fetching tournament data:', err);
      setError('Erro ao carregar dados do torneio');
      setLoading(false);
    }
  };

  const handleMatchChange = (payload: any) => {
    const { eventType, new: newRecord, old: oldRecord } = payload;
    setLastUpdate(new Date());

    if (eventType === 'INSERT' && newRecord) {
      setMatches(prev => [...prev, newRecord as Match].sort(
        (a, b) => new Date(a.scheduled_time).getTime() - new Date(b.scheduled_time).getTime()
      ));
    } else if (eventType === 'UPDATE' && newRecord) {
      setMatches(prev => {
        const updated = prev.map(m => m.id === newRecord.id ? { ...m, ...newRecord } : m);
        const calculatedStandings = calculateStandings(updated, teams, players);
        setStandings(calculatedStandings);
        return updated;
      });
    } else if (eventType === 'DELETE' && oldRecord) {
      setMatches(prev => prev.filter(m => m.id !== oldRecord.id));
    }
  };

  useEffect(() => {
    fetchTournamentData();

    const matchesChannel = supabase
      .channel('live-matches')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
          filter: `tournament_id=eq.${tournamentId}`
        },
        handleMatchChange
      )
      .subscribe();

    return () => {
      supabase.removeChannel(matchesChannel);
    };
  }, [tournamentId]);

  const getEntityName = (match: Match, side: 'team1' | 'team2'): string => {
    const isIndividualFormat = teams.length === 0 && players.length > 0;

    if (side === 'team1') {
      if (match.team1_id) {
        const team = teams.find(t => t.id === match.team1_id);
        return team?.team_name || 'TBD';
      }
      if (isIndividualFormat && (match.player1_individual_id || match.player2_individual_id)) {
        const player1 = match.player1_individual_id ? players.find(p => p.id === match.player1_individual_id) : null;
        const player2 = match.player2_individual_id ? players.find(p => p.id === match.player2_individual_id) : null;
        const names = [player1?.name, player2?.name].filter(Boolean);
        return names.length > 0 ? names.join(' / ') : 'TBD';
      }
    } else {
      if (match.team2_id) {
        const team = teams.find(t => t.id === match.team2_id);
        return team?.team_name || 'TBD';
      }
      if (isIndividualFormat && (match.player3_individual_id || match.player4_individual_id)) {
        const player3 = match.player3_individual_id ? players.find(p => p.id === match.player3_individual_id) : null;
        const player4 = match.player4_individual_id ? players.find(p => p.id === match.player4_individual_id) : null;
        const names = [player3?.name, player4?.name].filter(Boolean);
        return names.length > 0 ? names.join(' / ') : 'TBD';
      }
    }
    return 'TBD';
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}-${month}`;
  };

  const getMatchStatus = (match: Match) => {
    if (match.status === 'completed') {
      return <span className="text-green-600 font-semibold">Concluído</span>;
    }
    if (match.status === 'in_progress') {
      return <span className="text-blue-600 font-semibold">Em Jogo</span>;
    }
    return <span className="text-gray-500">Agendado</span>;
  };

  const groupedMatches = matches.reduce((acc, match) => {
    const date = formatDate(match.scheduled_time);
    if (!acc[date]) acc[date] = [];
    acc[date].push(match);
    return acc;
  }, {} as Record<string, Match[]>);

  const groupedStandings = standings.reduce((acc, standing) => {
    const group = standing.group_name || 'Geral';
    if (!acc[group]) acc[group] = [];
    acc[group].push(standing);
    return acc;
  }, {} as Record<string, Standing[]>);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">A carregar torneio...</p>
        </div>
      </div>
    );
  }

  if (error || !tournament) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg">{error || 'Torneio não encontrado'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      {/* Header */}
      <div className="bg-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {logoUrl && (
                <img
                  src={logoUrl}
                  alt="Tournament Logo"
                  className="h-16 object-contain"
                />
              )}
              {tournament.image_url && (
                <img
                  src={tournament.image_url}
                  alt={tournament.name}
                  className="w-16 h-16 rounded-lg object-cover"
                />
              )}
              <div>
                <h1 className="text-3xl font-bold text-gray-900">{tournament.name}</h1>
                <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                  <div className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    <span>{formatDate(tournament.start_date)}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500">Última atualização</div>
              <div className="text-sm font-medium text-gray-700">
                {lastUpdate.toLocaleTimeString('pt-PT')}
              </div>
              <div className="mt-1">
                <span className="inline-flex items-center gap-1 text-xs text-green-600">
                  <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse"></div>
                  AO VIVO
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1 border-b">
            <button
              onClick={() => setActiveTab('schedule')}
              className={`px-6 py-3 font-medium transition-colors ${
                activeTab === 'schedule'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span>Jogos</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('standings')}
              className={`px-6 py-3 font-medium transition-colors ${
                activeTab === 'standings'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4" />
                <span>Classificações</span>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'schedule' ? (
          <div className="space-y-8">
            {Object.entries(groupedMatches).map(([date, dateMatches]) => (
              <div key={date}>
                <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-blue-600" />
                  {date}
                </h2>
                <div className="space-y-3">
                  {dateMatches.map((match) => (
                    <div
                      key={match.id}
                      className={`bg-white rounded-lg shadow-md p-4 transition-all ${
                        match.status === 'in_progress' ? 'ring-2 ring-blue-500' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3 text-sm text-gray-600">
                          <span className="font-semibold">Jogo {match.match_number}</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            {formatTime(match.scheduled_time)}
                          </span>
                          <span className="flex items-center gap-1">
                            <MapPin className="w-4 h-4" />
                            Campo {match.court}
                          </span>
                          {match.round !== 'group_stage' && (
                            <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs font-medium">
                              {match.round}
                            </span>
                          )}
                        </div>
                        {getMatchStatus(match)}
                      </div>

                      <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
                        {/* Team 1 */}
                        <div className="text-right">
                          <div className="font-semibold text-lg text-gray-900">
                            {getEntityName(match, 'team1')}
                          </div>
                        </div>

                        {/* Score */}
                        {(() => {
                          const scores = getMatchScores(match);
                          return (
                            <div className="flex items-center justify-center gap-3 min-w-[100px]">
                              <div
                                className={`text-2xl font-bold ${
                                  match.status === 'completed' && scores.team1 !== null && scores.team2 !== null
                                    ? scores.team1 > scores.team2
                                      ? 'text-green-600'
                                      : 'text-gray-400'
                                    : 'text-gray-900'
                                }`}
                              >
                                {scores.team1 ?? '-'}
                              </div>
                              <div className="text-gray-400">vs</div>
                              <div
                                className={`text-2xl font-bold ${
                                  match.status === 'completed' && scores.team1 !== null && scores.team2 !== null
                                    ? scores.team2 > scores.team1
                                      ? 'text-green-600'
                                      : 'text-gray-400'
                                    : 'text-gray-900'
                                }`}
                              >
                                {scores.team2 ?? '-'}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Team 2 */}
                        <div className="text-left">
                          <div className="font-semibold text-lg text-gray-900">
                            {getEntityName(match, 'team2')}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(groupedStandings).map(([group, groupStandings]) => (
              <div key={group}>
                <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  {group}
                </h2>
                <div className="bg-white rounded-lg shadow-md overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">Pos</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                          {groupStandings[0]?.entity_type === 'team' ? 'Equipa' : 'Jogador'}
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase">V</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase">D</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase">PF</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase">PC</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase">Diff</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase">Pts</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {groupStandings.map((standing) => (
                        <tr
                          key={standing.entity_id}
                          className={`${
                            standing.position <= 2 ? 'bg-green-50' : ''
                          } hover:bg-gray-50 transition-colors`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {standing.position <= 3 && (
                                <Trophy
                                  className={`w-4 h-4 ${
                                    standing.position === 1
                                      ? 'text-yellow-500'
                                      : standing.position === 2
                                      ? 'text-gray-400'
                                      : 'text-orange-600'
                                  }`}
                                />
                              )}
                              <span className="font-semibold">{standing.position}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-medium text-gray-900">{standing.entity_name}</td>
                          <td className="px-4 py-3 text-center text-green-600 font-semibold">{standing.wins}</td>
                          <td className="px-4 py-3 text-center text-red-600 font-semibold">{standing.losses}</td>
                          <td className="px-4 py-3 text-center">{standing.points_for}</td>
                          <td className="px-4 py-3 text-center">{standing.points_against}</td>
                          <td
                            className={`px-4 py-3 text-center font-medium ${
                              standing.points_diff > 0 ? 'text-green-600' : standing.points_diff < 0 ? 'text-red-600' : 'text-gray-600'
                            }`}
                          >
                            {standing.points_diff > 0 ? '+' : ''}
                            {standing.points_diff}
                          </td>
                          <td className="px-4 py-3 text-center font-bold text-blue-600">{standing.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6 text-center text-sm text-gray-600">
          <p>Esta página atualiza automaticamente quando há novos resultados</p>
        </div>
      </div>
    </div>
  );
}
