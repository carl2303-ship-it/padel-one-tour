import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/authContext';
import { useI18n } from '../lib/i18nContext';
import { usePushNotifications } from '../lib/usePushNotifications';
import {
  Calendar,
  Trophy,
  Clock,
  MapPin,
  ChevronRight,
  Target,
  Medal,
  TrendingUp,
  Users,
  History,
  Zap,
  Bell,
  BellOff,
  ExternalLink
} from 'lucide-react';

interface Tournament {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  category?: string;
  enrolled_count?: number;
}

interface Match {
  id: string;
  tournament_id: string;
  tournament_name: string;
  court: string;
  start_time: string;
  team1_name: string;
  team2_name: string;
  score1: number | null;
  score2: number | null;
  status: string;
  round: string;
  is_winner?: boolean;
  set1?: string;
  set2?: string;
  set3?: string;
}

interface LeagueStanding {
  league_id: string;
  league_name: string;
  position: number;
  total_participants: number;
  points: number;
  tournaments_played: number;
}

interface LeagueFullStanding {
  position: number;
  entity_name: string;
  total_points: number;
  tournaments_played: number;
  best_position: number;
  is_current_player: boolean;
}

interface TournamentMatch {
  id: string;
  court: string;
  scheduled_time: string;
  team1_name: string;
  team2_name: string;
  team1_score: number;
  team2_score: number;
  status: string;
  round: string;
  is_winner?: boolean;
}

interface PlayerStats {
  totalMatches: number;
  wins: number;
  losses: number;
  winRate: number;
  tournamentsPlayed: number;
  bestFinish: string;
}

