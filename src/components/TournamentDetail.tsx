import { useEffect, useState } from 'react';
import { supabase, Tournament, Team, Player, Match, TournamentCategory } from '../lib/supabase';
import { useI18n } from '../lib/i18nContext';
import { ArrowLeft, Users, Calendar, Trophy, Plus, CreditCard as Edit, CalendarClock, Award, Link, Check, Trash2, FolderTree, Pencil, Clock, ChevronDown, Shuffle, Hand, FileDown } from 'lucide-react';
import AddTeamModal from './AddTeamModal';
import AddIndividualPlayerModal from './AddIndividualPlayerModal';
import MatchModal from './MatchModal';
import EditTournamentModal from './EditTournamentModal';
import EditTeamModal from './EditTeamModal';
import EditIndividualPlayerModal from './EditIndividualPlayerModal';
import Standings from './Standings';
import BracketView from './BracketView';
import ManageCategoriesModal from './ManageCategoriesModal';
import MatchScheduleView from './MatchScheduleView';
import { ManualGroupAssignmentModal } from './ManualGroupAssignmentModal';
import { generateTournamentSchedule } from '../lib/scheduler';
import { generateAmericanSchedule } from '../lib/americanScheduler';
import { generateIndividualGroupsKnockoutSchedule } from '../lib/individualGroupsKnockoutScheduler';
import { getTeamsByGroup, getPlayersByGroup } from '../lib/groups';
import { scheduleMultipleCategories } from '../lib/multiCategoryScheduler';
import { updateLeagueStandings, calculateIndividualFinalPositions } from '../lib/leagueStandings';
import { exportTournamentPDF } from '../lib/pdfExport';

type TournamentDetailProps = {
  tournament: Tournament;
  onBack: () => void;
};

type TeamWithPlayers = Team & {
  player1: Player;
  player2: Player;
};

type MatchWithTeams = Match & {
  team1: TeamWithPlayers | null;
  team2: TeamWithPlayers | null;
};

