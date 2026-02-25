import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useCustomLogo } from '../lib/useCustomLogo';
import { Trophy, RefreshCw, Zap } from 'lucide-react';

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
  category_id?: string | null;
}

interface Team {
  id: string;
  team_name: string;
  group_name: string | null;
}

interface Player {
  id: string;
  name: string;
  group_name?: string | null;
  category_id?: string | null;
}

interface Category {
  id: string;
  name: string;
}

interface Tournament {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  format: string;
  number_of_courts: number;
  image_url?: string;
  user_id?: string;
}

interface Standing {
  entity_id: string;
  entity_name: string;
  entity_type: string;
  group_name: string;
  wins: number;
  draws: number;
  losses: number;
  points_for: number;
  points_against: number;
  points_diff: number;
  points: number;
  position: number;
}

const getMatchScores = (match: Match): { team1: number | null; team2: number | null } => {
  if (match.team1_score_set1 === null && match.team2_score_set1 === null) {
    return { team1: null, team2: null };
  }
  return {
    team1: (match.team1_score_set1 ?? 0) + (match.team1_score_set2 ?? 0) + (match.team1_score_set3 ?? 0),
    team2: (match.team2_score_set1 ?? 0) + (match.team2_score_set2 ?? 0) + (match.team2_score_set3 ?? 0)
  };
};

const calculateStandings = (matches: Match[], teams: Team[], players: Player[]): Standing[] => {
  const standings = new Map<string, Standing>();
  const isIndividual = teams.length === 0 && players.length > 0;

  if (isIndividual) {
    players.forEach(player => {
      standings.set(player.id, {
        entity_id: player.id,
        entity_name: player.name,
        entity_type: 'player',
        group_name: player.group_name || 'Geral',
        wins: 0, draws: 0, losses: 0,
        points_for: 0, points_against: 0, points_diff: 0,
        points: 0, position: 0
      });
    });

    matches.forEach(match => {
      const scores = getMatchScores(match);
      if (match.status !== 'completed' || scores.team1 === null || scores.team2 === null) return;

      const t1Players = [match.player1_individual_id, match.player2_individual_id].filter(Boolean);
      const t2Players = [match.player3_individual_id, match.player4_individual_id].filter(Boolean);
      const isDraw = scores.team1 === scores.team2;
      const t1Won = scores.team1! > scores.team2!;

      t1Players.forEach(pid => {
        const s = standings.get(pid!);
        if (s) {
          s.points_for += scores.team1!;
          s.points_against += scores.team2!;
          if (isDraw) { s.draws++; s.points += 1; }
          else if (t1Won) { s.wins++; s.points += 2; }
          else { s.losses++; }
          s.points_diff = s.points_for - s.points_against;
        }
      });

      t2Players.forEach(pid => {
        const s = standings.get(pid!);
        if (s) {
          s.points_for += scores.team2!;
          s.points_against += scores.team1!;
          if (isDraw) { s.draws++; s.points += 1; }
          else if (!t1Won) { s.wins++; s.points += 2; }
          else { s.losses++; }
          s.points_diff = s.points_for - s.points_against;
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
        wins: 0, draws: 0, losses: 0,
        points_for: 0, points_against: 0, points_diff: 0,
        points: 0, position: 0
      });
    });

    matches.forEach(match => {
      const scores = getMatchScores(match);
      if (match.status !== 'completed' || scores.team1 === null || scores.team2 === null) return;

      const s1 = standings.get(match.team1_id || '');
      const s2 = standings.get(match.team2_id || '');

      if (s1 && s2) {
        s1.points_for += scores.team1; s1.points_against += scores.team2;
        s2.points_for += scores.team2; s2.points_against += scores.team1;

        if (scores.team1 > scores.team2) {
          s1.wins++; s1.points += 2; s2.losses++;
        } else if (scores.team2 > scores.team1) {
          s2.wins++; s2.points += 2; s1.losses++;
        } else {
          s1.draws++; s1.points += 1; s2.draws++; s2.points += 1;
        }
        s1.points_diff = s1.points_for - s1.points_against;
        s2.points_diff = s2.points_for - s2.points_against;
      }
    });
  }

  const grouped = new Map<string, Standing[]>();
  standings.forEach(s => {
    if (!grouped.has(s.group_name)) grouped.set(s.group_name, []);
    grouped.get(s.group_name)!.push(s);
  });

  const result: Standing[] = [];
  grouped.forEach(groupStandings => {
    groupStandings.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.points !== a.points) return b.points - a.points;
      if (b.points_diff !== a.points_diff) return b.points_diff - a.points_diff;
      if (b.points_for !== a.points_for) return b.points_for - a.points_for;
      return (a.entity_name || '').localeCompare(b.entity_name || '');
    });
    groupStandings.forEach((s, i) => {
      s.position = i + 1;
      result.push(s);
    });
  });

  return result;
};