export default function PlayerDashboard() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');
  const [upcomingTournaments, setUpcomingTournaments] = useState<Tournament[]>([]);
  const [openTournaments, setOpenTournaments] = useState<Tournament[]>([]);
  const [pastTournaments, setPastTournaments] = useState<Tournament[]>([]);
  const [upcomingMatches, setUpcomingMatches] = useState<Match[]>([]);
  const [recentMatches, setRecentMatches] = useState<Match[]>([]);
  const [leagueStandings, setLeagueStandings] = useState<LeagueStanding[]>([]);
  const [stats, setStats] = useState<PlayerStats>({
    totalMatches: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    tournamentsPlayed: 0,
    bestFinish: '-'
  });
  const [loading, setLoading] = useState(true);
  const [playerName, setPlayerName] = useState('');
  const [playerAccountId, setPlayerAccountId] = useState<string | null>(null);
  const [viewingTournamentId, setViewingTournamentId] = useState<string | null>(null);
  const [enrolledPlayers, setEnrolledPlayers] = useState<any[]>([]);
  const [viewingStandingsId, setViewingStandingsId] = useState<string | null>(null);
  const [tournamentStandings, setTournamentStandings] = useState<any[]>([]);
  const [viewingLeagueId, setViewingLeagueId] = useState<string | null>(null);
  const [viewingLeagueName, setViewingLeagueName] = useState<string>('');
  const [leagueFullStandings, setLeagueFullStandings] = useState<LeagueFullStanding[]>([]);
  const [tournamentMatches, setTournamentMatches] = useState<TournamentMatch[]>([]);
  const [tournamentDetailTab, setTournamentDetailTab] = useState<'standings' | 'matches'>('standings');
  const [viewingTournamentName, setViewingTournamentName] = useState<string>('');
  const [pastTournamentDetails, setPastTournamentDetails] = useState<Record<string, { standings: any[]; myMatches: any[]; playerPosition?: number; tournamentName: string }>>({});

  const {
    isSubscribed: isPushSubscribed,
    isSupported: isPushSupported,
    loading: pushLoading,
    subscribe: subscribePush,
    unsubscribe: unsubscribePush,
    permission: pushPermission,
  } = usePushNotifications({ playerAccountId: playerAccountId || undefined });

  useEffect(() => {
    if (user) {
      fetchPlayerData();
    }
  }, [user]);

  const fetchPlayerData = async () => {
    setLoading(true);
    await Promise.all([
      fetchPlayerInfo(),
      fetchTournaments(),
      fetchMatches(),
      fetchDashboardFromEdgeFunction(),
    ]);
    setLoading(false);
  };

  const fetchDashboardFromEdgeFunction = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    const { data, error } = await supabase.functions.invoke('get-player-dashboard', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (error) {
      console.error('get-player-dashboard error:', error);
      return;
    }

    if (data?.leagueStandings?.length) {
      setLeagueStandings(data.leagueStandings);
    }
    if (data?.pastTournaments?.length) {
      setPastTournaments(data.pastTournaments.map((t: any) => ({
        id: t.id,
        name: t.name,
        start_date: t.start_date,
        end_date: t.end_date,
        status: t.status,
      })));
      setStats(prev => ({ ...prev, tournamentsPlayed: data.pastTournaments.length }));
    }
    if (data?.pastTournamentDetails && Object.keys(data.pastTournamentDetails).length > 0) {
      setPastTournamentDetails(data.pastTournamentDetails);
    }
  };

  const fetchPlayerInfo = async () => {
    const { data: playerAccount } = await supabase
      .from('player_accounts')
      .select('id, name')
      .eq('user_id', user?.id)
      .maybeSingle();

    if (playerAccount) {
      setPlayerAccountId(playerAccount.id);
      if (playerAccount.name) {
        setPlayerName(playerAccount.name);
      }
    }
  };

  const fetchTournaments = async () => {
    const { data: playerAccount } = await supabase
      .from('player_accounts')
      .select('phone_number, name')
      .eq('user_id', user?.id)
      .maybeSingle();

    let enrolledIds = new Set<string>();

    if (playerAccount) {
      const { data: playersByPhone } = playerAccount.phone_number
        ? await supabase
            .from('players')
            .select('id, tournament_id')
            .eq('phone_number', playerAccount.phone_number)
        : { data: [] };

      const { data: playersByName } = playerAccount.name
        ? await supabase
            .from('players')
            .select('id, tournament_id')
            .ilike('name', playerAccount.name)
        : { data: [] };

      const allPlayersMap = new Map<string, { id: string; tournament_id: string | null }>();
      [...(playersByPhone || []), ...(playersByName || [])].forEach(p => {
        allPlayersMap.set(p.id, p);
      });
      const allPlayers = Array.from(allPlayersMap.values());

      if (allPlayers.length > 0) {
        const playerIds = allPlayers.map(p => p.id);
        const tournamentIds = allPlayers.filter(p => p.tournament_id).map(p => p.tournament_id);

        const { data: individualTournaments } = tournamentIds.length > 0
          ? await supabase
              .from('tournaments')
              .select('id, name, start_date, end_date, status')
              .in('id', tournamentIds)
          : { data: [] };

        const playerConditions = playerIds.map(id => `player1_id.eq.${id},player2_id.eq.${id}`).join(',');

        const { data: teamsData } = playerIds.length > 0
          ? await supabase
              .from('teams')
              .select('tournament_id, tournaments!inner(id, name, start_date, end_date, status)')
              .or(playerConditions)
          : { data: [] };

        const allTournamentData = [
          ...(individualTournaments || []),
          ...(teamsData?.map((t: any) => t.tournaments) || [])
        ];

        const uniqueTournaments = allTournamentData.reduce((acc: any[], tournament: any) => {
          if (!acc.find((t) => t.id === tournament.id)) {
            acc.push(tournament);
          }
          return acc;
        }, []);

        const now = new Date();
        const upcoming: Tournament[] = [];
        const past: Tournament[] = [];

        const uniqueTournamentIds = uniqueTournaments.map(t => t.id);
        const [playersResult, teamsResult] = await Promise.all([
          supabase.from('players').select('tournament_id').in('tournament_id', uniqueTournamentIds),
          supabase.from('teams').select('tournament_id').in('tournament_id', uniqueTournamentIds)
        ]);

        const playerCountMap = new Map<string, number>();
        const teamCountMap = new Map<string, number>();
        (playersResult.data || []).forEach(p => playerCountMap.set(p.tournament_id, (playerCountMap.get(p.tournament_id) || 0) + 1));
        (teamsResult.data || []).forEach(t => teamCountMap.set(t.tournament_id, (teamCountMap.get(t.tournament_id) || 0) + 1));

        const tournamentsWithCounts = uniqueTournaments.map(t => {
          const teamCount = teamCountMap.get(t.id) || 0;
          const playerCount = playerCountMap.get(t.id) || 0;
          return {
            ...t,
            enrolled_count: teamCount > 0 ? teamCount : playerCount
          };
        });

        tournamentsWithCounts.forEach(t => {
          const isOngoingStatus = t.status === 'in_progress' || t.status === 'active';
          const isCompleted = t.status === 'completed' || t.status === 'finished';

          if (isCompleted) {
            past.push(t);
          } else if (isOngoingStatus) {
            upcoming.push(t);
          } else {
            const endDate = new Date(t.end_date + 'T23:59:59');
            if (endDate >= now) {
              upcoming.push(t);
            } else {
              past.push(t);
            }
          }
        });

        upcoming.sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
        past.sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());

        setUpcomingTournaments(upcoming);
        setPastTournaments(past);
        setStats(prev => ({ ...prev, tournamentsPlayed: past.length }));
        enrolledIds = new Set(upcoming.map(t => t.id));
      }
    }

    const today = new Date().toISOString().split('T')[0];
    const { data: openData } = await supabase
      .from('tournaments')
      .select('id, name, start_date, end_date, status')
      .gte('end_date', today)
      .eq('status', 'active') // Apenas ativos, não rascunho
      .order('start_date', { ascending: true })
      .limit(20);
    const open = (openData || []).filter((t: any) => !enrolledIds.has(t.id));
    setOpenTournaments(open);
  };

  const fetchMatches = async () => {
    const { data: playerAccount } = await supabase
      .from('player_accounts')
      .select('phone_number, name')
      .eq('user_id', user?.id)
      .maybeSingle();

    if (!playerAccount) return;

    const { data: playersByPhone } = playerAccount.phone_number
      ? await supabase
          .from('players')
          .select('id')
          .eq('phone_number', playerAccount.phone_number)
      : { data: [] };

    const { data: playersByName } = playerAccount.name
      ? await supabase
          .from('players')
          .select('id')
          .ilike('name', playerAccount.name)
      : { data: [] };

    const playerIdsSet = new Set<string>();
    [...(playersByPhone || []), ...(playersByName || [])].forEach(p => {
      playerIdsSet.add(p.id);
    });
    const playerIds = Array.from(playerIdsSet);

    if (playerIds.length === 0) return;
    const playerConditions = playerIds.map(id => `player1_id.eq.${id},player2_id.eq.${id}`).join(',');

    const { data: teamsData } = await supabase
      .from('teams')
      .select('id')
      .or(playerConditions);

    const teamIds = teamsData?.map((t) => t.id) || [];

    const teamMatchConditions = teamIds.length > 0
      ? `team1_id.in.(${teamIds.join(',')}),team2_id.in.(${teamIds.join(',')})`
      : '';

    const individualMatchConditions = playerIds.map(id =>
      `player1_individual_id.eq.${id},player2_individual_id.eq.${id},player3_individual_id.eq.${id},player4_individual_id.eq.${id}`
    ).join(',');

    const allConditions = [teamMatchConditions, individualMatchConditions]
      .filter(c => c.length > 0)
      .join(',');

    if (!allConditions) return;

    const { data: matchesData } = await supabase
      .from('matches')
      .select(`
        id,
        tournament_id,
        court,
        scheduled_time,
        team1_score_set1,
        team2_score_set1,
        team1_score_set2,
        team2_score_set2,
        team1_score_set3,
        team2_score_set3,
        status,
        round,
        team1_id,
        team2_id,
        player1_individual_id,
        player2_individual_id,
        player3_individual_id,
        player4_individual_id,
        tournaments!inner(name),
        team1:teams!matches_team1_id_fkey(id, name),
        team2:teams!matches_team2_id_fkey(id, name),
        p1:players!matches_player1_individual_id_fkey(id, name),
        p2:players!matches_player2_individual_id_fkey(id, name),
        p3:players!matches_player3_individual_id_fkey(id, name),
        p4:players!matches_player4_individual_id_fkey(id, name)
      `)
      .or(allConditions)
      .order('scheduled_time', { ascending: true });

    if (matchesData) {
      const now = new Date();
      let wins = 0;
      let losses = 0;

      const matches = matchesData.map((m: any) => {
        const isIndividual = m.p1 || m.p2 || m.p3 || m.p4;
        const team1Name = isIndividual
          ? `${m.p1?.name || 'TBD'}${m.p2 ? ' / ' + m.p2.name : ''}`
          : m.team1?.name || 'TBD';
        const team2Name = isIndividual
          ? `${m.p3?.name || 'TBD'}${m.p4 ? ' / ' + m.p4.name : ''}`
          : m.team2?.name || 'TBD';

        // Calculate total sets won
        const team1Sets = [
          (m.team1_score_set1 || 0) > (m.team2_score_set1 || 0) ? 1 : 0,
          (m.team1_score_set2 || 0) > (m.team2_score_set2 || 0) ? 1 : 0,
          (m.team1_score_set3 || 0) > (m.team2_score_set3 || 0) ? 1 : 0,
        ].reduce((a, b) => a + b, 0);

        const team2Sets = [
          (m.team2_score_set1 || 0) > (m.team1_score_set1 || 0) ? 1 : 0,
          (m.team2_score_set2 || 0) > (m.team1_score_set2 || 0) ? 1 : 0,
          (m.team2_score_set3 || 0) > (m.team1_score_set3 || 0) ? 1 : 0,
        ].reduce((a, b) => a + b, 0);

        let isWinner: boolean | undefined;
        if (m.status === 'completed' && (team1Sets > 0 || team2Sets > 0)) {
          const isPlayerInTeam1 = isIndividual
            ? playerIds.includes(m.p1?.id) || playerIds.includes(m.p2?.id)
            : teamIds.includes(m.team1?.id);

          if (isPlayerInTeam1) {
            isWinner = team1Sets > team2Sets;
          } else {
            isWinner = team2Sets > team1Sets;
          }

          if (isWinner) wins++;
          else losses++;
        }

        const set1 = (m.team1_score_set1 !== null && m.team2_score_set1 !== null)
          ? `${m.team1_score_set1}-${m.team2_score_set1}` : undefined;
        const set2 = (m.team1_score_set2 !== null && m.team2_score_set2 !== null && (m.team1_score_set2 > 0 || m.team2_score_set2 > 0))
          ? `${m.team1_score_set2}-${m.team2_score_set2}` : undefined;
        const set3 = (m.team1_score_set3 !== null && m.team2_score_set3 !== null && (m.team1_score_set3 > 0 || m.team2_score_set3 > 0))
          ? `${m.team1_score_set3}-${m.team2_score_set3}` : undefined;

        return {
          id: m.id,
          tournament_id: m.tournament_id,
          tournament_name: m.tournaments.name,
          court: m.court,
          start_time: m.scheduled_time,
          team1_name: team1Name,
          team2_name: team2Name,
          score1: team1Sets,
          score2: team2Sets,
          status: m.status,
          round: m.round || '',
          is_winner: isWinner,
          set1,
          set2,
          set3,
        };
      });

      const upcoming = matches.filter(
        (m) => new Date(m.start_time) >= now && m.status === 'scheduled'
      );
      const recent = matches.filter(
        (m) => m.status === 'completed'
      ).reverse().slice(0, 10);

      setUpcomingMatches(upcoming);
      setRecentMatches(recent);

      const totalMatches = wins + losses;
      setStats(prev => ({
        ...prev,
        totalMatches,
        wins,
        losses,
        winRate: totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0
      }));
    }
  };

  const fetchLeagueStandings = async () => {
    const { data: playerAccount } = await supabase
      .from('player_accounts')
      .select('id, name')
      .eq('user_id', user?.id)
      .maybeSingle();

    if (!playerAccount) return;

    const { data: standings } = await supabase
      .from('league_standings')
      .select(`
        id,
        league_id,
        total_points,
        tournaments_played,
        entity_name,
        player_account_id,
        leagues!inner(id, name)
      `)
      .or(`player_account_id.eq.${playerAccount.id},entity_name.ilike.${playerAccount.name}`)
      .order('total_points', { ascending: false });

    if (standings && standings.length > 0) {
      const leagueData = await Promise.all(
        standings.map(async (s: any) => {
          const leagueId = (s.leagues as any).id;

          const { data: allStandings } = await supabase
            .from('league_standings')
            .select('id, total_points')
            .eq('league_id', leagueId)
            .order('total_points', { ascending: false });

          const position = allStandings
            ? allStandings.findIndex(st => st.id === s.id) + 1
            : 0;

          return {
            league_id: leagueId,
            league_name: (s.leagues as any).name,
            position: position,
            total_participants: allStandings?.length || 0,
            points: s.total_points,
            tournaments_played: s.tournaments_played
          };
        })
      );

      setLeagueStandings(leagueData);
    }
  };

  const viewLeagueStandings = async (leagueId: string, leagueName: string) => {
    setViewingLeagueId(leagueId);
    setViewingLeagueName(leagueName);

    const { data: allStandings } = await supabase
      .from('league_standings')
      .select('entity_name, total_points, tournaments_played, best_position')
      .eq('league_id', leagueId)
      .order('total_points', { ascending: false });

    if (allStandings) {
      const fullStandings: LeagueFullStanding[] = allStandings.map((s, index) => ({
        position: index + 1,
        entity_name: s.entity_name,
        total_points: s.total_points,
        tournaments_played: s.tournaments_played,
        best_position: s.best_position,
        is_current_player: playerName ? s.entity_name.toLowerCase().trim() === playerName.toLowerCase().trim() : false
      }));

      setLeagueFullStandings(fullStandings);
    }
  };

  const viewTournamentPlayers = async (tournamentId: string) => {
    const { data: teams } = await supabase
      .from('teams')
      .select('id, name, player1_id, player2_id, players!teams_player1_id_fkey(name), players_teams_player2_id_fkey:players!teams_player2_id_fkey(name)')
      .eq('tournament_id', tournamentId)
      .order('name');

    if (teams && teams.length > 0) {
      const allEnrolled = teams.map((t: any) => ({
        type: 'team',
        name: t.name,
        player1: t.players?.name,
        player2: t.players_teams_player2_id_fkey?.name
      }));
      setEnrolledPlayers(allEnrolled);
    } else {
      const { data: players } = await supabase
        .from('players')
        .select('id, name')
        .eq('tournament_id', tournamentId)
        .order('name');

      const allEnrolled = (players || []).map(p => ({ type: 'individual', name: p.name }));
      setEnrolledPlayers(allEnrolled);
    }

    setViewingTournamentId(tournamentId);
  };

  const viewTournamentStandings = async (tournamentId: string) => {
    const cached = pastTournamentDetails[tournamentId];
    if (cached) {
      setTournamentStandings(cached.standings);
      setTournamentMatches(cached.myMatches);
      const tournament = pastTournaments.find(t => t.id === tournamentId);
      setViewingTournamentName(cached.tournamentName || tournament?.name || '');
      setViewingStandingsId(tournamentId);
      setTournamentDetailTab('standings');
      return;
    }

    const { data: matches } = await supabase
      .from('matches')
      .select(`
        id,
        team1_id,
        team2_id,
        player1_individual_id,
        player2_individual_id,
        player3_individual_id,
        player4_individual_id,
        team1_score_set1,
        team2_score_set1,
        team1_score_set2,
        team2_score_set2,
        team1_score_set3,
        team2_score_set3,
        status,
        round
      `)
      .eq('tournament_id', tournamentId)
      .eq('status', 'completed');

    const { data: teams } = await supabase
      .from('teams')
      .select('id, name, group_name, final_position')
      .eq('tournament_id', tournamentId);

    const { data: players } = await supabase
      .from('players')
      .select('id, name, group_name')
      .eq('tournament_id', tournamentId);

    const isIndividual = (players?.length || 0) > 0 && (teams?.length || 0) === 0;
    const standings = new Map<string, any>();

    if (isIndividual) {
      players?.forEach(p => {
        standings.set(p.id, {
          id: p.id,
          name: p.name,
          group_name: p.group_name || 'Geral',
          wins: 0,
          losses: 0,
          points_for: 0,
          points_against: 0,
          points: 0
        });
      });

      matches?.forEach(m => {
        const t1s = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
        const t2s = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);

        [m.player1_individual_id, m.player2_individual_id].filter(Boolean).forEach(pid => {
          const s = standings.get(pid!);
          if (s) {
            s.points_for += t1s;
            s.points_against += t2s;
            if (t1s > t2s) { s.wins++; s.points += 2; }
            else { s.losses++; s.points += 1; }
          }
        });

        [m.player3_individual_id, m.player4_individual_id].filter(Boolean).forEach(pid => {
          const s = standings.get(pid!);
          if (s) {
            s.points_for += t2s;
            s.points_against += t1s;
            if (t2s > t1s) { s.wins++; s.points += 2; }
            else { s.losses++; s.points += 1; }
          }
        });
      });
    } else {
      teams?.forEach(t => {
        standings.set(t.id, {
          id: t.id,
          name: t.name,
          group_name: t.group_name || 'Geral',
          final_position: t.final_position,
          wins: 0,
          losses: 0,
          points_for: 0,
          points_against: 0,
          points: 0
        });
      });

      matches?.forEach(m => {
        if (!m.team1_id || !m.team2_id) return;
        const t1s = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
        const t2s = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);

        const s1 = standings.get(m.team1_id);
        const s2 = standings.get(m.team2_id);

        if (s1) {
          s1.points_for += t1s;
          s1.points_against += t2s;
          if (t1s > t2s) { s1.wins++; s1.points += 2; }
          else if (t2s > t1s) { s1.losses++; s1.points += 1; }
        }
        if (s2) {
          s2.points_for += t2s;
          s2.points_against += t1s;
          if (t2s > t1s) { s2.wins++; s2.points += 2; }
          else if (t1s > t2s) { s2.losses++; s2.points += 1; }
        }
      });
    }

    const standingsArray = Array.from(standings.values());
    standingsArray.sort((a, b) => {
      if (a.final_position && b.final_position) return a.final_position - b.final_position;
      if (a.final_position) return -1;
      if (b.final_position) return 1;
      if (b.points !== a.points) return b.points - a.points;
      const diffA = a.points_for - a.points_against;
      const diffB = b.points_for - b.points_against;
      return diffB - diffA;
    });

    setTournamentStandings(standingsArray);

    const tournament = pastTournaments.find(t => t.id === tournamentId);
    setViewingTournamentName(tournament?.name || '');

    const { data: playerAccount } = await supabase
      .from('player_accounts')
      .select('phone_number, name')
      .eq('user_id', user?.id)
      .maybeSingle();

    if (playerAccount) {
      const { data: playersByPhone } = playerAccount.phone_number
        ? await supabase
            .from('players')
            .select('id')
            .eq('phone_number', playerAccount.phone_number)
        : { data: [] };

      const { data: playersByName } = playerAccount.name
        ? await supabase
            .from('players')
            .select('id')
            .ilike('name', playerAccount.name)
        : { data: [] };

      const playerIdsSet = new Set<string>();
      [...(playersByPhone || []), ...(playersByName || [])].forEach(p => {
        playerIdsSet.add(p.id);
      });
      const playerIds = Array.from(playerIdsSet);

      if (playerIds.length > 0) {
        const playerConditions = playerIds.map(id => `player1_id.eq.${id},player2_id.eq.${id}`).join(',');

        const { data: teamsData } = await supabase
          .from('teams')
          .select('id')
          .or(playerConditions);

        const teamIds = teamsData?.map((t) => t.id) || [];

        const teamMatchConditions = teamIds.length > 0
          ? `team1_id.in.(${teamIds.join(',')}),team2_id.in.(${teamIds.join(',')})`
          : '';

        const individualMatchConditions = playerIds.map(id =>
          `player1_individual_id.eq.${id},player2_individual_id.eq.${id},player3_individual_id.eq.${id},player4_individual_id.eq.${id}`
        ).join(',');

        const allConditions = [teamMatchConditions, individualMatchConditions]
          .filter(c => c.length > 0)
          .join(',');

        if (allConditions) {
          const { data: playerMatches } = await supabase
            .from('matches')
            .select(`
              id,
              court,
              scheduled_time,
              team1_score_set1,
              team2_score_set1,
              team1_score_set2,
              team2_score_set2,
              team1_score_set3,
              team2_score_set3,
              status,
              round,
              team1_id,
              team2_id,
              player1_individual_id,
              player2_individual_id,
              player3_individual_id,
              player4_individual_id,
              team1:teams!matches_team1_id_fkey(id, name),
              team2:teams!matches_team2_id_fkey(id, name),
              p1:players!matches_player1_individual_id_fkey(id, name),
              p2:players!matches_player2_individual_id_fkey(id, name),
              p3:players!matches_player3_individual_id_fkey(id, name),
              p4:players!matches_player4_individual_id_fkey(id, name)
            `)
            .eq('tournament_id', tournamentId)
            .or(allConditions)
            .order('scheduled_time', { ascending: true });

          if (playerMatches) {
            const formattedMatches: TournamentMatch[] = playerMatches.map((m: any) => {
              const isIndividualMatch = m.p1 || m.p2 || m.p3 || m.p4;
              const team1Name = isIndividualMatch
                ? `${m.p1?.name || 'TBD'}${m.p2 ? ' / ' + m.p2.name : ''}`
                : m.team1?.name || 'TBD';
              const team2Name = isIndividualMatch
                ? `${m.p3?.name || 'TBD'}${m.p4 ? ' / ' + m.p4.name : ''}`
                : m.team2?.name || 'TBD';

              const team1Sets = [
                (m.team1_score_set1 || 0) > (m.team2_score_set1 || 0) ? 1 : 0,
                (m.team1_score_set2 || 0) > (m.team2_score_set2 || 0) ? 1 : 0,
                (m.team1_score_set3 || 0) > (m.team2_score_set3 || 0) ? 1 : 0,
              ].reduce((a, b) => a + b, 0);

              const team2Sets = [
                (m.team2_score_set1 || 0) > (m.team1_score_set1 || 0) ? 1 : 0,
                (m.team2_score_set2 || 0) > (m.team1_score_set2 || 0) ? 1 : 0,
                (m.team2_score_set3 || 0) > (m.team1_score_set3 || 0) ? 1 : 0,
              ].reduce((a, b) => a + b, 0);

              let isWinner: boolean | undefined;
              if (m.status === 'completed' && (team1Sets > 0 || team2Sets > 0)) {
                const isPlayerInTeam1 = isIndividualMatch
                  ? playerIds.includes(m.p1?.id) || playerIds.includes(m.p2?.id)
                  : teamIds.includes(m.team1?.id);

                isWinner = isPlayerInTeam1 ? team1Sets > team2Sets : team2Sets > team1Sets;
              }

              return {
                id: m.id,
                court: m.court,
                scheduled_time: m.scheduled_time,
                team1_name: team1Name,
                team2_name: team2Name,
                team1_score: team1Sets,
                team2_score: team2Sets,
                status: m.status,
                round: m.round || '',
                is_winner: isWinner,
              };
            });

            setTournamentMatches(formattedMatches);
          }
        }
      }
    }

    setTournamentDetailTab('standings');
    setViewingStandingsId(tournamentId);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}-${month} ${hours}:${minutes}`;
  };

  const getOrdinalSuffix = (n: number) => {
    if (n === 1) return 'o';
    return 'o';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{t.playerDashboard.loading}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-blue-100 text-sm mb-1">{t.playerDashboard.welcomeBack}</p>
            <h1 className="text-3xl font-bold">{playerName || t.playerDashboard.player}</h1>
          </div>
          <div className="flex items-center gap-4">
            {isPushSupported && playerAccountId && (
              <button
                onClick={async () => {
                  if (isPushSubscribed) {
                    await unsubscribePush();
                  } else {
                    await subscribePush();
                  }
                }}
                disabled={pushLoading}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
                  isPushSubscribed
                    ? 'bg-white/20 text-white hover:bg-white/30'
                    : 'bg-white text-blue-600 hover:bg-blue-50'
                } disabled:opacity-50`}
              >
                {pushLoading ? (
                  <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : isPushSubscribed ? (
                  <>
                    <Bell className="w-5 h-5" />
                    <span className="hidden sm:inline">{t.playerDashboard.notificationsActive}</span>
                  </>
                ) : (
                  <>
                    <BellOff className="w-5 h-5" />
                    <span className="hidden sm:inline">{t.playerDashboard.enableAlerts}</span>
                  </>
                )}
              </button>
            )}
            <div className="hidden sm:block">
              <Trophy className="w-16 h-16 text-blue-300 opacity-50" />
            </div>
          </div>
        </div>
        {isPushSupported && playerAccountId && !isPushSubscribed && pushPermission !== 'denied' && (
          <div className="mt-4 p-3 bg-white/10 rounded-lg">
            <p className="text-sm text-blue-100">
              {t.playerDashboard.enableNotifications}
            </p>
          </div>
        )}
        {pushPermission === 'denied' && (
          <div className="mt-4 p-3 bg-yellow-500/20 rounded-lg">
            <p className="text-sm text-yellow-100">
              {t.playerDashboard.notificationsBlocked}
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Target className="w-5 h-5 text-blue-600" />
            </div>
          </div>
          <div className="text-2xl font-bold text-gray-900">{stats.totalMatches}</div>
          <div className="text-sm text-gray-500">{t.playerDashboard.matchesPlayed}</div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
          </div>
          <div className="text-2xl font-bold text-gray-900">{stats.winRate}%</div>
          <div className="text-sm text-gray-500">{t.playerDashboard.winRate}</div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
              <Medal className="w-5 h-5 text-yellow-600" />
            </div>
          </div>
          <div className="text-2xl font-bold text-gray-900">{stats.wins}</div>
          <div className="text-sm text-gray-500">{t.playerDashboard.wins}</div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
              <Trophy className="w-5 h-5 text-orange-600" />
            </div>
          </div>
          <div className="text-2xl font-bold text-gray-900">{pastTournaments.length}</div>
          <div className="text-sm text-gray-500">{t.playerDashboard.tournamentsCompleted}</div>
        </div>
      </div>

      {upcomingMatches.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-5 border-b border-gray-100 bg-gradient-to-r from-green-50 to-emerald-50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <Zap className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">{t.playerDashboard.upcomingMatches}</h2>
                <p className="text-sm text-gray-500">{upcomingMatches.length} {t.playerDashboard.matchesScheduled}</p>
              </div>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {upcomingMatches.slice(0, 5).map((match) => (
              <div key={match.id} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                    {match.tournament_name}
                  </span>
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {t.playerDashboard.court} {match.court}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">{match.team1_name}</p>
                    <p className="text-sm text-gray-500">vs</p>
                    <p className="font-semibold text-gray-900">{match.team2_name}</p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-gray-600">
                      <Clock className="w-4 h-4" />
                      <span className="text-sm font-medium">{formatDateTime(match.start_time)}</span>
                    </div>
                    {match.round && (
                      <span className="text-xs text-gray-400 mt-1 block">{match.round}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Calendar className="w-5 h-5 text-blue-600" />
            </div>
            <h2 className="text-lg font-bold text-gray-900">{t.playerDashboard.myTournaments}</h2>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setActiveTab('upcoming')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'upcoming'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t.playerDashboard.upcoming} ({upcomingTournaments.length})
            </button>
            <button
              onClick={() => setActiveTab('past')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'past'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t.playerDashboard.history} ({pastTournaments.length})
            </button>
          </div>
        </div>

        <div className="divide-y divide-gray-100">
          {activeTab === 'upcoming' && (
            <>
              {upcomingTournaments.length === 0 ? (
                <div className="p-8 text-center">
                  <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">{t.playerDashboard.noUpcomingTournaments}</p>
                  <p className="text-sm text-gray-400 mt-1">{t.playerDashboard.registerToStart}</p>
                </div>
              ) : (
                <div className="p-4">
                  <div className="space-y-2">
                    {upcomingTournaments.map((tournament) => (
                      <div key={tournament.id} className="p-3 bg-white rounded-lg hover:bg-gray-50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <h4 className="font-semibold text-gray-900">{tournament.name}</h4>
                            <div className="flex items-center gap-4 mt-1">
                              <span className="text-sm text-gray-500 flex items-center gap-1">
                                <Calendar className="w-4 h-4" />
                                {formatDate(tournament.start_date)}
                              </span>
                              {tournament.enrolled_count !== undefined && (
                                <span className="text-sm text-blue-600 flex items-center gap-1">
                                  <Users className="w-4 h-4" />
                                  {tournament.enrolled_count} {t.playerDashboard.enrolled}
                                </span>
                              )}
                              {tournament.status === 'in_progress' && (
                                <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                                  {t.playerDashboard.inProgress}
                                </span>
                              )}
                            </div>
                          </div>
                          <a
                            href={`/?register=${tournament.id}&enrolled=1`}
                            className="ml-4 px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors inline-flex items-center gap-1"
                          >
                            <Users className="w-4 h-4" />
                            {t.playerDashboard.viewEnrolledByCategory}
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'past' && (
            <>
              {pastTournaments.length === 0 ? (
                <div className="p-8 text-center">
                  <History className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">{t.playerDashboard.noTournamentHistory}</p>
                </div>
              ) : (
                pastTournaments.map((tournament) => (
                  <div key={tournament.id} className="p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">{tournament.name}</h3>
                        <div className="flex items-center gap-4 mt-1">
                          <span className="text-sm text-gray-500 flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            {formatDate(tournament.start_date)}
                          </span>
                          {tournament.enrolled_count !== undefined && (
                            <span className="text-sm text-blue-600 flex items-center gap-1">
                              <Users className="w-4 h-4" />
                              {tournament.enrolled_count} {t.playerDashboard.participants}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="ml-4">
                        <button
                          onClick={() => viewTournamentStandings(tournament.id)}
                          className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-1"
                        >
                          <Trophy className="w-4 h-4" />
                          {t.playerDashboard.viewStandings}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>

      {/* Torneios Disponíveis */}
      {openTournaments.filter(t => t.status === 'active').length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-5 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <Target className="w-5 h-5 text-green-600" />
              </div>
              <h2 className="text-lg font-bold text-gray-900">Torneios Disponíveis</h2>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {openTournaments
              .filter(t => t.status === 'active')
              .slice(0, 5)
              .map((tournament) => (
                <div key={tournament.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900">{tournament.name}</h4>
                      <span className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                        <Calendar className="w-4 h-4" />
                        {formatDate(tournament.start_date)}
                      </span>
                    </div>
                    <a
                      href={`/?register=${tournament.id}`}
                      className="ml-4 px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors inline-flex items-center gap-1"
                    >
                      {t.playerDashboard.registrationLink}
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {recentMatches.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                  <History className="w-5 h-5 text-orange-600" />
                </div>
                <h2 className="text-lg font-bold text-gray-900">{t.playerDashboard.recentResults}</h2>
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {recentMatches.map((match) => (
                <div key={match.id} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500">{match.tournament_name}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      match.is_winner
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {match.is_winner ? t.playerDashboard.victory : t.playerDashboard.defeat}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm text-gray-700">{match.team1_name}</p>
                      <p className="text-sm text-gray-700">{match.team2_name}</p>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      {match.set1 || match.set2 || match.set3 ? (
                        <div className="flex gap-1.5 text-sm font-medium text-gray-900">
                          {match.set1 && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{match.set1}</span>}
                          {match.set2 && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{match.set2}</span>}
                          {match.set3 && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{match.set3}</span>}
                        </div>
                      ) : (
                        <span className="text-lg font-bold text-gray-900">
                          {match.score1} - {match.score2}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {leagueStandings.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                  <Trophy className="w-5 h-5 text-yellow-600" />
                </div>
                <h2 className="text-lg font-bold text-gray-900">{t.playerDashboard.leagueStandings}</h2>
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {leagueStandings.map((standing, index) => (
                <div key={index} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-900">{standing.league_name}</h3>
                    <div className="flex items-center gap-1">
                      {standing.position <= 3 && (
                        <Medal className={`w-5 h-5 ${
                          standing.position === 1 ? 'text-yellow-500' :
                          standing.position === 2 ? 'text-gray-400' :
                          'text-amber-600'
                        }`} />
                      )}
                      <span className="text-2xl font-bold text-blue-600">
                        {standing.position}{getOrdinalSuffix(standing.position)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <Users className="w-4 h-4" />
                        {t.playerDashboard.of} {standing.total_participants}
                      </span>
                      <span className="flex items-center gap-1">
                        <Target className="w-4 h-4" />
                        {standing.points} {t.playerDashboard.pts}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {standing.tournaments_played} {t.playerDashboard.tournaments}
                      </span>
                    </div>
                    <button
                      onClick={() => viewLeagueStandings(standing.league_id, standing.league_name)}
                      className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                    >
                      {t.playerDashboard.viewAll}
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {recentMatches.length === 0 && leagueStandings.length === 0 && (
          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
            <Trophy className="w-16 h-16 text-gray-200 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{t.playerDashboard.startPlaying}</h3>
            <p className="text-gray-500">
              {t.playerDashboard.registerTournamentsToStart}
            </p>
          </div>
        )}
      </div>

      {viewingTournamentId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">{t.playerDashboard.enrolledPlayers}</h2>
              <button
                onClick={() => setViewingTournamentId(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto max-h-[calc(80vh-80px)]">
              {enrolledPlayers.length === 0 ? (
                <div className="p-8 text-center">
                  <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">{t.playerDashboard.noPlayersEnrolled}</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {enrolledPlayers.map((enrolled, index) => (
                    <div key={index} className="p-4 hover:bg-gray-50">
                      {enrolled.type === 'individual' ? (
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                            <Users className="w-5 h-5 text-blue-600" />
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{enrolled.name}</p>
                            <p className="text-xs text-gray-500">{t.playerDashboard.individual}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                            <Users className="w-5 h-5 text-green-600" />
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{enrolled.name}</p>
                            <p className="text-xs text-gray-500">
                              {enrolled.player1} {enrolled.player2 && `/ ${enrolled.player2}`}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {viewingStandingsId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                    <Trophy className="w-5 h-5 text-yellow-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{viewingTournamentName || t.nav.tournaments}</h2>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setViewingStandingsId(null);
                    setTournamentMatches([]);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setTournamentDetailTab('standings')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    tournamentDetailTab === 'standings'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t.playerDashboard.standings}
                </button>
                <button
                  onClick={() => setTournamentDetailTab('matches')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    tournamentDetailTab === 'matches'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t.playerDashboard.myMatches} ({tournamentMatches.length})
                </button>
              </div>
            </div>
            <div className="overflow-y-auto max-h-[calc(80vh-160px)]">
              {tournamentDetailTab === 'standings' && (
                <>
                  {tournamentStandings.length === 0 ? (
                    <div className="p-8 text-center">
                      <Trophy className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500">{t.playerDashboard.noStandingsData}</p>
                    </div>
                  ) : (
                    <table className="w-full">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">#</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t.playerDashboard.name}</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">{t.standings.won}</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">{t.standings.lost}</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">{t.standings.points}</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">{t.playerDashboard.diff}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {tournamentStandings.map((standing, index) => (
                          <tr key={standing.id} className={`hover:bg-gray-50 ${index < 3 ? 'bg-yellow-50/30' : ''}`}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {index === 0 && <Medal className="w-5 h-5 text-yellow-500" />}
                                {index === 1 && <Medal className="w-5 h-5 text-gray-400" />}
                                {index === 2 && <Medal className="w-5 h-5 text-amber-600" />}
                                {index > 2 && <span className="text-gray-500 w-5 text-center">{index + 1}</span>}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className="font-medium text-gray-900">{standing.name}</span>
                              {standing.group_name && standing.group_name !== 'Geral' && (
                                <span className="ml-2 text-xs text-gray-400">({standing.group_name})</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center text-green-600 font-medium">{standing.wins}</td>
                            <td className="px-4 py-3 text-center text-red-500 font-medium">{standing.losses}</td>
                            <td className="px-4 py-3 text-center font-bold text-blue-600">{standing.points}</td>
                            <td className="px-4 py-3 text-center text-gray-600">
                              {standing.points_for - standing.points_against > 0 ? '+' : ''}
                              {standing.points_for - standing.points_against}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
              {tournamentDetailTab === 'matches' && (
                <>
                  {tournamentMatches.length === 0 ? (
                    <div className="p-8 text-center">
                      <Target className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500">{t.playerDashboard.noMatchesRecorded}</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {tournamentMatches.map((match) => (
                        <div key={match.id} className="p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              {match.round && (
                                <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                                  {match.round}
                                </span>
                              )}
                              <span className="text-xs text-gray-400 flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                {t.playerDashboard.court} {match.court}
                              </span>
                            </div>
                            {match.status === 'completed' && match.is_winner !== undefined && (
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                match.is_winner
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-red-100 text-red-700'
                              }`}>
                                {match.is_winner ? t.playerDashboard.victory : t.playerDashboard.defeat}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <p className="font-medium text-gray-900">{match.team1_name}</p>
                              <p className="text-sm text-gray-500">vs</p>
                              <p className="font-medium text-gray-900">{match.team2_name}</p>
                            </div>
                            <div className="text-right">
                              {match.status === 'completed' ? (
                                <span className="text-2xl font-bold text-gray-900">
                                  {match.team1_score} - {match.team2_score}
                                </span>
                              ) : (
                                <span className="text-sm text-gray-400">
                                  {formatDateTime(match.scheduled_time)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {viewingLeagueId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                  <Trophy className="w-5 h-5 text-yellow-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">{viewingLeagueName}</h2>
              </div>
              <button
                onClick={() => setViewingLeagueId(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto max-h-[calc(80vh-80px)]">
              {leagueFullStandings.length === 0 ? (
                <div className="p-8 text-center">
                  <Trophy className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">{t.playerDashboard.noStandingsData}</p>
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">#</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t.playerDashboard.name}</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">{t.playerDashboard.pts}</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">{t.playerDashboard.tournaments}</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">{t.playerDashboard.best}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {leagueFullStandings.map((standing) => (
                      <tr
                        key={standing.position}
                        className={`hover:bg-gray-50 ${
                          standing.is_current_player
                            ? 'bg-blue-50 border-l-4 border-l-blue-500'
                            : standing.position <= 3
                              ? 'bg-yellow-50/30'
                              : ''
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {standing.position === 1 && <Medal className="w-5 h-5 text-yellow-500" />}
                            {standing.position === 2 && <Medal className="w-5 h-5 text-gray-400" />}
                            {standing.position === 3 && <Medal className="w-5 h-5 text-amber-600" />}
                            {standing.position > 3 && <span className="text-gray-500 w-5 text-center">{standing.position}</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`font-medium ${standing.is_current_player ? 'text-blue-700' : 'text-gray-900'}`}>
                            {standing.entity_name}
                            {standing.is_current_player && (
                              <span className="ml-2 text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">{t.playerDashboard.you}</span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center font-bold text-blue-600">{standing.total_points}</td>
                        <td className="px-4 py-3 text-center text-gray-600">{standing.tournaments_played}</td>
                        <td className="px-4 py-3 text-center text-gray-600">{standing.best_position}{getOrdinalSuffix(standing.best_position)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