export default function TournamentDetail({ tournament, onBack }: TournamentDetailProps) {
  const { t, language } = useI18n();
  const [teams, setTeams] = useState<TeamWithPlayers[]>([]);
  const [individualPlayers, setIndividualPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<MatchWithTeams[]>([]);
  const [categories, setCategories] = useState<TournamentCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'teams' | 'matches' | 'standings' | 'knockout'>('teams');
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [showEditTournament, setShowEditTournament] = useState(false);
  const [showEditTeam, setShowEditTeam] = useState(false);
  const [showManageCategories, setShowManageCategories] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState<string | undefined>();
  const [selectedTeam, setSelectedTeam] = useState<TeamWithPlayers | undefined>();
  const [selectedPlayer, setSelectedPlayer] = useState<Player | undefined>();
  const [showEditPlayer, setShowEditPlayer] = useState(false);
  const [currentTournament, setCurrentTournament] = useState<Tournament>(tournament);
  const [linkCopied, setLinkCopied] = useState(false);
  const [liveLinkCopied, setLiveLinkCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showManualGroupAssignment, setShowManualGroupAssignment] = useState(false);
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);

  const getCategoryColor = (categoryId: string): string => {
    const categoryColors: { [key: string]: string } = {};
    const colors = [
      '#3B82F6',
      '#10B981',
      '#F59E0B',
      '#EF4444',
      '#8B5CF6',
      '#EC4899',
      '#14B8A6',
      '#F97316',
      '#6366F1',
      '#84CC16'
    ];

    categories.forEach((cat, idx) => {
      categoryColors[cat.id] = colors[idx % colors.length];
    });

    return categoryColors[categoryId] || '#6B7280';
  };

  const handleMatchRealtime = async (payload: any) => {
    const { eventType, new: newRecord, old: oldRecord } = payload;
    console.log('[REALTIME] Match change:', eventType);
    if (eventType === 'UPDATE' && newRecord) {
      setMatches(prev => {
        const updated = prev.map(m => m.id === newRecord.id ? { ...m, ...newRecord } : m);
        // Verificar se precisa avançar playoffs cruzados
        if (newRecord.status === 'completed' && newRecord.round?.startsWith('crossed_')) {
          setTimeout(() => autoAdvanceCrossedPlayoffs(updated), 500);
        }
        return updated;
      });
      setRefreshKey(prev => prev + 1);
    } else {
      fetchTournamentData();
    }
  };

  const handleTeamRealtime = async (payload: any) => {
    const { eventType, new: newRecord } = payload;
    console.log('[REALTIME] Team change:', eventType);
    if (eventType === 'UPDATE' && newRecord) {
      setTeams(prev => prev.map(t => t.id === newRecord.id ? { ...t, ...newRecord } : t));
    } else {
      fetchTournamentData();
    }
  };

  const handlePlayerRealtime = async (payload: any) => {
    const { eventType, new: newRecord } = payload;
    console.log('[REALTIME] Player change:', eventType);
    if (eventType === 'UPDATE' && newRecord) {
      setIndividualPlayers(prev => prev.map(p => p.id === newRecord.id ? { ...p, ...newRecord } : p));
    } else {
      fetchTournamentData();
    }
  };

  useEffect(() => {
    setSelectedCategory(null);
    fetchTournamentData();

    const matchesChannel = supabase
      .channel(`tournament-matches-${tournament.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournament.id}` }, handleMatchRealtime)
      .subscribe();

    const teamsChannel = supabase
      .channel(`tournament-teams-${tournament.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `tournament_id=eq.${tournament.id}` }, handleTeamRealtime)
      .subscribe();

    const playersChannel = supabase
      .channel(`tournament-players-${tournament.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `tournament_id=eq.${tournament.id}` }, handlePlayerRealtime)
      .subscribe();

    return () => {
      supabase.removeChannel(matchesChannel);
      supabase.removeChannel(teamsChannel);
      supabase.removeChannel(playersChannel);
    };
  }, [tournament.id]);

  useEffect(() => {
    const handleClickOutside = () => setShowGroupDropdown(false);
    if (showGroupDropdown) {
      document.addEventListener('click', handleClickOutside);
    }
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showGroupDropdown]);

  const isIndividualRoundRobin = currentTournament?.format === 'round_robin' && currentTournament?.round_robin_type === 'individual';
  const isIndividualGroupsKnockout = currentTournament?.format === 'individual_groups_knockout';

  // Early return if tournament is not loaded
  if (!currentTournament) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
      </div>
    );
  }

  const deleteCourtBookingsForTournament = async (tournamentId: string) => {
    try {
      const { error } = await supabase
        .from('court_bookings')
        .delete()
        .eq('tournament_id', tournamentId);

      if (error) {
        console.error('[COURT BOOKINGS] Error deleting bookings:', error);
      } else {
        console.log('[COURT BOOKINGS] Deleted all tournament bookings');
      }
    } catch (error) {
      console.error('[COURT BOOKINGS] Error deleting:', error);
    }
  };

  const createCourtBookingsForMatches = async (
    matchesData: Array<{ id: string; scheduled_time: string; court: string }>,
    tournamentData: typeof currentTournament
  ) => {
    if (!tournamentData.club_id || !tournamentData.court_names || tournamentData.court_names.length === 0) {
      console.log('[COURT BOOKINGS] No club or court_names configured, skipping bookings');
      return;
    }

    try {
      const { data: clubData } = await supabase
        .from('clubs')
        .select('owner_id')
        .eq('id', tournamentData.club_id)
        .maybeSingle();

      if (!clubData) {
        console.error('[COURT BOOKINGS] Club not found');
        return;
      }

      const { data: clubCourts } = await supabase
        .from('club_courts')
        .select('id, name')
        .eq('user_id', clubData.owner_id)
        .eq('is_active', true);

      if (!clubCourts || clubCourts.length === 0) {
        console.error('[COURT BOOKINGS] No courts found for club');
        return;
      }

      const courtNameToId: Record<string, string> = {};
      clubCourts.forEach(court => {
        courtNameToId[court.name] = court.id;
      });

      const matchDuration = tournamentData.match_duration_minutes || 30;
      const bookingsToCreate = matchesData
        .filter(match => match.court && courtNameToId[match.court])
        .map(match => {
          const startTime = new Date(match.scheduled_time);
          const endTime = new Date(startTime.getTime() + matchDuration * 60000);

          return {
            court_id: courtNameToId[match.court],
            user_id: clubData.owner_id,
            booked_by_name: `Torneio: ${tournamentData.name}`,
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(),
            status: 'confirmed',
            price: 0,
            payment_status: 'paid',
            event_type: 'tournament',
            tournament_match_id: match.id,
            tournament_id: tournamentData.id,
            notes: `Jogo #${match.id.slice(0, 8)} - ${match.court}`,
          };
        });

      if (bookingsToCreate.length > 0) {
        console.log(`[COURT BOOKINGS] Creating ${bookingsToCreate.length} bookings`);
        const { error } = await supabase
          .from('court_bookings')
          .insert(bookingsToCreate);

        if (error) {
          console.error('[COURT BOOKINGS] Error creating bookings:', error);
        } else {
          console.log(`[COURT BOOKINGS] Successfully created ${bookingsToCreate.length} bookings`);
        }
      }
    } catch (error) {
      console.error('[COURT BOOKINGS] Error:', error);
    }
  };

  const isIndividualFormat = () => {
    if (selectedCategory && selectedCategory !== 'no-category') {
      const category = categories.find(c => c.id === selectedCategory);
      if (category) {
        if (category.format === 'individual_groups_knockout') {
          return true;
        }
        if (category.format === 'round_robin') {
          return currentTournament?.round_robin_type === 'individual';
        }
        return false;
      }
    }
    return isIndividualRoundRobin || isIndividualGroupsKnockout;
  };

  const calculateQualificationConfig = (numberOfGroups: number, knockoutStage: string, isIndividual: boolean): {
    qualifiedPerGroup: number;
    extraBestNeeded: number;
    totalQualified: number;
    extraFromPosition: number;
  } => {
    const teamKnockoutSizes: Record<string, number> = {
      'final': 2,
      'semifinals': 4,
      'quarterfinals': 8,
      'round16': 16,
    };

    const individualKnockoutSizes: Record<string, number> = {
      'final': 4,
      'semifinals': 8,
      'quarterfinals': 16,
      'round16': 32,
    };

    const knockoutSizes = isIndividual ? individualKnockoutSizes : teamKnockoutSizes;
    const totalQualified = knockoutSizes[knockoutStage] || (isIndividual ? 8 : 4);
    const qualifiedPerGroup = Math.floor(totalQualified / numberOfGroups);
    const extraBestNeeded = totalQualified - (qualifiedPerGroup * numberOfGroups);
    const extraFromPosition = qualifiedPerGroup + 1;

    console.log(`[CALCULATE_QUALIFIED] Type: ${isIndividual ? 'Individual' : 'Teams'}, Groups: ${numberOfGroups}, Stage: ${knockoutStage}`);
    console.log(`[CALCULATE_QUALIFIED] Total needed: ${totalQualified}, Per group: ${qualifiedPerGroup}, Extra best ${extraFromPosition}th needed: ${extraBestNeeded}`);

    return { qualifiedPerGroup, extraBestNeeded, totalQualified, extraFromPosition };
  };

  const calculateQualifiedPerGroup = (numberOfGroups: number, knockoutStage: string, isIndividual: boolean = false): number => {
    return calculateQualificationConfig(numberOfGroups, knockoutStage, isIndividual).qualifiedPerGroup;
  };

  const filteredTeams = selectedCategory === 'no-category'
    ? teams.filter(t => !t.category_id)
    : selectedCategory
    ? teams.filter(t => t.category_id === selectedCategory)
    : teams;

  const filteredMatches = selectedCategory === 'no-category'
    ? matches.filter(m => !m.category_id)
    : selectedCategory
    ? matches.filter(m => m.category_id === selectedCategory)
    : matches;

  const filteredIndividualPlayers = selectedCategory === 'no-category'
    ? individualPlayers.filter(p => !p.category_id)
    : selectedCategory
    ? individualPlayers.filter(p => p.category_id === selectedCategory)
    : individualPlayers;

  const groupedTeams = getTeamsByGroup(filteredTeams);
  const groupedPlayers = getPlayersByGroup(filteredIndividualPlayers);

  const fetchTournamentData = async () => {
    console.log('[FETCH] Starting fetchTournamentData for tournament:', tournament.id);
    setLoading(true);

    if (isIndividualRoundRobin || isIndividualGroupsKnockout) {
      const [playersResult, matchesResult, categoriesResult] = await Promise.all([
        supabase
          .from('players')
          .select('id, name, email, phone_number, group_name, seed, category_id, user_id, created_at')
          .eq('tournament_id', tournament.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('matches')
          .select('id, match_number, round, scheduled_time, court, team1_id, team2_id, team1_score_set1, team2_score_set1, team1_score_set2, team2_score_set2, team1_score_set3, team2_score_set3, status, category_id, player1_individual_id, player2_individual_id, player3_individual_id, player4_individual_id')
          .eq('tournament_id', tournament.id)
          .order('match_number', { ascending: true }),
        supabase
          .from('tournament_categories')
          .select('id, name, format, number_of_groups, max_teams, knockout_stage, qualified_per_group, rounds')
          .eq('tournament_id', tournament.id)
          .order('name')
      ]);

      if (playersResult.data) {
        console.log('[FETCH] Loaded', playersResult.data.length, 'individual players:', playersResult.data);
        setIndividualPlayers(playersResult.data);
      } else {
        console.error('[FETCH] No individual players data');
      }
      if (matchesResult.data) {
        console.log('[FETCH] Loaded', matchesResult.data.length, 'matches');
        console.log('[FETCH] First match:', matchesResult.data[0]);
        const sortedMatches = (matchesResult.data as unknown as MatchWithTeams[]).sort(
          (a, b) => new Date(a.scheduled_time).getTime() - new Date(b.scheduled_time).getTime()
        );
        setMatches(sortedMatches);
      }
      if (categoriesResult.data) {
        console.log('[FETCH] Loaded', categoriesResult.data.length, 'categories');
        setCategories(categoriesResult.data);
      }
    } else {
      const [teamsResult, playersResult, matchesResult, categoriesResult] = await Promise.all([
        supabase
          .from('teams')
          .select('id, name, group_name, seed, status, category_id, player1_id, player2_id, player1:players!teams_player1_id_fkey(id, name, email, phone_number), player2:players!teams_player2_id_fkey(id, name, email, phone_number)')
          .eq('tournament_id', tournament.id)
          .order('seed', { ascending: true }),
        supabase
          .from('players')
          .select('id, name, email, phone_number, group_name, seed, category_id, user_id, created_at')
          .eq('tournament_id', tournament.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('matches')
          .select(`
            id, match_number, round, scheduled_time, court, team1_id, team2_id, team1_score_set1, team2_score_set1, team1_score_set2, team2_score_set2, team1_score_set3, team2_score_set3, status, category_id,
            team1:teams!matches_team1_id_fkey(id, name, group_name, player1:players!teams_player1_id_fkey(id, name), player2:players!teams_player2_id_fkey(id, name)),
            team2:teams!matches_team2_id_fkey(id, name, group_name, player1:players!teams_player1_id_fkey(id, name), player2:players!teams_player2_id_fkey(id, name))
          `)
          .eq('tournament_id', tournament.id)
          .order('match_number', { ascending: true }),
        supabase
          .from('tournament_categories')
          .select('id, name, format, number_of_groups, max_teams, knockout_stage, qualified_per_group, rounds')
          .eq('tournament_id', tournament.id)
          .order('name')
      ]);

      if (teamsResult.data) {
        console.log('[FETCH] Loaded', teamsResult.data.length, 'teams');
        setTeams(teamsResult.data as unknown as TeamWithPlayers[]);
      }
      if (playersResult.data) {
        console.log('[FETCH] Loaded', playersResult.data.length, 'individual players from categories');
        setIndividualPlayers(playersResult.data);
      }
      if (matchesResult.data) {
        console.log('[FETCH] Loaded', matchesResult.data.length, 'matches');
        const knockoutFetched = matchesResult.data.filter((m: any) => !m.round.startsWith('group_'));
        if (knockoutFetched.length > 0) {
          console.log('[FETCH] Knockout matches:', knockoutFetched.map((m: any) => ({
            round: m.round,
            match_number: m.match_number,
            team1_id: m.team1_id,
            team2_id: m.team2_id,
            team1_name: m.team1?.name,
            team2_name: m.team2?.name
          })));
        }
        const sortedMatches = (matchesResult.data as unknown as MatchWithTeams[]).sort(
          (a, b) => new Date(a.scheduled_time).getTime() - new Date(b.scheduled_time).getTime()
        );
        setMatches(sortedMatches);
      }
      if (categoriesResult.data) {
        console.log('[FETCH] Loaded', categoriesResult.data.length, 'categories');
        setCategories(categoriesResult.data);
      }
    }

    setLoading(false);
    setRefreshKey(prev => prev + 1);
  };

  const handleAssignGroups = async () => {
    if (currentTournament.format !== 'groups_knockout' && currentTournament.format !== 'individual_groups_knockout') {
      alert('Group assignment is only available for Groups + Knockout formats');
      return;
    }

    const isIndividualFormat = currentTournament.format === 'individual_groups_knockout';
    const participantLabel = isIndividualFormat ? 'players' : 'teams';

    const confirmed = confirm(
      `This will randomly assign ${participantLabel} to groups. Any existing group assignments will be overwritten. Continue?`
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      const { data: latestTournament } = await supabase
        .from('tournaments')
        .select('*')
        .eq('id', tournament.id)
        .single();

      if (!latestTournament) {
        throw new Error('Failed to fetch tournament data');
      }

      console.log('[ASSIGN GROUPS] Latest tournament data from DB:', {
        id: latestTournament.id,
        name: latestTournament.name,
        number_of_groups: (latestTournament as any).number_of_groups,
        format: latestTournament.format
      });

      if (isIndividualFormat) {
        const { assignPlayersToGroups, savePlayerGroupAssignments } = await import('../lib/groups');

        if (categories.length > 0) {
          const allPlayersWithGroups: any[] = [];
          const tournamentNumberOfGroups = (latestTournament as any).number_of_groups || 2;
          
          // Para playoffs cruzados (3 categorias), cada categoria = 1 grupo com nome diferente (A, B, C)
          const isCrossedPlayoffs = categories.length === 3;
          
          // Ordenar categorias por nome para consistência (primeira = A, segunda = B, terceira = C)
          const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));

          for (let catIndex = 0; catIndex < sortedCategories.length; catIndex++) {
            const category = sortedCategories[catIndex];
            const categoryPlayers = individualPlayers.filter(p => p.category_id === category.id);
            // Se é playoffs cruzados, forçar 1 grupo por categoria
            const numberOfGroups = isCrossedPlayoffs ? 1 : ((category as any).number_of_groups || tournamentNumberOfGroups);
            const minPlayers = numberOfGroups * 4;
            
            // Nome do grupo: para playoffs cruzados, usar A, B, C baseado na ordem da categoria
            const crossedGroupName = String.fromCharCode(65 + catIndex); // A, B, C

            console.log('[ASSIGN GROUPS] Category:', category.name, 'Number of groups:', numberOfGroups, 'Players:', categoryPlayers.length, 'Crossed playoffs:', isCrossedPlayoffs, 'CrossedGroupName:', crossedGroupName);

            if (categoryPlayers.length < minPlayers) {
              alert(`Category "${category.name}" needs at least ${minPlayers} players for ${numberOfGroups} groups (minimum 4 per group for American format)`);
              setLoading(false);
              return;
            }

            if (isCrossedPlayoffs) {
              // Para playoffs cruzados, atribuir o mesmo grupo a todos os jogadores da categoria
              const playersWithGroups = categoryPlayers.map(player => ({
                ...player,
                group_name: crossedGroupName
              }));
              allPlayersWithGroups.push(...playersWithGroups);
            } else {
              const playersWithGroups = assignPlayersToGroups(categoryPlayers, numberOfGroups);
              allPlayersWithGroups.push(...playersWithGroups);
            }
          }

          await savePlayerGroupAssignments(allPlayersWithGroups);
        } else {
          const numberOfGroups = (latestTournament as any).number_of_groups || 2;
          const minPlayers = numberOfGroups * 4;

          console.log('[ASSIGN GROUPS] Using number_of_groups:', numberOfGroups);

          if (individualPlayers.length < minPlayers) {
            alert(`You need at least ${minPlayers} players for ${numberOfGroups} groups (minimum 4 per group for American format)`);
            setLoading(false);
            return;
          }

          const playersWithGroups = assignPlayersToGroups(individualPlayers, numberOfGroups);
          await savePlayerGroupAssignments(playersWithGroups);
        }

        await fetchTournamentData();
        alert('Players have been randomly assigned to groups!');
      } else {
        const { assignTeamsToGroups, saveGroupAssignments } = await import('../lib/groups');

        if (categories.length > 0) {
          const allTeamsWithGroups: any[] = [];
          const tournamentNumberOfGroups = (latestTournament as any).number_of_groups || 4;

          for (const category of categories) {
            const categoryTeams = teams.filter(t => t.category_id === category.id);
            const numberOfGroups = (category as any).number_of_groups || tournamentNumberOfGroups;
            const minTeams = numberOfGroups * 2;

            console.log('[ASSIGN GROUPS] Category:', category.name, 'Number of groups:', numberOfGroups);

            if (categoryTeams.length < minTeams) {
              alert(`Category "${category.name}" needs at least ${minTeams} teams for ${numberOfGroups} groups`);
              setLoading(false);
              return;
            }

            const teamsWithGroups = assignTeamsToGroups(categoryTeams, numberOfGroups);
            allTeamsWithGroups.push(...teamsWithGroups);
          }

          await saveGroupAssignments(tournament.id, allTeamsWithGroups);
        } else {
          const numberOfGroups = (latestTournament as any).number_of_groups || 4;
          const minTeams = numberOfGroups * 2;

          console.log('[ASSIGN GROUPS] Using number_of_groups:', numberOfGroups);

          if (teams.length < minTeams) {
            alert(`You need at least ${minTeams} teams for ${numberOfGroups} groups`);
            setLoading(false);
            return;
          }

          const teamsWithGroups = assignTeamsToGroups(teams, numberOfGroups);
          await saveGroupAssignments(tournament.id, teamsWithGroups);
        }

        await fetchTournamentData();
        alert('Teams have been randomly assigned to groups!');
      }
    } catch (error) {
      console.error('Error assigning groups:', error);
      alert('Failed to assign groups. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateIndividualFinal = async (categoryId: string) => {
    console.log('[GENERATE_FINAL] Starting for category:', categoryId);

    const categoryMatches = matches.filter(m => m.category_id === categoryId);
    const semifinalMatches = categoryMatches.filter(m => m.round === 'semifinal');
    const finalMatch = categoryMatches.find(m => m.round === 'final');

    if (!finalMatch) {
      alert('Final match not found');
      return;
    }

    const incompleteSemifinals = semifinalMatches.filter(m => m.status !== 'completed');
    if (incompleteSemifinals.length > 0) {
      const confirmed = confirm(
        `There are ${incompleteSemifinals.length} incomplete semifinals. Continue anyway?`
      );
      if (!confirmed) return;
    }

    const winnersPerSemifinal: string[] = [];

    semifinalMatches.forEach(match => {
      if (match.status === 'completed') {
        const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
        const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
        const team1Won = team1Games > team2Games;

        if (team1Won) {
          winnersPerSemifinal.push(match.player1_individual_id!, match.player2_individual_id!);
        } else {
          winnersPerSemifinal.push(match.player3_individual_id!, match.player4_individual_id!);
        }
      }
    });

    if (winnersPerSemifinal.length !== 4) {
      alert('Need 4 winners from semifinals (2 from each semifinal)');
      return;
    }

    const shuffle = (array: string[]) => {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    const shuffledWinners = shuffle(winnersPerSemifinal);

    const confirmed = confirm(
      'This will randomly assign semifinal winners to final teams. Continue?'
    );
    if (!confirmed) return;

    setLoading(true);

    try {
      const { error } = await supabase
        .from('matches')
        .update({
          player1_individual_id: shuffledWinners[0],
          player2_individual_id: shuffledWinners[1],
          player3_individual_id: shuffledWinners[2],
          player4_individual_id: shuffledWinners[3],
        })
        .eq('id', finalMatch.id);

      if (error) throw error;

      await fetchTournamentData();
      alert('Final generated with random teams from semifinal winners!');
    } catch (error) {
      console.error('Error generating final:', error);
      alert('Failed to generate final. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateIndividualKnockout = async (categoryId: string) => {
    console.log('[GENERATE_KNOCKOUT] Starting for category:', categoryId);

    const category = categories.find(c => c.id === categoryId);
    if (!category) {
      alert('Category not found');
      return;
    }

    const categoryMatches = matches.filter(m => m.category_id === categoryId);
    const groupMatches = categoryMatches.filter(m => m.round.startsWith('group_'));
    const categoryPlayers = individualPlayers.filter(p => p.category_id === categoryId);

    const uniqueGroups = new Set(categoryPlayers.map(p => p.group_name).filter(Boolean));
    const numberOfGroups = uniqueGroups.size;
    const knockoutStage = (category as any).knockout_stage || 'semifinals';

    console.log(`[GENERATE_KNOCKOUT] Found ${numberOfGroups} groups, knockout stage: ${knockoutStage}`);

    const qualConfig = calculateQualificationConfig(numberOfGroups, knockoutStage, true);
    const { qualifiedPerGroup, extraBestNeeded, totalQualified, extraFromPosition } = qualConfig;

    console.log(`[GENERATE_KNOCKOUT] Config: ${qualifiedPerGroup} per group + ${extraBestNeeded} best ${extraFromPosition}th = ${totalQualified} total`);

    if ((category as any).qualified_per_group !== qualifiedPerGroup) {
      console.log(`[GENERATE_KNOCKOUT] Updating category qualified_per_group to ${qualifiedPerGroup}`);
      await supabase
        .from('tournament_categories')
        .update({ qualified_per_group: qualifiedPerGroup })
        .eq('id', categoryId);
    }

    const incompleteMatches = groupMatches.filter(m => m.status !== 'completed');
    if (incompleteMatches.length > 0) {
      const confirmed = confirm(
        `There are ${incompleteMatches.length} incomplete group matches. Continue anyway?`
      );
      if (!confirmed) return;
    }

    const playersByGroup = new Map<string, typeof categoryPlayers>();
    categoryPlayers.forEach(player => {
      if (player.group_name) {
        if (!playersByGroup.has(player.group_name)) {
          playersByGroup.set(player.group_name, []);
        }
        playersByGroup.get(player.group_name)!.push(player);
      }
    });

    const qualifiedPlayers: string[] = [];
    const runnersUpCandidates: Array<{ id: string; stats: { wins: number; gamesWon: number; gamesLost: number } }> = [];

    playersByGroup.forEach((groupPlayers, groupName) => {
      const groupMatchList = groupMatches.filter(m =>
        groupPlayers.some(p =>
          p.id === m.player1_individual_id ||
          p.id === m.player2_individual_id ||
          p.id === m.player3_individual_id ||
          p.id === m.player4_individual_id
        )
      );

      const playerStats = new Map<string, { matches: number; wins: number; gamesWon: number; gamesLost: number }>();
      groupPlayers.forEach(player => {
        playerStats.set(player.id, { matches: 0, wins: 0, gamesWon: 0, gamesLost: 0 });
      });

      groupMatchList.forEach(match => {
        if (match.status === 'completed') {
          const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
          const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
          const team1Won = team1Games > team2Games;

          const team1Players = [match.player1_individual_id, match.player2_individual_id].filter(Boolean);
          const team2Players = [match.player3_individual_id, match.player4_individual_id].filter(Boolean);

          team1Players.forEach(playerId => {
            const stats = playerStats.get(playerId!);
            if (stats) {
              stats.matches++;
              stats.gamesWon += team1Games;
              stats.gamesLost += team2Games;
              if (team1Won) stats.wins++;
            }
          });

          team2Players.forEach(playerId => {
            const stats = playerStats.get(playerId!);
            if (stats) {
              stats.matches++;
              stats.gamesWon += team2Games;
              stats.gamesLost += team1Games;
              if (!team1Won) stats.wins++;
            }
          });
        }
      });

      const sortedPlayers = groupPlayers
        .map(player => ({
          ...player,
          stats: playerStats.get(player.id)!
        }))
        .sort((a, b) => {
          if (a.stats.wins !== b.stats.wins) return b.stats.wins - a.stats.wins;
          const diffA = a.stats.gamesWon - a.stats.gamesLost;
          const diffB = b.stats.gamesWon - b.stats.gamesLost;
          return diffB - diffA;
        });

      const topPlayers = sortedPlayers.slice(0, qualifiedPerGroup);
      console.log(`[GENERATE_KNOCKOUT] Group ${groupName} top ${qualifiedPerGroup}:`, topPlayers.map(p => p.name));
      qualifiedPlayers.push(...topPlayers.map(p => p.id));

      if (extraBestNeeded > 0 && sortedPlayers.length >= extraFromPosition) {
        const runnerUp = sortedPlayers[extraFromPosition - 1];
        runnersUpCandidates.push({
          id: runnerUp.id,
          stats: runnerUp.stats
        });
      }
    });

    if (extraBestNeeded > 0) {
      runnersUpCandidates.sort((a, b) => {
        if (a.stats.wins !== b.stats.wins) return b.stats.wins - a.stats.wins;
        const diffA = a.stats.gamesWon - a.stats.gamesLost;
        const diffB = b.stats.gamesWon - b.stats.gamesLost;
        return diffB - diffA;
      });

      const bestRunnersUp = runnersUpCandidates.slice(0, extraBestNeeded);
      console.log(`[GENERATE_KNOCKOUT] Best ${extraFromPosition}th-place:`, bestRunnersUp.map(p => p.id));
      qualifiedPlayers.push(...bestRunnersUp.map(p => p.id));
    }

    if (qualifiedPlayers.length !== totalQualified) {
      alert(`Expected ${totalQualified} qualified players but got ${qualifiedPlayers.length}. Check group standings.`);
      return;
    }

    const sortedGroupNames = Array.from(playersByGroup.keys()).sort();
    const qualifiedByGroup = new Map<string, string[]>();
    sortedGroupNames.forEach(groupName => {
      const groupPlayers = playersByGroup.get(groupName)!;
      const groupMatchList = groupMatches.filter(m =>
        groupPlayers.some(p =>
          p.id === m.player1_individual_id ||
          p.id === m.player2_individual_id ||
          p.id === m.player3_individual_id ||
          p.id === m.player4_individual_id
        )
      );

      const playerStats = new Map<string, { matches: number; wins: number; gamesWon: number; gamesLost: number }>();
      groupPlayers.forEach(player => {
        playerStats.set(player.id, { matches: 0, wins: 0, gamesWon: 0, gamesLost: 0 });
      });

      groupMatchList.forEach(match => {
        if (match.status === 'completed') {
          const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
          const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
          const team1Won = team1Games > team2Games;

          const team1Players = [match.player1_individual_id, match.player2_individual_id].filter(Boolean);
          const team2Players = [match.player3_individual_id, match.player4_individual_id].filter(Boolean);

          team1Players.forEach(playerId => {
            const stats = playerStats.get(playerId!);
            if (stats) {
              stats.matches++;
              stats.gamesWon += team1Games;
              stats.gamesLost += team2Games;
              if (team1Won) stats.wins++;
            }
          });

          team2Players.forEach(playerId => {
            const stats = playerStats.get(playerId!);
            if (stats) {
              stats.matches++;
              stats.gamesWon += team2Games;
              stats.gamesLost += team1Games;
              if (!team1Won) stats.wins++;
            }
          });
        }
      });

      const sortedPlayers = groupPlayers
        .map(player => ({
          ...player,
          stats: playerStats.get(player.id)!
        }))
        .sort((a, b) => {
          if (a.stats.wins !== b.stats.wins) return b.stats.wins - a.stats.wins;
          const diffA = a.stats.gamesWon - a.stats.gamesLost;
          const diffB = b.stats.gamesWon - b.stats.gamesLost;
          return diffB - diffA;
        });

      qualifiedByGroup.set(groupName, sortedPlayers.slice(0, qualifiedPerGroup).map(p => p.id));
    });

    setLoading(true);

    try {
      if (knockoutStage === 'final' && numberOfGroups === 2 && qualifiedPerGroup === 2) {
        const finalMatch = categoryMatches.find(m => m.round === 'final');
        if (!finalMatch) {
          alert('Final match not found');
          setLoading(false);
          return;
        }

        const groupA = sortedGroupNames[0];
        const groupB = sortedGroupNames[1];
        const playersA = qualifiedByGroup.get(groupA)!;
        const playersB = qualifiedByGroup.get(groupB)!;

        const { error: finalError } = await supabase
          .from('matches')
          .update({
            player1_individual_id: playersA[0],
            player2_individual_id: playersB[1],
            player3_individual_id: playersB[0],
            player4_individual_id: playersA[1],
          })
          .eq('id', finalMatch.id);

        if (finalError) throw finalError;

        await fetchTournamentData();
        alert('Final generated: A1+B2 vs B1+A2');
      } else if ((currentTournament as any).mixed_knockout && numberOfGroups === 2) {
        const semifinalMatches = categoryMatches.filter(m => m.round === 'semifinal');
        if (semifinalMatches.length !== 2) {
          alert('Expected exactly 2 semifinal matches for mixed knockout');
          setLoading(false);
          return;
        }

        semifinalMatches.sort((a, b) => a.match_number - b.match_number);

        const sortedGroupNames = Array.from(playersByGroup.keys()).sort();
        const groupA = sortedGroupNames[0];
        const groupB = sortedGroupNames[1];
        const playersA = qualifiedByGroup.get(groupA)!;
        const playersB = qualifiedByGroup.get(groupB)!;

        const confirmed = confirm(
          `Knockout Misto: Formar equipas ${groupA}+${groupB}.\n\n` +
          `Semi 1: ${groupA}1+${groupB}2 vs ${groupA}2+${groupB}1\n` +
          `(Equipas cruzadas para equilibrio)\n\nContinuar?`
        );
        if (!confirmed) {
          setLoading(false);
          return;
        }

        const { error: sf1Error } = await supabase
          .from('matches')
          .update({
            player1_individual_id: playersA[0],
            player2_individual_id: playersB[1],
            player3_individual_id: playersA[1],
            player4_individual_id: playersB[0],
          })
          .eq('id', semifinalMatches[0].id);

        if (sf1Error) throw sf1Error;

        if (playersA.length >= 4 && playersB.length >= 4) {
          const { error: sf2Error } = await supabase
            .from('matches')
            .update({
              player1_individual_id: playersA[2],
              player2_individual_id: playersB[3],
              player3_individual_id: playersA[3],
              player4_individual_id: playersB[2],
            })
            .eq('id', semifinalMatches[1].id);

          if (sf2Error) throw sf2Error;
        }

        await fetchTournamentData();
        alert(`Meias-finais mistas geradas!\n${groupA}1+${groupB}2 vs ${groupA}2+${groupB}1`);
      } else {
        const shuffle = (array: string[]) => {
          const shuffled = [...array];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          return shuffled;
        };

        const shuffledQualified = shuffle(qualifiedPlayers);

        const semifinalMatches = categoryMatches.filter(m => m.round === 'semifinal');
        if (semifinalMatches.length !== 2) {
          alert('Expected exactly 2 semifinal matches');
          setLoading(false);
          return;
        }

        semifinalMatches.sort((a, b) => a.match_number - b.match_number);

        const confirmed = confirm(
          'This will randomly assign qualified players to semifinals. Continue?'
        );
        if (!confirmed) {
          setLoading(false);
          return;
        }

        const { error: sf1Error } = await supabase
          .from('matches')
          .update({
            player1_individual_id: shuffledQualified[0],
            player2_individual_id: shuffledQualified[1],
            player3_individual_id: shuffledQualified[2],
            player4_individual_id: shuffledQualified[3],
          })
          .eq('id', semifinalMatches[0].id);

        if (sf1Error) throw sf1Error;

        const { error: sf2Error } = await supabase
          .from('matches')
          .update({
            player1_individual_id: shuffledQualified[4],
            player2_individual_id: shuffledQualified[5],
            player3_individual_id: shuffledQualified[6],
            player4_individual_id: shuffledQualified[7],
          })
          .eq('id', semifinalMatches[1].id);

        if (sf2Error) throw sf2Error;

        await fetchTournamentData();
        alert('Semifinals generated with random teams!');
      }
    } catch (error) {
      console.error('Error generating knockout:', error);
      alert('Failed to generate knockout. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Função para gerar Playoffs Mistos para 2 CATEGORIAS (ex: FEM + MASC)
  // Estrutura: Semi 1 + Semi 2 + Final + 3º lugar = 4 jogos
  const handleGenerateMixedPlayoffs2Categories = async () => {
    console.log('[MIXED_PLAYOFFS_2CAT] Starting...');

    if (categories.length !== 2) {
      alert(`Playoffs Mistos requer exatamente 2 categorias. Encontradas: ${categories.length}`);
      return;
    }

    // Ordenar categorias por nome para consistência (A=primeira, B=segunda)
    const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));
    const [catA, catB] = sortedCategories;

    console.log(`[MIXED_PLAYOFFS_2CAT] Categorias: ${catA.name} (A), ${catB.name} (B)`);

    // Função para calcular ranking de uma categoria
    const getCategoryRankings = (categoryId: string) => {
      const categoryPlayers = individualPlayers.filter(p => p.category_id === categoryId);
      const categoryMatches = matches.filter(m => 
        m.round.startsWith('group_') && 
        categoryPlayers.some(p => 
          p.id === m.player1_individual_id || 
          p.id === m.player2_individual_id ||
          p.id === m.player3_individual_id ||
          p.id === m.player4_individual_id
        )
      );

      // Calcular stats para cada jogador
      const playerStats = new Map<string, { wins: number; gamesWon: number; gamesLost: number }>();
      categoryPlayers.forEach(p => playerStats.set(p.id, { wins: 0, gamesWon: 0, gamesLost: 0 }));

      categoryMatches.forEach(match => {
        if (match.status === 'completed') {
          const t1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
          const t2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
          const t1Won = t1Games > t2Games;

          [match.player1_individual_id, match.player2_individual_id].forEach(pid => {
            if (pid && playerStats.has(pid)) {
              const stats = playerStats.get(pid)!;
              stats.gamesWon += t1Games;
              stats.gamesLost += t2Games;
              if (t1Won) stats.wins++;
            }
          });

          [match.player3_individual_id, match.player4_individual_id].forEach(pid => {
            if (pid && playerStats.has(pid)) {
              const stats = playerStats.get(pid)!;
              stats.gamesWon += t2Games;
              stats.gamesLost += t1Games;
              if (!t1Won) stats.wins++;
            }
          });
        }
      });

      // Ordenar por: 1. Vitórias, 2. Diferença de jogos, 3. Jogos ganhos
      return categoryPlayers
        .map(p => ({ ...p, stats: playerStats.get(p.id)! }))
        .sort((a, b) => {
          if (b.stats.wins !== a.stats.wins) return b.stats.wins - a.stats.wins;
          const diffA = a.stats.gamesWon - a.stats.gamesLost;
          const diffB = b.stats.gamesWon - b.stats.gamesLost;
          if (diffB !== diffA) return diffB - diffA;
          return b.stats.gamesWon - a.stats.gamesWon;
        });
    };

    const rankA = getCategoryRankings(catA.id);
    const rankB = getCategoryRankings(catB.id);

    console.log(`[MIXED_PLAYOFFS_2CAT] Rankings:`);
    console.log(`  ${catA.name}:`, rankA.map(p => p.name));
    console.log(`  ${catB.name}:`, rankB.map(p => p.name));

    // Verificar se cada categoria tem pelo menos 4 jogadores
    if (rankA.length < 4 || rankB.length < 4) {
      alert(`Cada categoria precisa de pelo menos 4 jogadores classificados.\n${catA.name}: ${rankA.length}, ${catB.name}: ${rankB.length}`);
      return;
    }

    const confirmed = confirm(
      `PLAYOFFS MISTOS - 2 CATEGORIAS\n` +
      `(${catA.name} = A, ${catB.name} = B)\n\n` +
      `MEIAS-FINAIS:\n` +
      `  Semi 1: (${rankA[0].name} + ${rankB[1].name}) vs (${rankA[1].name} + ${rankB[0].name})\n` +
      `  Semi 2: (${rankA[2].name} + ${rankB[3].name}) vs (${rankA[3].name} + ${rankB[2].name})\n\n` +
      `FINAIS:\n` +
      `  Final: Vencedor Semi 1 vs Vencedor Semi 2\n` +
      `  3º Lugar: Perdedor Semi 1 vs Perdedor Semi 2\n\n` +
      `Continuar?`
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      // Verificar se já existem partidas de playoff misto
      const existingPlayoffMatches = matches.filter(m => 
        m.round.startsWith('mixed_') || m.round === 'semifinal' || m.round === 'final' || m.round === '3rd_place'
      );

      if (existingPlayoffMatches.length > 0) {
        alert('Já existem partidas de playoffs. Delete-as primeiro para gerar novas.');
        setLoading(false);
        return;
      }

      const lastMatch = matches.sort((a, b) => b.match_number - a.match_number)[0];
      let matchNumber = (lastMatch?.match_number || 0) + 1;

      // Calcular horário
      const lastCompletedMatch = matches
        .filter(m => m.scheduled_time)
        .sort((a, b) => new Date(b.scheduled_time!).getTime() - new Date(a.scheduled_time!).getTime())[0];
      
      const matchDuration = currentTournament.match_duration || 30;
      let currentTime = lastCompletedMatch?.scheduled_time 
        ? new Date(new Date(lastCompletedMatch.scheduled_time).getTime() + matchDuration * 60000)
        : new Date();

      // MEIAS-FINAIS (2 jogos)
      const semifinalMatches = [
        { // Semi 1: A1+B2 vs A2+B1
          round: 'mixed_semifinal1',
          p1: rankA[0].id, p2: rankB[1].id,
          p3: rankA[1].id, p4: rankB[0].id
        },
        { // Semi 2: A3+B4 vs A4+B3
          round: 'mixed_semifinal2',
          p1: rankA[2].id, p2: rankB[3].id,
          p3: rankA[3].id, p4: rankB[2].id
        }
      ];

      for (let i = 0; i < semifinalMatches.length; i++) {
        const m = semifinalMatches[i];
        const { error } = await supabase.from('matches').insert({
          tournament_id: tournament.id,
          category_id: null, // Misto - não pertence a uma categoria específica
          round: m.round,
          match_number: matchNumber++,
          player1_individual_id: m.p1,
          player2_individual_id: m.p2,
          player3_individual_id: m.p3,
          player4_individual_id: m.p4,
          scheduled_time: currentTime.toISOString(),
          court: String((i % (currentTournament.number_of_courts || 1)) + 1),
          status: 'scheduled'
        });
        if (error) throw error;
        if (i === 0) currentTime = new Date(currentTime.getTime() + matchDuration * 60000);
      }

      // Avançar tempo para finais
      currentTime = new Date(currentTime.getTime() + matchDuration * 60000);

      // FINAIS (2 jogos) - jogadores TBD por agora
      const finalMatches = [
        { round: 'mixed_final' },      // Final
        { round: 'mixed_3rd_place' }   // 3º lugar
      ];

      for (let i = 0; i < finalMatches.length; i++) {
        const m = finalMatches[i];
        const { error } = await supabase.from('matches').insert({
          tournament_id: tournament.id,
          category_id: null,
          round: m.round,
          match_number: matchNumber++,
          player1_individual_id: null,
          player2_individual_id: null,
          player3_individual_id: null,
          player4_individual_id: null,
          scheduled_time: currentTime.toISOString(),
          court: String((i % (currentTournament.number_of_courts || 1)) + 1),
          status: 'scheduled'
        });
        if (error) throw error;
      }

      await fetchTournamentData();
      alert('Playoffs Mistos gerados com sucesso!\n\n4 jogos criados:\n- 2 Meias-Finais\n- Final + 3º Lugar');
    } catch (error) {
      console.error('Error generating mixed playoffs:', error);
      alert('Erro ao gerar playoffs mistos. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // Função para avançar jogadores nos playoffs mistos (2 categorias)
  const handleAdvanceMixedPlayoffs = async () => {
    console.log('[ADVANCE_MIXED] Checking for matches to advance...');

    const sf1 = matches.find(m => m.round === 'mixed_semifinal1');
    const sf2 = matches.find(m => m.round === 'mixed_semifinal2');
    const final = matches.find(m => m.round === 'mixed_final');
    const third = matches.find(m => m.round === 'mixed_3rd_place');

    if (!sf1 || !sf2 || !final || !third) {
      alert('Jogos não encontrados. Tenta refrescar a página.');
      return;
    }

    const getMatchResult = (match: MatchWithTeams) => {
      if (match.status !== 'completed') return null;
      const t1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
      const t2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
      return {
        t1Won: t1Games > t2Games,
        winner: t1Games > t2Games 
          ? { p1: match.player1_individual_id, p2: match.player2_individual_id }
          : { p1: match.player3_individual_id, p2: match.player4_individual_id },
        loser: t1Games > t2Games 
          ? { p1: match.player3_individual_id, p2: match.player4_individual_id }
          : { p1: match.player1_individual_id, p2: match.player2_individual_id }
      };
    };

    setLoading(true);
    let updated = false;

    try {
      // Verificar se meias-finais estão completas e final precisa ser preenchida
      if (sf1.status === 'completed' && sf2.status === 'completed' && !final.player1_individual_id) {
        const result1 = getMatchResult(sf1);
        const result2 = getMatchResult(sf2);

        if (result1 && result2) {
          // Final: vencedores das meias
          await supabase.from('matches').update({
            player1_individual_id: result1.winner.p1,
            player2_individual_id: result1.winner.p2,
            player3_individual_id: result2.winner.p1,
            player4_individual_id: result2.winner.p2
          }).eq('id', final.id);

          // 3º lugar: perdedores das meias
          await supabase.from('matches').update({
            player1_individual_id: result1.loser.p1,
            player2_individual_id: result1.loser.p2,
            player3_individual_id: result2.loser.p1,
            player4_individual_id: result2.loser.p2
          }).eq('id', third.id);

          updated = true;
        }
      }

      if (updated) {
        await fetchTournamentData();
        alert('Jogadores avançados para Final e 3º Lugar!');
      } else {
        alert('Complete as meias-finais primeiro, ou as finais já estão preenchidas.');
      }
    } catch (error) {
      console.error('Error advancing mixed playoffs:', error);
      alert('Erro ao avançar jogadores. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // Função para gerar Playoffs Cruzados ENTRE CATEGORIAS (ex: M3, M4, M5 = grupos A, B, C)
  // Estrutura completa: R1 (3 jogos) + R2 Meias-Finais (3 jogos) + R3 Finais (2 jogos) = 8 jogos total
  const handleGenerateCrossedPlayoffsBetweenCategories = async () => {
    console.log('[CROSSED_PLAYOFFS_CATEGORIES] Starting...');

    if (categories.length !== 3) {
      alert(`Playoffs Cruzados entre categorias requer exatamente 3 categorias. Encontradas: ${categories.length}`);
      return;
    }

    // Ordenar categorias por nome para consistência (A=primeira, B=segunda, C=terceira)
    const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));
    const [catA, catB, catC] = sortedCategories;

    console.log(`[CROSSED_PLAYOFFS_CATEGORIES] Categorias: ${catA.name} (A), ${catB.name} (B), ${catC.name} (C)`);

    // Função para calcular ranking de uma categoria
    const getCategoryRankings = (categoryId: string) => {
      const categoryPlayers = individualPlayers.filter(p => p.category_id === categoryId);
      const categoryMatches = matches.filter(m => 
        m.category_id === categoryId && 
        m.round.startsWith('group_') && 
        m.status === 'completed'
      );

      const playerStats = new Map<string, { id: string; name: string; wins: number; gamesWon: number; gamesLost: number }>();
      
      categoryPlayers.forEach(player => {
        playerStats.set(player.id, { 
          id: player.id, 
          name: player.name, 
          wins: 0, 
          gamesWon: 0, 
          gamesLost: 0 
        });
      });

      categoryMatches.forEach(match => {
        const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
        const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
        const team1Won = team1Games > team2Games;

        const team1Players = [match.player1_individual_id, match.player2_individual_id].filter(Boolean);
        const team2Players = [match.player3_individual_id, match.player4_individual_id].filter(Boolean);

        team1Players.forEach(playerId => {
          const stats = playerStats.get(playerId!);
          if (stats) {
            stats.gamesWon += team1Games;
            stats.gamesLost += team2Games;
            if (team1Won) stats.wins++;
          }
        });

        team2Players.forEach(playerId => {
          const stats = playerStats.get(playerId!);
          if (stats) {
            stats.gamesWon += team2Games;
            stats.gamesLost += team1Games;
            if (!team1Won) stats.wins++;
          }
        });
      });

      return Array.from(playerStats.values())
        .sort((a, b) => {
          if (a.wins !== b.wins) return b.wins - a.wins;
          const diffA = a.gamesWon - a.gamesLost;
          const diffB = b.gamesWon - b.gamesLost;
          return diffB - diffA;
        });
    };

    // Obter rankings de cada categoria
    const rankA = getCategoryRankings(catA.id);
    const rankB = getCategoryRankings(catB.id);
    const rankC = getCategoryRankings(catC.id);

    console.log(`[CROSSED_PLAYOFFS_CATEGORIES] Rankings:`);
    console.log(`  ${catA.name}:`, rankA.map(p => p.name));
    console.log(`  ${catB.name}:`, rankB.map(p => p.name));
    console.log(`  ${catC.name}:`, rankC.map(p => p.name));

    // Verificar se cada categoria tem pelo menos 4 jogadores
    if (rankA.length < 4 || rankB.length < 4 || rankC.length < 4) {
      alert(`Aguarde a finalização das partidas. Necessário pelo menos 4 jogadores classificados por categoria.\n${catA.name}: ${rankA.length}, ${catB.name}: ${rankB.length}, ${catC.name}: ${rankC.length}`);
      return;
    }

    const confirmed = confirm(
      `PLAYOFFS CRUZADOS ENTRE CATEGORIAS\n` +
      `(${catA.name} = A, ${catB.name} = B, ${catC.name} = C)\n\n` +
      `RONDA 1 - Playoffs Cruzados:\n` +
      `  J1: (${rankA[0].name} + ${rankC[3].name}) vs (${rankA[1].name} + ${rankC[2].name})\n` +
      `  J2: (${rankA[2].name} + ${rankB[0].name}) vs (${rankA[3].name} + ${rankB[1].name})\n` +
      `  J3: (${rankB[2].name} + ${rankC[1].name}) vs (${rankB[3].name} + ${rankC[0].name})\n\n` +
      `RONDA 2 - Meias-Finais:\n` +
      `  J4: Vencedor J1 vs Vencedor J2\n` +
      `  J5: Vencedor J3 vs Melhor Perdedor (J1/J2)\n` +
      `  J6: Perdedor J3 vs Pior Perdedor (J1/J2) → 5º/6º\n\n` +
      `RONDA 3 - Finais:\n` +
      `  J7: Final (Vencedor J4 vs Vencedor J5)\n` +
      `  J8: 3º/4º (Perdedor J4 vs Perdedor J5)\n\n` +
      `Continuar?`
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      // Verificar se já existem partidas de playoff cruzado
      const existingPlayoffMatches = matches.filter(m => 
        m.round.startsWith('crossed_r')
      );

      if (existingPlayoffMatches.length > 0) {
        alert('Já existem partidas de playoffs cruzados. Delete-as primeiro para gerar novas.');
        setLoading(false);
        return;
      }

      const lastMatch = matches.sort((a, b) => b.match_number - a.match_number)[0];
      let matchNumber = (lastMatch?.match_number || 0) + 1;

      // Calcular horário para os playoffs
      const completedMatches = matches
        .filter(m => m.scheduled_time)
        .sort((a, b) => new Date(b.scheduled_time!).getTime() - new Date(a.scheduled_time!).getTime());
      
      const matchDuration = currentTournament.match_duration_minutes || 90;
      let currentTime = completedMatches.length > 0 && completedMatches[0].scheduled_time
        ? new Date(new Date(completedMatches[0].scheduled_time).getTime() + matchDuration * 60000)
        : new Date();

      // RONDA 1 - Playoffs Cruzados (3 jogos)
      const r1Matches = [
        { // J1: (A1 + C4) vs (A2 + C3)
          round: 'crossed_r1_j1',
          p1: rankA[0].id, p2: rankC[3].id,
          p3: rankA[1].id, p4: rankC[2].id
        },
        { // J2: (A3 + B1) vs (A4 + B2)
          round: 'crossed_r1_j2',
          p1: rankA[2].id, p2: rankB[0].id,
          p3: rankA[3].id, p4: rankB[1].id
        },
        { // J3: (B3 + C2) vs (B4 + C1)
          round: 'crossed_r1_j3',
          p1: rankB[2].id, p2: rankC[1].id,
          p3: rankB[3].id, p4: rankC[0].id
        }
      ];

      for (let i = 0; i < r1Matches.length; i++) {
        const m = r1Matches[i];
        const { error } = await supabase
          .from('matches')
          .insert({
            tournament_id: tournament.id,
            category_id: null,
            round: m.round,
            match_number: matchNumber++,
            player1_individual_id: m.p1,
            player2_individual_id: m.p2,
            player3_individual_id: m.p3,
            player4_individual_id: m.p4,
            scheduled_time: currentTime.toISOString(),
            court: ((i % (currentTournament.number_of_courts || 1)) + 1).toString(),
            status: 'scheduled',
            team1_score_set1: 0, team2_score_set1: 0,
            team1_score_set2: 0, team2_score_set2: 0,
            team1_score_set3: 0, team2_score_set3: 0,
          });
        if (error) throw error;
        if ((i + 1) % (currentTournament.number_of_courts || 1) === 0) {
          currentTime = new Date(currentTime.getTime() + matchDuration * 60000);
        }
      }

      // Avançar tempo para R2
      currentTime = new Date(currentTime.getTime() + matchDuration * 60000);

      // RONDA 2 - Meias-Finais (3 jogos) - jogadores TBD por agora
      const r2Matches = [
        { round: 'crossed_r2_semifinal1' }, // J4: Vencedor J1 vs Vencedor J2
        { round: 'crossed_r2_semifinal2' }, // J5: Vencedor J3 vs Melhor Perdedor
        { round: 'crossed_r2_5th_place' }   // J6: Perdedor J3 vs Pior Perdedor → 5º/6º
      ];

      for (let i = 0; i < r2Matches.length; i++) {
        const m = r2Matches[i];
        const { error } = await supabase
          .from('matches')
          .insert({
            tournament_id: tournament.id,
            category_id: null,
            round: m.round,
            match_number: matchNumber++,
            player1_individual_id: null,
            player2_individual_id: null,
            player3_individual_id: null,
            player4_individual_id: null,
            scheduled_time: currentTime.toISOString(),
            court: ((i % (currentTournament.number_of_courts || 1)) + 1).toString(),
            status: 'scheduled',
            team1_score_set1: 0, team2_score_set1: 0,
            team1_score_set2: 0, team2_score_set2: 0,
            team1_score_set3: 0, team2_score_set3: 0,
          });
        if (error) throw error;
        if ((i + 1) % (currentTournament.number_of_courts || 1) === 0) {
          currentTime = new Date(currentTime.getTime() + matchDuration * 60000);
        }
      }

      // Avançar tempo para R3
      currentTime = new Date(currentTime.getTime() + matchDuration * 60000);

      // RONDA 3 - Finais (2 jogos)
      const r3Matches = [
        { round: 'crossed_r3_final' },     // J7: Final
        { round: 'crossed_r3_3rd_place' }  // J8: 3º/4º lugar
      ];

      for (let i = 0; i < r3Matches.length; i++) {
        const m = r3Matches[i];
        const { error } = await supabase
          .from('matches')
          .insert({
            tournament_id: tournament.id,
            category_id: null,
            round: m.round,
            match_number: matchNumber++,
            player1_individual_id: null,
            player2_individual_id: null,
            player3_individual_id: null,
            player4_individual_id: null,
            scheduled_time: currentTime.toISOString(),
            court: ((i % (currentTournament.number_of_courts || 1)) + 1).toString(),
            status: 'scheduled',
            team1_score_set1: 0, team2_score_set1: 0,
            team1_score_set2: 0, team2_score_set2: 0,
            team1_score_set3: 0, team2_score_set3: 0,
          });
        if (error) throw error;
        if ((i + 1) % (currentTournament.number_of_courts || 1) === 0) {
          currentTime = new Date(currentTime.getTime() + matchDuration * 60000);
        }
      }

      await fetchTournamentData();
      alert('Playoffs Cruzados gerados com sucesso!\n\n8 jogos criados:\n- R1: 3 jogos (Playoffs Cruzados)\n- R2: 3 jogos (Meias-finais + 5º/6º)\n- R3: 2 jogos (Final + 3º/4º)');
    } catch (error) {
      console.error('Error generating crossed playoffs between categories:', error);
      alert('Erro ao gerar playoffs cruzados. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // Função auxiliar para obter estatísticas dos grupos de um jogador
  const getPlayerGroupStats = (playerId: string) => {
    const player = individualPlayers.find(p => p.id === playerId);
    if (!player) return { wins: 0, gamesWon: 0, gamesLost: 0 };
    
    const categoryMatches = matches.filter(m => 
      m.category_id === player.category_id && 
      m.round.startsWith('group_') && 
      m.status === 'completed'
    );

    let wins = 0, gamesWon = 0, gamesLost = 0;
    
    categoryMatches.forEach(match => {
      const t1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
      const t2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
      const t1Won = t1Games > t2Games;
      
      const isTeam1 = match.player1_individual_id === playerId || match.player2_individual_id === playerId;
      const isTeam2 = match.player3_individual_id === playerId || match.player4_individual_id === playerId;
      
      if (isTeam1) {
        gamesWon += t1Games;
        gamesLost += t2Games;
        if (t1Won) wins++;
      } else if (isTeam2) {
        gamesWon += t2Games;
        gamesLost += t1Games;
        if (!t1Won) wins++;
      }
    });
    
    return { wins, gamesWon, gamesLost };
  };

  // Função para avançar automaticamente os playoffs cruzados
  const autoAdvanceCrossedPlayoffs = async (currentMatches: MatchWithTeams[]) => {
    console.log('[AUTO_ADVANCE] Checking crossed playoffs...');
    
    const r1j1 = currentMatches.find(m => m.round === 'crossed_r1_j1');
    const r1j2 = currentMatches.find(m => m.round === 'crossed_r1_j2');
    const r1j3 = currentMatches.find(m => m.round === 'crossed_r1_j3');
    const sf1 = currentMatches.find(m => m.round === 'crossed_r2_semifinal1');
    const sf2 = currentMatches.find(m => m.round === 'crossed_r2_semifinal2');
    const fifth = currentMatches.find(m => m.round === 'crossed_r2_5th_place');
    const final = currentMatches.find(m => m.round === 'crossed_r3_final');
    const third = currentMatches.find(m => m.round === 'crossed_r3_3rd_place');

    if (!r1j1 || !r1j2 || !r1j3 || !sf1 || !sf2 || !fifth || !final || !third) {
      console.log('[AUTO_ADVANCE] Not all matches found');
      return;
    }

    const getMatchResult = (match: MatchWithTeams) => {
      if (match.status !== 'completed') return null;
      const t1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
      const t2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
      return {
        winner: t1Games > t2Games ? 'team1' : 'team2',
        loser: t1Games > t2Games ? 'team2' : 'team1',
        t1Games,
        t2Games
      };
    };

    try {
      // Se R1 está completo e R2 tem TBD, preencher R2
      if (r1j1.status === 'completed' && r1j2.status === 'completed' && r1j3.status === 'completed' && !sf1.player1_individual_id) {
        console.log('[AUTO_ADVANCE] R1 complete, advancing to R2...');
        
        const res1 = getMatchResult(r1j1)!;
        const res2 = getMatchResult(r1j2)!;
        const res3 = getMatchResult(r1j3)!;

        const loser1Games = res1.loser === 'team1' ? res1.t1Games : res1.t2Games;
        const loser2Games = res2.loser === 'team1' ? res2.t1Games : res2.t2Games;
        
        const bestLoserIsJ1 = loser1Games >= loser2Games;
        const bestLoserMatch = bestLoserIsJ1 ? r1j1 : r1j2;
        const worstLoserMatch = bestLoserIsJ1 ? r1j2 : r1j1;
        const bestLoserResult = bestLoserIsJ1 ? res1 : res2;
        const worstLoserResult = bestLoserIsJ1 ? res2 : res1;

        // SF1: Vencedor J1 vs Vencedor J2
        const winner1 = res1.winner === 'team1' 
          ? { p1: r1j1.player1_individual_id, p2: r1j1.player2_individual_id }
          : { p1: r1j1.player3_individual_id, p2: r1j1.player4_individual_id };
        const winner2 = res2.winner === 'team1'
          ? { p1: r1j2.player1_individual_id, p2: r1j2.player2_individual_id }
          : { p1: r1j2.player3_individual_id, p2: r1j2.player4_individual_id };

        await supabase.from('matches').update({
          player1_individual_id: winner1.p1,
          player2_individual_id: winner1.p2,
          player3_individual_id: winner2.p1,
          player4_individual_id: winner2.p2,
        }).eq('id', sf1.id);

        // SF2: Vencedor J3 vs Melhor Perdedor
        const winner3 = res3.winner === 'team1'
          ? { p1: r1j3.player1_individual_id, p2: r1j3.player2_individual_id }
          : { p1: r1j3.player3_individual_id, p2: r1j3.player4_individual_id };
        const bestLoser = bestLoserResult.loser === 'team1'
          ? { p1: bestLoserMatch.player1_individual_id, p2: bestLoserMatch.player2_individual_id }
          : { p1: bestLoserMatch.player3_individual_id, p2: bestLoserMatch.player4_individual_id };

        await supabase.from('matches').update({
          player1_individual_id: winner3.p1,
          player2_individual_id: winner3.p2,
          player3_individual_id: bestLoser.p1,
          player4_individual_id: bestLoser.p2,
        }).eq('id', sf2.id);

        // 5th place: Perdedor J3 vs Pior Perdedor
        const loser3 = res3.loser === 'team1'
          ? { p1: r1j3.player1_individual_id, p2: r1j3.player2_individual_id }
          : { p1: r1j3.player3_individual_id, p2: r1j3.player4_individual_id };
        const worstLoser = worstLoserResult.loser === 'team1'
          ? { p1: worstLoserMatch.player1_individual_id, p2: worstLoserMatch.player2_individual_id }
          : { p1: worstLoserMatch.player3_individual_id, p2: worstLoserMatch.player4_individual_id };

        await supabase.from('matches').update({
          player1_individual_id: loser3.p1,
          player2_individual_id: loser3.p2,
          player3_individual_id: worstLoser.p1,
          player4_individual_id: worstLoser.p2,
        }).eq('id', fifth.id);

        console.log('[AUTO_ADVANCE] R2 updated!');
      }

      // Se R2 Semi-finais estão completas e R3 tem TBD, preencher R3
      if (sf1.status === 'completed' && sf2.status === 'completed' && !final.player1_individual_id) {
        console.log('[AUTO_ADVANCE] R2 semifinals complete, advancing to R3...');
        
        const resSf1 = getMatchResult(sf1)!;
        const resSf2 = getMatchResult(sf2)!;

        const winnerSf1 = resSf1.winner === 'team1'
          ? { p1: sf1.player1_individual_id, p2: sf1.player2_individual_id }
          : { p1: sf1.player3_individual_id, p2: sf1.player4_individual_id };
        const winnerSf2 = resSf2.winner === 'team1'
          ? { p1: sf2.player1_individual_id, p2: sf2.player2_individual_id }
          : { p1: sf2.player3_individual_id, p2: sf2.player4_individual_id };

        await supabase.from('matches').update({
          player1_individual_id: winnerSf1.p1,
          player2_individual_id: winnerSf1.p2,
          player3_individual_id: winnerSf2.p1,
          player4_individual_id: winnerSf2.p2,
        }).eq('id', final.id);

        const loserSf1 = resSf1.loser === 'team1'
          ? { p1: sf1.player1_individual_id, p2: sf1.player2_individual_id }
          : { p1: sf1.player3_individual_id, p2: sf1.player4_individual_id };
        const loserSf2 = resSf2.loser === 'team1'
          ? { p1: sf2.player1_individual_id, p2: sf2.player2_individual_id }
          : { p1: sf2.player3_individual_id, p2: sf2.player4_individual_id };

        await supabase.from('matches').update({
          player1_individual_id: loserSf1.p1,
          player2_individual_id: loserSf1.p2,
          player3_individual_id: loserSf2.p1,
          player4_individual_id: loserSf2.p2,
        }).eq('id', third.id);

        console.log('[AUTO_ADVANCE] R3 updated!');
      }

      // Refresh data
      await fetchTournamentData();
    } catch (error) {
      console.error('[AUTO_ADVANCE] Error:', error);
    }
  };

  // Função manual para avançar jogadores nos playoffs cruzados (botão)
  const handleAdvanceCrossedPlayoffs = async () => {
    console.log('[ADVANCE_CROSSED] Checking for matches to advance...');
    console.log('[ADVANCE_CROSSED] All crossed matches:', matches.filter(m => m.round.startsWith('crossed_')).map(m => ({ round: m.round, status: m.status, p1: m.player1_individual_id })));

    // Obter todas as partidas de playoffs cruzados
    const r1j1 = matches.find(m => m.round === 'crossed_r1_j1');
    const r1j2 = matches.find(m => m.round === 'crossed_r1_j2');
    const r1j3 = matches.find(m => m.round === 'crossed_r1_j3');
    const sf1 = matches.find(m => m.round === 'crossed_r2_semifinal1');
    const sf2 = matches.find(m => m.round === 'crossed_r2_semifinal2');
    const fifth = matches.find(m => m.round === 'crossed_r2_5th_place');
    const final = matches.find(m => m.round === 'crossed_r3_final');
    const third = matches.find(m => m.round === 'crossed_r3_3rd_place');

    if (!r1j1 || !r1j2 || !r1j3 || !sf1 || !sf2 || !fifth || !final || !third) {
      const missing = [
        !r1j1 && 'J1', !r1j2 && 'J2', !r1j3 && 'J3',
        !sf1 && 'SF1', !sf2 && 'SF2', !fifth && '5th',
        !final && 'Final', !third && '3rd'
      ].filter(Boolean).join(', ');
      alert(`Jogos não encontrados: ${missing}. Tenta refrescar a página.`);
      console.log('[ADVANCE_CROSSED] Missing matches:', missing);
      return;
    }

    console.log('[ADVANCE_CROSSED] R1 status:', { j1: r1j1.status, j2: r1j2.status, j3: r1j3.status });
    console.log('[ADVANCE_CROSSED] R2 TBD:', { sf1: sf1.player1_individual_id, sf2: sf2.player1_individual_id, fifth: fifth.player1_individual_id });

    const getMatchResult = (match: MatchWithTeams) => {
      if (match.status !== 'completed') return null;
      const t1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
      const t2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
      return {
        winner: t1Games > t2Games ? 'team1' : 'team2',
        loser: t1Games > t2Games ? 'team2' : 'team1',
        t1Games,
        t2Games
      };
    };

    setLoading(true);

    try {
      // Se R1 está completo, preencher R2
      if (r1j1.status === 'completed' && r1j2.status === 'completed' && r1j3.status === 'completed') {
        const res1 = getMatchResult(r1j1)!;
        const res2 = getMatchResult(r1j2)!;
        const res3 = getMatchResult(r1j3)!;

        // Determinar melhor e pior perdedor de J1/J2
        const loser1Games = res1.loser === 'team1' ? res1.t1Games : res1.t2Games;
        const loser2Games = res2.loser === 'team1' ? res2.t1Games : res2.t2Games;
        
        const bestLoserIsJ1 = loser1Games >= loser2Games;
        const bestLoserMatch = bestLoserIsJ1 ? r1j1 : r1j2;
        const worstLoserMatch = bestLoserIsJ1 ? r1j2 : r1j1;
        const bestLoserResult = bestLoserIsJ1 ? res1 : res2;
        const worstLoserResult = bestLoserIsJ1 ? res2 : res1;

        // SF1: Vencedor J1 vs Vencedor J2
        if (!sf1.player1_individual_id) {
          const winner1 = res1.winner === 'team1' 
            ? { p1: r1j1.player1_individual_id, p2: r1j1.player2_individual_id }
            : { p1: r1j1.player3_individual_id, p2: r1j1.player4_individual_id };
          const winner2 = res2.winner === 'team1'
            ? { p1: r1j2.player1_individual_id, p2: r1j2.player2_individual_id }
            : { p1: r1j2.player3_individual_id, p2: r1j2.player4_individual_id };

          await supabase.from('matches').update({
            player1_individual_id: winner1.p1,
            player2_individual_id: winner1.p2,
            player3_individual_id: winner2.p1,
            player4_individual_id: winner2.p2,
          }).eq('id', sf1.id);
        }

        // SF2: Vencedor J3 vs Melhor Perdedor
        if (!sf2.player1_individual_id) {
          const winner3 = res3.winner === 'team1'
            ? { p1: r1j3.player1_individual_id, p2: r1j3.player2_individual_id }
            : { p1: r1j3.player3_individual_id, p2: r1j3.player4_individual_id };
          const bestLoser = bestLoserResult.loser === 'team1'
            ? { p1: bestLoserMatch.player1_individual_id, p2: bestLoserMatch.player2_individual_id }
            : { p1: bestLoserMatch.player3_individual_id, p2: bestLoserMatch.player4_individual_id };

          await supabase.from('matches').update({
            player1_individual_id: winner3.p1,
            player2_individual_id: winner3.p2,
            player3_individual_id: bestLoser.p1,
            player4_individual_id: bestLoser.p2,
          }).eq('id', sf2.id);
        }

        // 5th place: Perdedor J3 vs Pior Perdedor
        if (!fifth.player1_individual_id) {
          const loser3 = res3.loser === 'team1'
            ? { p1: r1j3.player1_individual_id, p2: r1j3.player2_individual_id }
            : { p1: r1j3.player3_individual_id, p2: r1j3.player4_individual_id };
          const worstLoser = worstLoserResult.loser === 'team1'
            ? { p1: worstLoserMatch.player1_individual_id, p2: worstLoserMatch.player2_individual_id }
            : { p1: worstLoserMatch.player3_individual_id, p2: worstLoserMatch.player4_individual_id };

          await supabase.from('matches').update({
            player1_individual_id: loser3.p1,
            player2_individual_id: loser3.p2,
            player3_individual_id: worstLoser.p1,
            player4_individual_id: worstLoser.p2,
          }).eq('id', fifth.id);
        }
      }

      // Se R2 Semi-finais estão completas, preencher R3
      if (sf1.status === 'completed' && sf2.status === 'completed') {
        const resSf1 = getMatchResult(sf1)!;
        const resSf2 = getMatchResult(sf2)!;

        // Final: Vencedor SF1 vs Vencedor SF2
        if (!final.player1_individual_id) {
          const winnerSf1 = resSf1.winner === 'team1'
            ? { p1: sf1.player1_individual_id, p2: sf1.player2_individual_id }
            : { p1: sf1.player3_individual_id, p2: sf1.player4_individual_id };
          const winnerSf2 = resSf2.winner === 'team1'
            ? { p1: sf2.player1_individual_id, p2: sf2.player2_individual_id }
            : { p1: sf2.player3_individual_id, p2: sf2.player4_individual_id };

          await supabase.from('matches').update({
            player1_individual_id: winnerSf1.p1,
            player2_individual_id: winnerSf1.p2,
            player3_individual_id: winnerSf2.p1,
            player4_individual_id: winnerSf2.p2,
          }).eq('id', final.id);
        }

        // 3rd place: Perdedor SF1 vs Perdedor SF2
        if (!third.player1_individual_id) {
          const loserSf1 = resSf1.loser === 'team1'
            ? { p1: sf1.player1_individual_id, p2: sf1.player2_individual_id }
            : { p1: sf1.player3_individual_id, p2: sf1.player4_individual_id };
          const loserSf2 = resSf2.loser === 'team1'
            ? { p1: sf2.player1_individual_id, p2: sf2.player2_individual_id }
            : { p1: sf2.player3_individual_id, p2: sf2.player4_individual_id };

          await supabase.from('matches').update({
            player1_individual_id: loserSf1.p1,
            player2_individual_id: loserSf1.p2,
            player3_individual_id: loserSf2.p1,
            player4_individual_id: loserSf2.p2,
          }).eq('id', third.id);
        }
      }

      await fetchTournamentData();
      alert('Jogadores avançados com sucesso!');
    } catch (error) {
      console.error('Error advancing crossed playoffs:', error);
      alert('Erro ao avançar jogadores. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // Função para gerar Playoffs Cruzados (3 grupos: A, B, C) - dentro de uma categoria
  const handleGenerateCrossedPlayoffs = async (categoryId: string) => {
    console.log('[CROSSED_PLAYOFFS] Starting for category:', categoryId);

    const category = categories.find(c => c.id === categoryId);
    if (!category) {
      alert('Categoria não encontrada');
      return;
    }

    const categoryMatches = matches.filter(m => m.category_id === categoryId);
    const groupMatches = categoryMatches.filter(m => m.round.startsWith('group_'));
    const categoryPlayers = individualPlayers.filter(p => p.category_id === categoryId);

    const uniqueGroups = new Set(categoryPlayers.map(p => p.group_name).filter(Boolean));
    const sortedGroupNames = Array.from(uniqueGroups).sort();
    const numberOfGroups = sortedGroupNames.length;

    if (numberOfGroups !== 3) {
      alert(`Playoffs Cruzados requer exatamente 3 grupos. Encontrados: ${numberOfGroups}`);
      return;
    }

    // Calcular estatísticas e classificação de cada grupo
    const playersByGroup = new Map<string, typeof categoryPlayers>();
    categoryPlayers.forEach(player => {
      if (player.group_name) {
        if (!playersByGroup.has(player.group_name)) {
          playersByGroup.set(player.group_name, []);
        }
        playersByGroup.get(player.group_name)!.push(player);
      }
    });

    const rankedByGroup = new Map<string, Array<{ id: string; name: string; stats: { wins: number; gamesWon: number; gamesLost: number } }>>();

    playersByGroup.forEach((groupPlayers, groupName) => {
      const groupMatchList = groupMatches.filter(m =>
        groupPlayers.some(p =>
          p.id === m.player1_individual_id ||
          p.id === m.player2_individual_id ||
          p.id === m.player3_individual_id ||
          p.id === m.player4_individual_id
        )
      );

      const playerStats = new Map<string, { matches: number; wins: number; gamesWon: number; gamesLost: number }>();
      groupPlayers.forEach(player => {
        playerStats.set(player.id, { matches: 0, wins: 0, gamesWon: 0, gamesLost: 0 });
      });

      groupMatchList.forEach(match => {
        if (match.status === 'completed') {
          const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
          const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
          const team1Won = team1Games > team2Games;

          const team1Players = [match.player1_individual_id, match.player2_individual_id].filter(Boolean);
          const team2Players = [match.player3_individual_id, match.player4_individual_id].filter(Boolean);

          team1Players.forEach(playerId => {
            const stats = playerStats.get(playerId!);
            if (stats) {
              stats.matches++;
              stats.gamesWon += team1Games;
              stats.gamesLost += team2Games;
              if (team1Won) stats.wins++;
            }
          });

          team2Players.forEach(playerId => {
            const stats = playerStats.get(playerId!);
            if (stats) {
              stats.matches++;
              stats.gamesWon += team2Games;
              stats.gamesLost += team1Games;
              if (!team1Won) stats.wins++;
            }
          });
        }
      });

      const sortedPlayers = groupPlayers
        .map(player => ({
          id: player.id,
          name: player.name,
          stats: playerStats.get(player.id)!
        }))
        .sort((a, b) => {
          if (a.stats.wins !== b.stats.wins) return b.stats.wins - a.stats.wins;
          const diffA = a.stats.gamesWon - a.stats.gamesLost;
          const diffB = b.stats.gamesWon - b.stats.gamesLost;
          return diffB - diffA;
        });

      rankedByGroup.set(groupName, sortedPlayers);
    });

    // Verificar se cada grupo tem pelo menos 4 jogadores classificados
    const groupA = rankedByGroup.get(sortedGroupNames[0]) || [];
    const groupB = rankedByGroup.get(sortedGroupNames[1]) || [];
    const groupC = rankedByGroup.get(sortedGroupNames[2]) || [];

    if (groupA.length < 4 || groupB.length < 4 || groupC.length < 4) {
      alert(`Aguarde a finalização dos grupos. Necessário pelo menos 4 jogadores por grupo.\nGrupo ${sortedGroupNames[0]}: ${groupA.length}, Grupo ${sortedGroupNames[1]}: ${groupB.length}, Grupo ${sortedGroupNames[2]}: ${groupC.length}`);
      return;
    }

    // A1, A2, A3, A4 = posições 0, 1, 2, 3 do grupo A
    // B1, B2, B3, B4 = posições 0, 1, 2, 3 do grupo B
    // C1, C2, C3, C4 = posições 0, 1, 2, 3 do grupo C

    const playoffMatches = [
      {
        label: 'JOGO 1',
        team1: { p1: groupA[0], p2: groupC[3] }, // A1 + C4
        team2: { p1: groupA[1], p2: groupC[2] }  // A2 + C3
      },
      {
        label: 'JOGO 2',
        team1: { p1: groupA[2], p2: groupB[0] }, // A3 + B1
        team2: { p1: groupA[3], p2: groupB[1] }  // A4 + B2
      },
      {
        label: 'JOGO 3',
        team1: { p1: groupB[2], p2: groupC[1] }, // B3 + C2
        team2: { p1: groupB[3], p2: groupC[0] }  // B4 + C1
      }
    ];

    const confirmed = confirm(
      `Playoffs Cruzados - 3 Grupos:\n\n` +
      `JOGO 1: (${groupA[0].name} + ${groupC[3].name}) vs (${groupA[1].name} + ${groupC[2].name})\n` +
      `JOGO 2: (${groupA[2].name} + ${groupB[0].name}) vs (${groupA[3].name} + ${groupB[1].name})\n` +
      `JOGO 3: (${groupB[2].name} + ${groupC[1].name}) vs (${groupB[3].name} + ${groupC[0].name})\n\n` +
      `Continuar?`
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      // Procurar partidas de playoff existentes ou criar novas
      const existingPlayoffMatches = categoryMatches.filter(m => 
        m.round === 'playoff_r1' || m.round === 'crossed_playoff'
      ).sort((a, b) => a.match_number - b.match_number);

      if (existingPlayoffMatches.length >= 3) {
        // Atualizar partidas existentes
        for (let i = 0; i < 3; i++) {
          const { error } = await supabase
            .from('matches')
            .update({
              player1_individual_id: playoffMatches[i].team1.p1.id,
              player2_individual_id: playoffMatches[i].team1.p2.id,
              player3_individual_id: playoffMatches[i].team2.p1.id,
              player4_individual_id: playoffMatches[i].team2.p2.id,
            })
            .eq('id', existingPlayoffMatches[i].id);

          if (error) throw error;
        }
      } else {
        // Criar novas partidas de playoff
        const lastMatch = categoryMatches.sort((a, b) => b.match_number - a.match_number)[0];
        let matchNumber = (lastMatch?.match_number || 0) + 1;

        // Calcular horário para os playoffs (após última partida de grupo)
        const lastGroupMatch = groupMatches
          .filter(m => m.scheduled_time)
          .sort((a, b) => new Date(b.scheduled_time!).getTime() - new Date(a.scheduled_time!).getTime())[0];
        
        const matchDuration = currentTournament.match_duration_minutes || 90;
        let playoffTime = lastGroupMatch?.scheduled_time 
          ? new Date(new Date(lastGroupMatch.scheduled_time).getTime() + matchDuration * 60000)
          : new Date();

        for (let i = 0; i < 3; i++) {
          const { error } = await supabase
            .from('matches')
            .insert({
              tournament_id: tournament.id,
              category_id: categoryId,
              round: 'crossed_playoff',
              match_number: matchNumber++,
              player1_individual_id: playoffMatches[i].team1.p1.id,
              player2_individual_id: playoffMatches[i].team1.p2.id,
              player3_individual_id: playoffMatches[i].team2.p1.id,
              player4_individual_id: playoffMatches[i].team2.p2.id,
              scheduled_time: playoffTime.toISOString(),
              court: ((i % (currentTournament.number_of_courts || 1)) + 1).toString(),
              status: 'scheduled',
              team1_score_set1: 0,
              team2_score_set1: 0,
              team1_score_set2: 0,
              team2_score_set2: 0,
              team1_score_set3: 0,
              team2_score_set3: 0,
            });

          if (error) throw error;

          // Avançar tempo se usar mesmo campo
          if ((i + 1) % (currentTournament.number_of_courts || 1) === 0) {
            playoffTime = new Date(playoffTime.getTime() + matchDuration * 60000);
          }
        }
      }

      await fetchTournamentData();
      alert('Playoffs Cruzados gerados com sucesso! Todos em campo!');
    } catch (error) {
      console.error('Error generating crossed playoffs:', error);
      alert('Erro ao gerar playoffs cruzados. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(language === 'pt' ? 'pt-PT' : language === 'es' ? 'es-ES' : 'en-US', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const copyRegistrationLink = () => {
    const link = `${window.location.origin}?register=${tournament.id}`;
    navigator.clipboard.writeText(link);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const copyLiveLink = () => {
    const link = `${window.location.origin}/tournament/${tournament.id}/live`;
    navigator.clipboard.writeText(link);
    setLiveLinkCopied(true);
    setTimeout(() => setLiveLinkCopied(false), 2000);
  };

  const handleDeleteTeam = async (teamId: string) => {
    if (!confirm(t.tournament.confirmDeleteTeam)) return;
    
    try {
      const { error } = await supabase.from('teams').delete().eq('id', teamId);
      if (error) throw error;
      await fetchTournamentData();
    } catch (error) {
      console.error('Error deleting team:', error);
      alert('Erro ao eliminar equipa');
    }
  };

  const handleDeletePlayer = async (playerId: string) => {
    if (!confirm(t.tournament.confirmDeletePlayer || 'Tem certeza que deseja eliminar este jogador?')) return;
    
    try {
      const { error } = await supabase.from('players').delete().eq('id', playerId);
      if (error) throw error;
      await fetchTournamentData();
    } catch (error) {
      console.error('Error deleting player:', error);
      alert('Erro ao eliminar jogador');
    }
  };

  const handleGenerateSchedule = async () => {
    if (!confirm(t.tournament.confirmGenerateSchedule)) return;
    
    setLoading(true);
    try {
      const numberOfCourts = currentTournament.number_of_courts || 2;
      const startDate = currentTournament.start_date || new Date().toISOString().split('T')[0];
      const startTime = currentTournament.daily_start_time || '09:00';
      const endTime = currentTournament.daily_end_time || '21:00';
      const matchDuration = currentTournament.match_duration_minutes || 90;
      
      console.log('[SCHEDULE] Generating schedule for format:', currentTournament.format, 'type:', currentTournament.round_robin_type);
      console.log('[SCHEDULE] Config:', { numberOfCourts, startDate, startTime, endTime, matchDuration });
      
      let matchesToInsert: any[] = [];
      
      // Helper to convert "TBD" to null for UUID fields
      const toUuidOrNull = (id: string | undefined | null): string | null => {
        if (!id || id === 'TBD' || id === 'tbd') return null;
        return id;
      };
      
      if (currentTournament.format === 'round_robin' && currentTournament.round_robin_type === 'individual') {
        // Individual Round Robin (Americano SEM grupos) - todos jogam contra todos com parceiros rotativos
        console.log('[SCHEDULE] Using American scheduler (individual round robin) with', individualPlayers.length, 'players');
        
        const playersForSchedule = individualPlayers.map(p => ({
          id: p.id,
          name: p.name || 'Player'
        }));
        
        const americanMatches = generateAmericanSchedule(
          playersForSchedule,
          numberOfCourts,
          startDate,
          startTime,
          endTime,
          matchDuration,
          7 // matches per player
        );
        
        matchesToInsert = americanMatches.map(m => ({
          tournament_id: currentTournament.id,
          round: m.round,
          match_number: m.match_number,
          player1_individual_id: toUuidOrNull(m.player1_id),
          player2_individual_id: toUuidOrNull(m.player2_id),
          player3_individual_id: toUuidOrNull(m.player3_id),
          player4_individual_id: toUuidOrNull(m.player4_id),
          scheduled_time: m.scheduled_time,
          court: m.court,
          status: 'scheduled'
        }));
        
      } else if (currentTournament.format === 'individual_groups_knockout') {
        // Americano COM grupos + eliminatórias
        console.log('[SCHEDULE] Using Individual Groups Knockout scheduler with', individualPlayers.length, 'players');
        
        // Determinar número de grupos
        const groupNames = [...new Set(individualPlayers.map(p => p.group_name).filter(Boolean))];
        const numberOfGroups = groupNames.length || Math.min(Math.floor(individualPlayers.length / 4), 4);
        
        const individualMatches = generateIndividualGroupsKnockoutSchedule(
          individualPlayers,
          numberOfGroups,
          numberOfCourts,
          startDate,
          startTime,
          endTime,
          matchDuration,
          2, // qualified per group
          numberOfGroups >= 4 ? 'quarterfinals' : 'semifinals'
        );
        
        matchesToInsert = individualMatches.map(m => ({
          tournament_id: currentTournament.id,
          round: m.round,
          match_number: m.match_number,
          player1_individual_id: toUuidOrNull(m.player1_id),
          player2_individual_id: toUuidOrNull(m.player2_id),
          player3_individual_id: toUuidOrNull(m.player3_id),
          player4_individual_id: toUuidOrNull(m.player4_id),
          scheduled_time: m.scheduled_time,
          court: m.court,
          status: 'scheduled'
        }));
        
      } else if (currentTournament.format === 'round_robin' && currentTournament.round_robin_type === 'teams') {
        // Equipas Round Robin - todas as equipas jogam contra todas
        console.log('[SCHEDULE] Using Teams Round Robin scheduler with', teams.length, 'teams');
        
        const teamMatches = generateTournamentSchedule(
          teams,
          numberOfCourts,
          startDate,
          'round_robin',
          startTime,
          endTime,
          matchDuration
        );
        
        matchesToInsert = teamMatches.map(m => ({
          tournament_id: currentTournament.id,
          round: m.round,
          match_number: m.match_number,
          team1_id: m.team1_id,
          team2_id: m.team2_id,
          scheduled_time: m.scheduled_time,
          court: m.court,
          status: 'scheduled'
        }));
        
      } else {
        // Torneios de equipas standard
        console.log('[SCHEDULE] Using standard Tournament scheduler with', teams.length, 'teams');
        const teamMatches = generateTournamentSchedule(
          teams,
          numberOfCourts,
          startDate,
          currentTournament.format || 'round_robin',
          startTime,
          endTime,
          matchDuration
        );
        
        matchesToInsert = teamMatches.map(m => ({
          tournament_id: currentTournament.id,
          round: m.round,
          match_number: m.match_number,
          team1_id: m.team1_id,
          team2_id: m.team2_id,
          scheduled_time: m.scheduled_time,
          court: m.court,
          status: 'scheduled'
        }));
      }
      
      console.log('[SCHEDULE] Generated', matchesToInsert.length, 'matches');
      
      if (matchesToInsert.length > 0) {
        const { error } = await supabase.from('matches').insert(matchesToInsert);
        if (error) throw error;
        console.log('[SCHEDULE] Inserted matches into database');
      }
      
      await fetchTournamentData();
      alert(t.tournament.scheduleGenerated);
    } catch (error) {
      console.error('Error generating schedule:', error);
      alert('Erro ao gerar calendário');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAllMatches = async () => {
    if (!confirm(t.tournament.confirmDeleteMatches)) return;
    
    setLoading(true);
    try {
      await deleteCourtBookingsForTournament(tournament.id);
      const { error } = await supabase.from('matches').delete().eq('tournament_id', tournament.id);
      if (error) throw error;
      await fetchTournamentData();
      alert(t.nav.matchesDeleted);
    } catch (error) {
      console.error('Error deleting matches:', error);
      alert('Erro ao eliminar jogos');
    } finally {
      setLoading(false);
    }
  };

  const handleExportPDF = async () => {
    try {
      await exportTournamentPDF(currentTournament, teams, individualPlayers, matches, categories, t);
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Erro ao exportar PDF');
    }
  };

  const handleFinalizeTournament = async () => {
    const allMatchesCompleted = matches.every(m => m.status === 'completed');
    if (!allMatchesCompleted) {
      if (!confirm('Nem todos os jogos estão concluídos. Deseja finalizar o torneio mesmo assim?')) {
        return;
      }
    } else {
      if (!confirm('Tem a certeza que deseja finalizar o torneio? Os resultados serão adicionados às Ligas.')) {
        return;
      }
    }

    setLoading(true);
    try {
      // 1. Calculate individual final positions if it's an individual format
      if (isIndividualFormat()) {
        console.log('[FINALIZE] Calculating individual final positions...');
        await calculateIndividualFinalPositions(tournament.id, selectedCategory);
      }

      // 2. Update tournament status to completed FIRST
      console.log('[FINALIZE] Updating tournament status to completed...');
      const { error } = await supabase
        .from('tournaments')
        .update({ status: 'completed' })
        .eq('id', tournament.id);

      if (error) throw error;

      // 3. Now update league standings (after status is 'completed')
      console.log('[FINALIZE] Updating league standings...');
      await updateLeagueStandings(tournament.id);

      // 4. Refresh data
      await fetchTournamentData();
      setCurrentTournament({ ...currentTournament, status: 'completed' });
      
      alert('Torneio finalizado com sucesso! Os resultados foram adicionados às Ligas.');
    } catch (error) {
      console.error('Error finalizing tournament:', error);
      alert('Erro ao finalizar o torneio. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header com nome e info básica */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          {/* Lado esquerdo: Voltar + Info do torneio */}
          <div className="flex items-start gap-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-gray-100 rounded-lg transition flex-shrink-0"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{currentTournament.name}</h2>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-gray-600">
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {formatDate(currentTournament.start_date)}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="w-4 h-4" />
                  {isIndividualFormat() ? filteredIndividualPlayers.length : filteredTeams.length} {isIndividualFormat() ? t.nav.players : t.nav.teams}
                </span>
                <span className="flex items-center gap-1">
                  <Trophy className="w-4 h-4" />
                  {filteredMatches.length} {t.nav.matches}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  currentTournament.status === 'active' ? 'bg-green-100 text-green-800' :
                  currentTournament.status === 'completed' ? 'bg-gray-100 text-gray-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {currentTournament.status}
                </span>
              </div>
            </div>
          </div>

          {/* Lado direito: Botões de links e edição */}
          <div className="flex flex-wrap gap-2 lg:flex-shrink-0">
            <button
              onClick={copyRegistrationLink}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              {linkCopied ? <Check className="w-4 h-4" /> : <Link className="w-4 h-4" />}
              {linkCopied ? 'Copiado!' : 'Link Inscrição'}
            </button>
            <button
              onClick={copyLiveLink}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition"
            >
              {liveLinkCopied ? <Check className="w-4 h-4" /> : <Trophy className="w-4 h-4" />}
              {liveLinkCopied ? 'Copiado!' : 'Link Live'}
            </button>
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition"
            >
              <FileDown className="w-4 h-4" />
              PDF
            </button>
            <button
              onClick={() => setShowEditTournament(true)}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
            >
              <Pencil className="w-4 h-4" />
              Editar
            </button>
            {currentTournament.status !== 'completed' && (
              <button
                onClick={handleFinalizeTournament}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
              >
                <Trophy className="w-4 h-4" />
                Finalizar Torneio
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Seletor de Categorias */}
      {categories.length > 0 && (
        <div className="bg-white rounded-xl shadow-lg p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-700 mr-2">Categoria:</span>
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-3 py-1.5 text-sm rounded-lg transition ${
                selectedCategory === null
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Todas
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 py-1.5 text-sm rounded-lg transition ${
                  selectedCategory === cat.id
                    ? 'text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                style={selectedCategory === cat.id ? { backgroundColor: getCategoryColor(cat.id) } : {}}
              >
                {cat.name}
              </button>
            ))}
            <button
              onClick={() => setShowManageCategories(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition ml-2"
            >
              <FolderTree className="w-4 h-4" />
              Gerir Categorias
            </button>
          </div>
        </div>
      )}

      {/* Tabs de navegação */}
      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px overflow-x-auto">
            {(['teams', 'matches', 'standings', 'knockout'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-shrink-0 px-6 py-4 text-sm font-medium border-b-2 transition ${
                  activeTab === tab
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab === 'teams' && (isIndividualFormat() ? 'Jogadores' : 'Equipas')}
                {tab === 'matches' && 'Jogos'}
                {tab === 'standings' && 'Classificação'}
                {tab === 'knockout' && 'Eliminatórias'}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {/* Teams/Players Tab */}
          {activeTab === 'teams' && (
            <div className="space-y-6">
              {/* Título e botão adicionar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">
                  {isIndividualFormat() ? 'Jogadores' : 'Equipas'}
                </h3>
                {isIndividualFormat() ? (
                  <button
                    onClick={() => setShowAddPlayer(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                  >
                    <Plus className="w-4 h-4" />
                    Adicionar Jogador
                  </button>
                ) : (
                  <button
                    onClick={() => setShowAddTeam(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                  >
                    <Plus className="w-4 h-4" />
                    Adicionar Equipa
                  </button>
                )}
              </div>

              {/* Group Assignments - grupos lado a lado */}
              {isIndividualFormat() && groupedPlayers.size > 0 && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h4 className="font-medium text-gray-700">Group Assignments</h4>
                    <div className="flex gap-2">
                      {currentTournament.format !== 'american' && (
                        <button
                          onClick={handleAssignGroups}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition"
                        >
                          <Shuffle className="w-4 h-4" />
                          Sortear
                        </button>
                      )}
                      <button
                        onClick={() => setShowManualGroupAssignment(true)}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition"
                      >
                        <Hand className="w-4 h-4" />
                        Manual
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Array.from(groupedPlayers.entries()).sort().map(([group, players]) => (
                      <div key={group} className="bg-white border rounded-xl overflow-hidden">
                        <div className="bg-blue-600 text-white px-4 py-2 text-center font-semibold">
                          Grupo {group}
                        </div>
                        <div className="p-4 space-y-2">
                          {players.map(player => (
                            <div key={player.id} className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm">
                                {player.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 truncate">{player.name}</p>
                                {player.email && (
                                  <p className="text-xs text-gray-500 truncate">{player.email}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Botões de grupos quando não há grupos atribuídos */}
              {isIndividualFormat() && groupedPlayers.size === 0 && filteredIndividualPlayers.length > 0 && (
                <div className="flex gap-2">
                  {currentTournament.format !== 'american' && (
                    <button
                      onClick={handleAssignGroups}
                      className="flex items-center gap-2 px-3 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition"
                    >
                      <Shuffle className="w-4 h-4" />
                      Sortear Grupos
                    </button>
                  )}
                  <button
                    onClick={() => setShowManualGroupAssignment(true)}
                    className="flex items-center gap-2 px-3 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition"
                  >
                    <Hand className="w-4 h-4" />
                    Grupos Manual
                  </button>
                </div>
              )}

              {/* All Players - lista completa */}
              {isIndividualFormat() && filteredIndividualPlayers.length > 0 && (
                <div className="space-y-4">
                  <h4 className="font-medium text-gray-700">All Players</h4>
                  <div className="space-y-2">
                    {filteredIndividualPlayers.map(player => (
                      <div
                        key={player.id}
                        className="flex items-center justify-between bg-white border rounded-lg p-3 hover:shadow-md transition"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold">
                            {player.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-gray-900">{player.name}</p>
                              {player.group_name && (
                                <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
                                  Grupo {player.group_name}
                                </span>
                              )}
                            </div>
                            {player.email && (
                              <p className="text-sm text-gray-500">{player.email}</p>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedPlayer(player);
                            setShowEditPlayer(true);
                          }}
                          className="p-2 hover:bg-gray-100 rounded-lg transition"
                        >
                          <Pencil className="w-4 h-4 text-gray-500" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Mensagem quando não há jogadores */}
              {isIndividualFormat() && filteredIndividualPlayers.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Ainda não há jogadores inscritos</p>
                </div>
              )}

              {/* Teams layout (non-individual) */}
              {!isIndividualFormat() && (
                <>
                  {/* Botões de grupos para equipas */}
                  {filteredTeams.length > 0 && (
                    <div className="flex gap-2">
                      {currentTournament.format !== 'american' && (
                        <button
                          onClick={handleAssignGroups}
                          className="flex items-center gap-2 px-3 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition"
                        >
                          <Shuffle className="w-4 h-4" />
                          Sortear Grupos
                        </button>
                      )}
                      <button
                        onClick={() => setShowManualGroupAssignment(true)}
                        className="flex items-center gap-2 px-3 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition"
                      >
                        <Hand className="w-4 h-4" />
                        Grupos Manual
                      </button>
                    </div>
                  )}

                  {/* Teams by group */}
                  {groupedTeams.size > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {Array.from(groupedTeams.entries()).sort().map(([group, groupTeams]) => (
                        <div key={group} className="bg-white border rounded-xl overflow-hidden">
                          <div className="bg-blue-600 text-white px-4 py-2 text-center font-semibold">
                            Grupo {group}
                          </div>
                          <div className="p-4 space-y-2">
                            {groupTeams.map(team => (
                              <div key={team.id} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg">
                                <div>
                                  <p className="font-medium text-gray-900">
                                    {team.player1?.name} / {team.player2?.name}
                                  </p>
                                </div>
                                <button
                                  onClick={() => {
                                    setSelectedTeam(team);
                                    setShowEditTeam(true);
                                  }}
                                  className="p-1 hover:bg-gray-100 rounded transition"
                                >
                                  <Pencil className="w-4 h-4 text-gray-500" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : filteredTeams.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {filteredTeams.map(team => (
                        <div
                          key={team.id}
                          className="flex items-center justify-between bg-white border rounded-lg p-4 hover:shadow-md transition"
                        >
                          <div>
                            <p className="font-medium text-gray-900">
                              {team.player1?.name} / {team.player2?.name}
                            </p>
                            {team.group_name && (
                              <span className="text-xs text-blue-600">Grupo {team.group_name}</span>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              setSelectedTeam(team);
                              setShowEditTeam(true);
                            }}
                            className="p-2 hover:bg-gray-100 rounded-lg transition"
                          >
                            <Pencil className="w-4 h-4 text-gray-500" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-gray-500">
                      <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>Ainda não há equipas inscritas</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Matches Tab */}
          {activeTab === 'matches' && (
            <div className="space-y-6">
              {/* Barra de ações da tab Jogos */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold">Jogos</h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleGenerateSchedule}
                    className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                  >
                    <Calendar className="w-4 h-4" />
                    Gerar Calendário
                  </button>
                  
                  {filteredMatches.length > 0 && (
                    <button
                      onClick={handleDeleteAllMatches}
                      className="flex items-center gap-2 px-3 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                      Eliminar Todos
                    </button>
                  )}
                </div>
              </div>

              {/* Lista de jogos */}
              {filteredMatches.length > 0 ? (
                <MatchScheduleView
                  key={refreshKey}
                  matches={filteredMatches}
                  isIndividualRoundRobin={isIndividualFormat()}
                  individualPlayers={individualPlayers}
                  onMatchClick={(matchId) => {
                    setSelectedMatchId(matchId);
                    setShowMatchModal(true);
                  }}
                  categories={categories}
                  showCategoryLabels={categories.length > 1}
                  printTitle={currentTournament.name}
                />
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <CalendarClock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Ainda não há jogos agendados</p>
                  <p className="text-sm mt-2">Clique em "Gerar Calendário" para criar os jogos automaticamente</p>
                </div>
              )}
            </div>
          )}

          {/* Standings Tab */}
          {activeTab === 'standings' && (
            <Standings
              key={refreshKey}
              tournamentId={currentTournament.id}
              format={currentTournament.format}
              categoryId={selectedCategory}
              roundRobinType={currentTournament.round_robin_type}
              refreshKey={refreshKey}
              qualifiedPerGroup={calculateQualifiedPerGroup(
                currentTournament.number_of_groups || 2,
                (currentTournament as any).knockout_stage || 'semifinals',
                isIndividualFormat()
              )}
            />
          )}

          {/* Knockout Tab */}
          {activeTab === 'knockout' && (
            <BracketView
              key={refreshKey}
              matches={filteredMatches}
              onMatchClick={(matchId) => {
                setSelectedMatchId(matchId);
                setShowMatchModal(true);
              }}
              isIndividual={isIndividualFormat()}
              individualPlayers={filteredIndividualPlayers}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      {showAddTeam && (
        <AddTeamModal
          tournamentId={tournament.id}
          categories={categories}
          selectedCategory={selectedCategory}
          onClose={() => setShowAddTeam(false)}
          onSuccess={() => {
            setShowAddTeam(false);
            fetchTournamentData();
          }}
        />
      )}

      {showAddPlayer && (
        <AddIndividualPlayerModal
          tournamentId={tournament.id}
          categories={categories}
          selectedCategory={selectedCategory}
          onClose={() => setShowAddPlayer(false)}
          onSuccess={() => {
            setShowAddPlayer(false);
            fetchTournamentData();
          }}
        />
      )}

      {showMatchModal && (
        <MatchModal
          tournamentId={tournament.id}
          matchId={selectedMatchId}
          onClose={() => {
            setShowMatchModal(false);
            setSelectedMatchId(undefined);
          }}
          onSuccess={() => {
            setShowMatchModal(false);
            setSelectedMatchId(undefined);
            fetchTournamentData();
          }}
        />
      )}

      {showEditTournament && (
        <EditTournamentModal
          tournament={currentTournament}
          onClose={() => setShowEditTournament(false)}
          onSuccess={(updated) => {
            setCurrentTournament(updated);
            setShowEditTournament(false);
            fetchTournamentData();
          }}
        />
      )}

      {showEditTeam && selectedTeam && (
        <EditTeamModal
          team={selectedTeam}
          categories={categories}
          onClose={() => {
            setShowEditTeam(false);
            setSelectedTeam(undefined);
          }}
          onSuccess={() => {
            setShowEditTeam(false);
            setSelectedTeam(undefined);
            fetchTournamentData();
          }}
        />
      )}

      {showEditPlayer && selectedPlayer && (
        <EditIndividualPlayerModal
          player={selectedPlayer}
          categories={categories}
          onClose={() => {
            setShowEditPlayer(false);
            setSelectedPlayer(undefined);
          }}
          onSuccess={() => {
            setShowEditPlayer(false);
            setSelectedPlayer(undefined);
            fetchTournamentData();
          }}
        />
      )}

      {showManageCategories && (
        <ManageCategoriesModal
          tournamentId={currentTournament.id}
          onClose={() => setShowManageCategories(false)}
          onCategoriesUpdated={() => {
            setShowManageCategories(false);
            fetchTournamentData();
          }}
        />
      )}

      {showManualGroupAssignment && (
        <ManualGroupAssignmentModal
          tournament={currentTournament}
          teams={filteredTeams}
          players={filteredIndividualPlayers}
          categories={categories}
          selectedCategory={selectedCategory}
          isIndividual={isIndividualFormat()}
          onClose={() => setShowManualGroupAssignment(false)}
          onSuccess={() => {
            setShowManualGroupAssignment(false);
            fetchTournamentData();
          }}
        />
      )}
    </div>
  );
}