export default function LiveTournamentView() {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const { logoUrl } = useCustomLogo((tournament as any)?.user_id);
  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [recentlyUpdatedId, setRecentlyUpdatedId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollPaused, setScrollPaused] = useState(false);
  const [activeCategory, setActiveCategory] = useState(0);

  const tournamentId = window.location.pathname.split('/')[2];

  const fetchTournamentData = useCallback(async () => {
    try {
      const { data: tournamentData, error: tErr } = await supabase
        .from('tournaments')
        .select('id, name, start_date, end_date, format, round_robin_type, number_of_courts, image_url, user_id')
        .eq('id', tournamentId)
        .single();
      if (tErr) throw tErr;
      setTournament(tournamentData);

      const { data: catData } = await supabase
        .from('tournament_categories')
        .select('id, name')
        .eq('tournament_id', tournamentId)
        .order('name');
      setCategories(catData || []);

      const { data: matchesData, error: mErr } = await supabase
        .from('matches')
        .select('id, match_number, round, scheduled_time, court, team1_id, team2_id, team1_score_set1, team2_score_set1, team1_score_set2, team2_score_set2, team1_score_set3, team2_score_set3, status, player1_individual_id, player2_individual_id, player3_individual_id, player4_individual_id, category_id')
        .eq('tournament_id', tournamentId)
        .order('match_number', { ascending: true });
      if (mErr) throw mErr;
      setMatches(matchesData || []);

      const { data: teamsData } = await supabase
        .from('teams')
        .select('id, team_name:name, group_name')
        .eq('tournament_id', tournamentId);
      setTeams(teamsData || []);

      const { data: playersData } = await supabase
        .from('players')
        .select('id, name, group_name, category_id')
        .eq('tournament_id', tournamentId);
      setPlayers(playersData || []);

      if (matchesData) {
        setStandings(calculateStandings(matchesData, teamsData || [], playersData || []));
      }

      setLastUpdate(new Date());
      setLoading(false);
    } catch (err) {
      console.error('Error fetching tournament data:', err);
      setError('Erro ao carregar dados do torneio');
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    fetchTournamentData();

    const channel = supabase
      .channel(`live-tv-${tournamentId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'matches',
        filter: `tournament_id=eq.${tournamentId}`
      }, () => {
        fetchTournamentData();
      })
      .subscribe();

    const pollInterval = setInterval(() => {
      fetchTournamentData();
    }, 15000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, [tournamentId, fetchTournamentData]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (categories.length <= 1) return;
    const timer = setInterval(() => {
      setActiveCategory(prev => (prev + 1) % categories.length);
    }, 15000);
    return () => clearInterval(timer);
  }, [categories.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || scrollPaused) return;

    let animFrame: number;
    let scrollSpeed = 0.5;

    const step = () => {
      if (!scrollPaused && el) {
        el.scrollTop += scrollSpeed;
        if (el.scrollTop >= el.scrollHeight - el.clientHeight) {
          el.scrollTop = 0;
        }
      }
      animFrame = requestAnimationFrame(step);
    };

    animFrame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animFrame);
  }, [scrollPaused, matches]);

  const getEntityName = (match: Match, side: 'team1' | 'team2'): string => {
    const isIndividual = teams.length === 0 && players.length > 0;
    if (side === 'team1') {
      if (match.team1_id) return teams.find(t => t.id === match.team1_id)?.team_name || 'TBD';
      if (isIndividual) {
        const p1 = match.player1_individual_id ? players.find(p => p.id === match.player1_individual_id) : null;
        const p2 = match.player2_individual_id ? players.find(p => p.id === match.player2_individual_id) : null;
        const names = [p1?.name, p2?.name].filter(Boolean);
        return names.length > 0 ? names.join(' + ') : 'TBD';
      }
    } else {
      if (match.team2_id) return teams.find(t => t.id === match.team2_id)?.team_name || 'TBD';
      if (isIndividual) {
        const p3 = match.player3_individual_id ? players.find(p => p.id === match.player3_individual_id) : null;
        const p4 = match.player4_individual_id ? players.find(p => p.id === match.player4_individual_id) : null;
        const names = [p3?.name, p4?.name].filter(Boolean);
        return names.length > 0 ? names.join(' + ') : 'TBD';
      }
    }
    return 'TBD';
  };

  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

  const getRoundLabel = (round: string): string => {
    if (round === 'final') return 'FINAL';
    if (round === 'semifinal') return 'MEIA-FINAL';
    if (round === '3rd_place') return '3./4. LUGAR';
    if (round === 'quarterfinal') return 'QUARTOS';
    if (round === 'consolation') return 'CONSOLAÇÃO';
    if (round.startsWith('group_')) return round.replace('group_', 'Grupo ');
    if (round === 'group_stage') return 'Fase Grupos';
    return round;
  };

  const groupedStandings = standings.reduce((acc, s) => {
    if (!acc[s.group_name]) acc[s.group_name] = [];
    acc[s.group_name].push(s);
    return acc;
  }, {} as Record<string, Standing[]>);

  const completedMatches = matches.filter(m => m.status === 'completed');
  const inProgressMatches = matches.filter(m => m.status === 'in_progress');
  const upcomingMatches = matches.filter(m => m.status === 'scheduled');
  const totalMatches = matches.length;
  const completedCount = completedMatches.length;

  const sortedMatchesForScroll = [
    ...inProgressMatches,
    ...completedMatches.sort((a, b) => b.match_number - a.match_number),
    ...upcomingMatches.sort((a, b) => a.match_number - b.match_number),
  ];

  const filteredStandings = categories.length > 1 && categories[activeCategory]
    ? (() => {
        const catId = categories[activeCategory].id;
        const catPlayerIds = new Set(players.filter(p => p.category_id === catId).map(p => p.id));
        return standings.filter(s => catPlayerIds.has(s.entity_id));
      })()
    : standings;

  const filteredGroupedStandings = filteredStandings.reduce((acc, s) => {
    if (!acc[s.group_name]) acc[s.group_name] = [];
    acc[s.group_name].push(s);
    return acc;
  }, {} as Record<string, Standing[]>);

  if (loading) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-16 h-16 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400 text-xl">A carregar torneio...</p>
        </div>
      </div>
    );
  }

  if (error || !tournament) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-red-400 text-2xl">{error || 'Torneio nao encontrado'}</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-950 text-white overflow-hidden flex flex-col">
      <style>{`
        @keyframes slideHighlight {
          0% { background-color: rgba(16, 185, 129, 0.3); }
          50% { background-color: rgba(16, 185, 129, 0.15); }
          100% { background-color: rgba(16, 185, 129, 0.3); }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .match-highlight {
          animation: slideHighlight 1.5s ease-in-out infinite;
        }
        .scroll-container::-webkit-scrollbar { display: none; }
        .scroll-container { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* Header Bar */}
      <div className="flex-shrink-0 bg-gray-900/80 backdrop-blur border-b border-gray-800 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {logoUrl && (
              <img src={logoUrl} alt="Logo" className="h-10 object-contain" />
            )}
            {tournament.image_url && (
              <img src={tournament.image_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
            )}
            <h1 className="text-2xl font-bold tracking-tight">{tournament.name}</h1>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3 text-sm">
              <div className="bg-gray-800 rounded-lg px-3 py-1.5 flex items-center gap-2">
                <span className="text-gray-400">Jogos</span>
                <span className="font-bold text-emerald-400">{completedCount}/{totalMatches}</span>
              </div>
              {inProgressMatches.length > 0 && (
                <div className="bg-emerald-900/50 border border-emerald-700 rounded-lg px-3 py-1.5 flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="font-bold text-emerald-400">{inProgressMatches.length} em jogo</span>
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-400 rounded-full" style={{ animation: 'pulse-dot 1.5s infinite' }} />
                <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">AO VIVO</span>
              </div>
              <div className="text-lg font-mono text-gray-300 tabular-nums">
                {currentTime.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content: Standings Left + Matches Right */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT: Standings Panel */}
        <div className="w-[42%] border-r border-gray-800 flex flex-col overflow-hidden bg-gray-900/40">
          <div className="flex-shrink-0 px-4 py-3 border-b border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-bold">Classificacao</h2>
            </div>
            {categories.length > 1 && (
              <div className="flex gap-1">
                {categories.map((cat, i) => (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategory(i)}
                    className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                      i === activeCategory
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto scroll-container px-4 py-2 space-y-4">
            {Object.entries(filteredGroupedStandings).sort(([a], [b]) => a.localeCompare(b)).map(([group, gs]) => (
              <div key={group}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{group}</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-[11px] uppercase tracking-wider">
                      <th className="text-left pl-2 pr-1 py-1.5 w-6">#</th>
                      <th className="text-left px-1 py-1.5">{gs[0]?.entity_type === 'team' ? 'Equipa' : 'Jogador'}</th>
                      <th className="text-center px-1 py-1.5 w-7">V</th>
                      <th className="text-center px-1 py-1.5 w-7">E</th>
                      <th className="text-center px-1 py-1.5 w-7">D</th>
                      <th className="text-center px-1 py-1.5 w-10">+/-</th>
                      <th className="text-center pl-1 pr-2 py-1.5 w-9">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gs.map((s) => (
                      <tr
                        key={s.entity_id}
                        className={`border-t border-gray-800/50 transition-colors ${
                          s.position <= 2 ? 'bg-emerald-950/30' : ''
                        }`}
                      >
                        <td className="pl-2 pr-1 py-1.5">
                          <div className="flex items-center">
                            {s.position <= 3 ? (
                              <span className={`text-xs font-bold ${
                                s.position === 1 ? 'text-amber-400' : s.position === 2 ? 'text-gray-400' : 'text-orange-500'
                              }`}>
                                {s.position === 1 ? '\u2B50' : s.position === 2 ? '\u25CF' : '\u25CF'}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-600">{s.position}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-1 py-1.5 font-medium text-gray-200 truncate max-w-[160px]">{s.entity_name}</td>
                        <td className="text-center px-1 py-1.5 font-semibold text-emerald-400">{s.wins}</td>
                        <td className="text-center px-1 py-1.5 text-gray-500">{s.draws}</td>
                        <td className="text-center px-1 py-1.5 text-red-400">{s.losses}</td>
                        <td className={`text-center px-1 py-1.5 text-xs font-medium ${
                          s.points_diff > 0 ? 'text-emerald-400' : s.points_diff < 0 ? 'text-red-400' : 'text-gray-600'
                        }`}>
                          {s.points_diff > 0 ? '+' : ''}{s.points_diff}
                        </td>
                        <td className="text-center pl-1 pr-2 py-1.5 font-bold text-white">{s.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

            {Object.keys(filteredGroupedStandings).length === 0 && (
              <div className="text-center text-gray-600 py-8">Sem dados de classificacao</div>
            )}
          </div>
        </div>

        {/* RIGHT: Match Results - Auto-scrolling */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-shrink-0 px-4 py-3 border-b border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-emerald-400" />
              <h2 className="text-lg font-bold">Resultados</h2>
            </div>
            <div className="text-xs text-gray-500">
              Atualizado: {lastUpdate.toLocaleTimeString('pt-PT')}
            </div>
          </div>

          <div
            ref={scrollRef}
            className="flex-1 overflow-auto scroll-container"
            onMouseEnter={() => setScrollPaused(true)}
            onMouseLeave={() => setScrollPaused(false)}
            onTouchStart={() => setScrollPaused(true)}
            onTouchEnd={() => setTimeout(() => setScrollPaused(false), 3000)}
          >
            <div className="px-3 py-2 space-y-1.5">
              {sortedMatchesForScroll.map((match) => {
                const scores = getMatchScores(match);
                const isCompleted = match.status === 'completed';
                const isLive = match.status === 'in_progress';
                const isUpdated = match.id === recentlyUpdatedId;
                const t1Won = isCompleted && scores.team1 !== null && scores.team2 !== null && scores.team1 > scores.team2;
                const t2Won = isCompleted && scores.team1 !== null && scores.team2 !== null && scores.team2 > scores.team1;

                return (
                  <div
                    key={match.id}
                    className={`rounded-lg px-3 py-2.5 transition-all ${
                      isLive
                        ? 'bg-emerald-950/50 border border-emerald-700/60'
                        : isUpdated
                        ? 'match-highlight border border-emerald-600/40 rounded-lg'
                        : isCompleted
                        ? 'bg-gray-900/60 border border-gray-800/60'
                        : 'bg-gray-900/30 border border-gray-800/30'
                    }`}
                  >
                    {/* Match header */}
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        {isLive && (
                          <span className="flex items-center gap-1 bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                            <div className="w-1.5 h-1.5 bg-white rounded-full" style={{ animation: 'pulse-dot 1s infinite' }} />
                            LIVE
                          </span>
                        )}
                        <span className="text-[11px] text-gray-500 font-medium">#{match.match_number}</span>
                        <span className="text-[11px] text-gray-600">{formatTime(match.scheduled_time)}</span>
                        <span className="text-[11px] text-gray-600">C{match.court}</span>
                        {match.round !== 'group_stage' && !match.round.startsWith('group_') && (
                          <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                            {getRoundLabel(match.round)}
                          </span>
                        )}
                        {match.round.startsWith('group_') && match.round !== 'group_stage' && (
                          <span className="text-[10px] font-medium text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                            {getRoundLabel(match.round)}
                          </span>
                        )}
                      </div>
                      {isCompleted && (
                        <span className="text-[10px] text-gray-500 font-medium">FIM</span>
                      )}
                    </div>

                    {/* Score row */}
                    <div className="flex items-center gap-2">
                      <div className={`flex-1 text-right text-sm truncate ${
                        t1Won ? 'text-white font-bold' : isCompleted ? 'text-gray-500' : 'text-gray-300'
                      }`}>
                        {getEntityName(match, 'team1')}
                      </div>

                      <div className="flex-shrink-0 flex items-center gap-1 bg-gray-800/80 rounded px-2.5 py-1 min-w-[70px] justify-center">
                        <span className={`text-lg font-bold tabular-nums ${
                          t1Won ? 'text-emerald-400' : isCompleted ? 'text-gray-500' : 'text-gray-400'
                        }`}>
                          {scores.team1 ?? '-'}
                        </span>
                        <span className="text-gray-600 text-xs mx-0.5">:</span>
                        <span className={`text-lg font-bold tabular-nums ${
                          t2Won ? 'text-emerald-400' : isCompleted ? 'text-gray-500' : 'text-gray-400'
                        }`}>
                          {scores.team2 ?? '-'}
                        </span>
                      </div>

                      <div className={`flex-1 text-left text-sm truncate ${
                        t2Won ? 'text-white font-bold' : isCompleted ? 'text-gray-500' : 'text-gray-300'
                      }`}>
                        {getEntityName(match, 'team2')}
                      </div>
                    </div>

                    {/* Set details for completed */}
                    {isCompleted && (match.team1_score_set1 !== null || match.team2_score_set1 !== null) && (
                      <div className="flex justify-center gap-3 mt-1">
                        {[
                          [match.team1_score_set1, match.team2_score_set1],
                          [match.team1_score_set2, match.team2_score_set2],
                          [match.team1_score_set3, match.team2_score_set3],
                        ].map(([s1, s2], i) => {
                          if (s1 === null && s2 === null) return null;
                          return (
                            <span key={i} className="text-[10px] text-gray-600 font-mono">
                              {s1 ?? 0}-{s2 ?? 0}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {sortedMatchesForScroll.length === 0 && (
                <div className="text-center text-gray-600 py-12">Sem jogos agendados</div>
              )}

              {/* Spacer for scroll loop */}
              <div className="h-32" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
