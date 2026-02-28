import { useEffect, useState, useRef } from 'react';
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
import { processAllUnratedMatches } from '../lib/ratingEngine';
import { generateTournamentSchedule } from '../lib/scheduler';
import { generateAmericanSchedule } from '../lib/americanScheduler';
import { generateIndividualGroupsKnockoutSchedule } from '../lib/individualGroupsKnockoutScheduler';
import { getTeamsByGroup, getPlayersByGroup, sortTeamsByTiebreaker, populatePlacementMatches, advanceKnockoutWinner } from '../lib/groups';
import type { TeamStats, MatchData } from '../lib/groups';
// import { scheduleMultipleCategories } from '../lib/multiCategoryScheduler'; // Available for future multi-category scheduling
import { updateLeagueStandings, calculateIndividualFinalPositions } from '../lib/leagueStandings';
import { exportTournamentPDF } from '../lib/pdfExport';
import SuperTeamLineupModal from './SuperTeamLineupModal';
import SuperTeamResultsModal from './SuperTeamResultsModal';
import EditSuperTeamModal from './EditSuperTeamModal';

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

// Super Teams types for format === 'super_teams'
type SuperTeamPlayerRow = {
  id: string;
  name: string;
  email?: string | null;
  phone_number?: string | null;
  is_captain: boolean;
  player_order: number;
};

type SuperTeamRow = {
  id: string;
  tournament_id: string;
  category_id: string | null;
  name: string;
  group_name: string | null;
  super_team_players?: SuperTeamPlayerRow[];
};

type SuperTeamConfrontationRow = {
  id: string;
  tournament_id: string;
  category_id: string | null;
  super_team_1_id: string | null;
  super_team_2_id: string | null;
  round: string | null;
  group_name: string | null;
  scheduled_time: string | null;
  court_name: string | null;
  status: string;
  team1_matches_won: number;
  team2_matches_won: number;
  has_super_tiebreak: boolean;
  winner_super_team_id: string | null;
  next_confrontation_id?: string | null;
  next_team_slot?: number | null;
  // Resultados detalhados de cada jogo (melhor de 3)
  match1_team1_score?: number | null;
  match1_team2_score?: number | null;
  match2_team1_score?: number | null;
  match2_team2_score?: number | null;
  match3_team1_score?: number | null;
  match3_team2_score?: number | null;
};

type SuperTeamStandingRow = {
  id: string;
  tournament_id: string;
  category_id: string | null;
  super_team_id: string;
  group_name: string | null;
  confrontations_played: number;
  confrontations_won: number;
  confrontations_lost: number;
  games_won: number;
  games_lost: number;
  games_diff: number;
  points: number;
  position: number | null;
};

export default function TournamentDetail({ tournament, onBack }: TournamentDetailProps) {
  const { t, language } = useI18n();
  const [teams, setTeams] = useState<TeamWithPlayers[]>([]);
  const [individualPlayers, setIndividualPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<MatchWithTeams[]>([]);
  const [categories, setCategories] = useState<TournamentCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedCourtFilter, setSelectedCourtFilter] = useState<string | null>(null);
  const [selectedDateFilter, setSelectedDateFilter] = useState<string | null>(null);
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
  // Super Teams (format === 'super_teams')
  const [superTeams, setSuperTeams] = useState<SuperTeamRow[]>([]);
  const [superTeamConfrontations, setSuperTeamConfrontations] = useState<SuperTeamConfrontationRow[]>([]);
  const [superTeamStandings, setSuperTeamStandings] = useState<SuperTeamStandingRow[]>([]);
  const [showLineupModal, setShowLineupModal] = useState(false);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [selectedConfrontation, setSelectedConfrontation] = useState<SuperTeamConfrontationRow | null>(null);
  const [selectedLineupTeam, setSelectedLineupTeam] = useState<SuperTeamRow | null>(null);
  const [showEditSuperTeam, setShowEditSuperTeam] = useState(false);
  const [selectedSuperTeam, setSelectedSuperTeam] = useState<SuperTeamRow | null>(null);

  // Ref to store match ID to scroll to after modal close + data refresh
  const scrollToMatchIdRef = useRef<string | null>(null);

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
        if (newRecord.status === 'completed') {
          if (newRecord.round?.startsWith('crossed_')) {
            // Avançar R1→R2 ou R2→R3
            setTimeout(() => autoAdvanceCrossedPlayoffs(updated), 500);
          } else if (newRecord.round === 'quarterfinal' || newRecord.round === 'quarter_final') {
            // Avançar quarterfinals → semifinals
            console.log('[REALTIME] Quarterfinal completed, advancing winner to semifinal');
            setTimeout(async () => {
              await advanceKnockoutWinner(tournament.id, newRecord.id);
              fetchTournamentData();
            }, 500);
          } else if (newRecord.round === 'semifinal') {
            // Avançar meias-finais → final e 3°/4° lugar
            setTimeout(() => autoAdvanceSemifinals(updated), 500);
          } else if (newRecord.round?.startsWith('group_')) {
            const groupMatches = updated.filter(m => m.round.startsWith('group_'));
            const allGroupsDone = groupMatches.length > 0 && groupMatches.every(m => m.status === 'completed');
            
            if (allGroupsDone) {
              // Use tournament.format (prop) instead of currentTournament (potentially stale state)
              const fmt = tournament.format;
              if (fmt === 'mixed_american' || fmt === 'mixed_gender') {
                console.log('[REALTIME] All groups done (mixed_american/mixed_gender) - refetching to auto-populate knockouts');
                setTimeout(() => fetchTournamentData(), 500);
              } else if (fmt === 'crossed_playoffs') {
                setTimeout(() => autoFillCrossedPlayoffsR1(updated), 500);
              } else if (fmt === 'individual_groups_knockout') {
                setTimeout(async () => {
                  console.log('[REALTIME] All groups done, populating knockout brackets');
                  await populatePlacementMatches(tournament.id);
                  fetchTournamentData();
                }, 600);
              } else {
                // Fallback: refetch for any format with groups
                console.log(`[REALTIME] All groups done (format: ${fmt}) - refetching`);
                setTimeout(() => fetchTournamentData(), 500);
              }
            }
          }
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
  const isIndividualGroupsKnockout = currentTournament?.format === 'individual_groups_knockout' ||
    currentTournament?.format === 'crossed_playoffs' ||
    currentTournament?.format === 'mixed_gender' ||
    currentTournament?.format === 'mixed_american';
  const isSuperTeams = currentTournament?.format === 'super_teams';

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
    // Formatos de torneio que são sempre individuais
    if (currentTournament?.format === 'crossed_playoffs' || currentTournament?.format === 'mixed_gender' || currentTournament?.format === 'mixed_american') {
      return true;
    }
    
    // Verificar por categoria
    if (selectedCategory && selectedCategory !== 'no-category') {
      const category = categories.find(c => c.id === selectedCategory);
      if (category) {
        if (category.format === 'individual_groups_knockout' || category.format === 'crossed_playoffs' || category.format === 'mixed_gender' || category.format === 'mixed_american') {
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
    if (isIndividual) {
      // Individual format: each match has 4 players (2v2)
      if (knockoutStage === 'quarterfinals') {
        // ALL players qualify for QFs (typically 4 per group)
        const qualifiedPerGroup = 4;
        const totalQualified = numberOfGroups * qualifiedPerGroup;
        console.log(`[CALCULATE_QUALIFIED] Individual QFs: ${numberOfGroups} groups × ${qualifiedPerGroup} = ${totalQualified} total`);
        return { qualifiedPerGroup, extraBestNeeded: 0, totalQualified, extraFromPosition: qualifiedPerGroup + 1 };
      } else if (knockoutStage === 'semifinals') {
        // 8 players for 2 SFs
        const totalQualified = 8;
        const qualifiedPerGroup = Math.floor(totalQualified / numberOfGroups);
        const extraBestNeeded = totalQualified - (qualifiedPerGroup * numberOfGroups);
        console.log(`[CALCULATE_QUALIFIED] Individual SFs: ${qualifiedPerGroup}/group + ${extraBestNeeded} best = ${totalQualified}`);
        return { qualifiedPerGroup, extraBestNeeded, totalQualified, extraFromPosition: qualifiedPerGroup + 1 };
      } else {
        // final: 4 players
        const totalQualified = 4;
        const qualifiedPerGroup = Math.floor(totalQualified / numberOfGroups);
        const extraBestNeeded = totalQualified - (qualifiedPerGroup * numberOfGroups);
        console.log(`[CALCULATE_QUALIFIED] Individual Final: ${qualifiedPerGroup}/group + ${extraBestNeeded} best = ${totalQualified}`);
        return { qualifiedPerGroup, extraBestNeeded, totalQualified, extraFromPosition: qualifiedPerGroup + 1 };
      }
    }

    // Team format
    const teamKnockoutSizes: Record<string, number> = {
      'final': 2,
      'semifinals': 4,
      'quarterfinals': 8,
      'round16': 16,
    };

    const totalQualified = teamKnockoutSizes[knockoutStage] || 4;
    const qualifiedPerGroup = Math.floor(totalQualified / numberOfGroups);
    const extraBestNeeded = totalQualified - (qualifiedPerGroup * numberOfGroups);
    const extraFromPosition = qualifiedPerGroup + 1;

    console.log(`[CALCULATE_QUALIFIED] Teams: ${numberOfGroups} groups, Stage: ${knockoutStage}`);
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

  const filteredSuperTeams = selectedCategory === 'no-category'
    ? superTeams.filter(st => !st.category_id)
    : selectedCategory
    ? superTeams.filter(st => st.category_id === selectedCategory)
    : superTeams;
  const filteredSuperTeamConfrontations = superTeamConfrontations.filter(c => {
    // Filtro por categoria
    if (selectedCategory === 'no-category' && c.category_id) return false;
    if (selectedCategory && selectedCategory !== 'no-category' && c.category_id !== selectedCategory) return false;
    
    // Filtro por campo
    if (selectedCourtFilter && c.court_name !== selectedCourtFilter) return false;
    
    // Filtro por data
    if (selectedDateFilter && c.scheduled_time) {
      const confDate = new Date(c.scheduled_time).toISOString().split('T')[0];
      if (confDate !== selectedDateFilter) return false;
    } else if (selectedDateFilter && !c.scheduled_time) {
      return false;
    }
    
    return true;
  });
  
  // Obter lista única de campos e datas para os filtros
  const uniqueCourts = [...new Set(superTeamConfrontations.map(c => c.court_name).filter(Boolean))].sort();
  const uniqueDates = [...new Set(superTeamConfrontations.map(c => c.scheduled_time ? new Date(c.scheduled_time).toISOString().split('T')[0] : null).filter(Boolean) as string[])].sort();
  const filteredSuperTeamStandings = selectedCategory === 'no-category'
    ? superTeamStandings.filter(s => !s.category_id)
    : selectedCategory
    ? superTeamStandings.filter(s => s.category_id === selectedCategory)
    : superTeamStandings;

  const getSuperTeamById = (id: string | null): SuperTeamRow | undefined =>
    id ? superTeams.find(st => st.id === id) : undefined;

  const handleSuperTeamsDrawGroups = async () => {
    if (!currentTournament || currentTournament.format !== 'super_teams') return;
    const confirmed = confirm('Vai sortear todas as super equipas em grupos por categoria. As atribuições atuais serão substituídas. Continuar?');
    if (!confirmed) return;
    setLoading(true);
    try {
      for (const cat of categories) {
        const teamsInCat = superTeams.filter(st => st.category_id === cat.id);
        const numGroups = cat.number_of_groups || 2;
        const groupLabels = Array.from({ length: numGroups }, (_, i) => String.fromCharCode(65 + i));
        const shuffled = [...teamsInCat].sort(() => Math.random() - 0.5);
        for (let i = 0; i < shuffled.length; i++) {
          const groupName = groupLabels[i % numGroups];
          await supabase.from('super_teams').update({ group_name: groupName }).eq('id', shuffled[i].id);
        }
      }
      await fetchTournamentData();
    } catch (e) {
      console.error(e);
      alert('Erro ao sortear grupos.');
    } finally {
      setLoading(false);
    }
  };

  const handleSuperTeamsGenerateSchedule = async () => {
    console.log('[SUPER-SCHEDULE] ====================================');
    console.log('[SUPER-SCHEDULE] Starting schedule generation for Super Teams');
    if (!currentTournament || currentTournament.format !== 'super_teams') {
      console.log('[SUPER-SCHEDULE] Aborted: not a super_teams tournament');
      return;
    }
    setLoading(true);
    try {
      // Verificar se já existem confrontações
      const existingConfrontations = superTeamConfrontations.length;
      if (existingConfrontations > 0) {
        const confirm = window.confirm(`Já existem ${existingConfrontations} confrontos. Deseja eliminar e gerar novos? A classificação também será limpa.`);
        if (!confirm) {
          setLoading(false);
          return;
        }
        // Eliminar standings primeiro
        await supabase.from('super_team_standings').delete().eq('tournament_id', tournament.id);
        // Eliminar confrontações existentes
        await supabase.from('super_team_confrontations').delete().eq('tournament_id', tournament.id);
      }
      
      // Obter informações do torneio
      const dailyStartTime = (currentTournament as any).daily_start_time || '09:00';
      const dailyEndTime = (currentTournament as any).daily_end_time || '21:00';
      const matchDurationMinutes = (currentTournament as any).match_duration_minutes || 45;
      const startDate = new Date(currentTournament.start_date);
      const endDate = new Date(currentTournament.end_date);
      
      console.log('[SUPER-SCHEDULE] Tournament settings:');
      console.log('[SUPER-SCHEDULE]   - daily_start_time:', dailyStartTime);
      console.log('[SUPER-SCHEDULE]   - daily_end_time:', dailyEndTime);
      console.log('[SUPER-SCHEDULE]   - match_duration_minutes:', matchDurationMinutes);
      console.log('[SUPER-SCHEDULE]   - start_date:', startDate);
      console.log('[SUPER-SCHEDULE]   - categories:', categories.length);
      console.log('[SUPER-SCHEDULE]   - superTeams:', superTeams.length);
      
      // Obter os nomes dos campos definidos
      const courtNames = (currentTournament as any).court_names || [];
      const availableCourts = courtNames.length > 0 ? courtNames : ['Campo 1'];
      const numCourts = availableCourts.length;
      
      console.log('[SUPER-SCHEDULE]   - courts:', availableCourts);
      
      // Gerar todas as confrontações
      const toInsert: Array<{
        tournament_id: string;
        category_id: string | null;
        round: string;
        group_name: string | null;
        super_team_1_id: string;
        super_team_2_id: string;
        scheduled_time: string;
        court_name: string;
      }> = [];
      
      // Parse horários
      const [startHours, startMinutes] = dailyStartTime.split(':').map(Number);
      const [endHours, endMinutes] = dailyEndTime.split(':').map(Number);
      
      // Calcular slots por dia por campo
      const dailyMinutes = (endHours * 60 + endMinutes) - (startHours * 60 + startMinutes);
      const slotsPerCourtPerDay = Math.floor(dailyMinutes / matchDurationMinutes);
      const totalSlotsPerDay = slotsPerCourtPerDay * numCourts;
      
      console.log('[SUPER-SCHEDULE]   - slots per court per day:', slotsPerCourtPerDay);
      console.log('[SUPER-SCHEDULE]   - total slots per day:', totalSlotsPerDay);
      
      // Recolher todos os confrontos a agendar
      const allConfronts: Array<{
        cat: typeof categories[0];
        groupName: string;
        team1: SuperTeamRow;
        team2: SuperTeamRow;
      }> = [];
      
      // Organizar confrontos por categoria e grupo para intercalar
      const confrontsByGroup: Array<{
        cat: typeof categories[0];
        groupName: string;
        confronts: Array<{ team1: SuperTeamRow; team2: SuperTeamRow }>;
      }> = [];
      
      for (const cat of categories) {
        const teamsInCat = superTeams.filter(st => st.category_id === cat.id);
        const byGroup = teamsInCat.reduce<Record<string, SuperTeamRow[]>>((acc, st) => {
          const g = st.group_name || 'Sem grupo';
          if (!acc[g]) acc[g] = [];
          acc[g].push(st);
          return acc;
        }, {});
        
        for (const [groupName, groupTeams] of Object.entries(byGroup)) {
          const groupConfronts: Array<{ team1: SuperTeamRow; team2: SuperTeamRow }> = [];
          for (let i = 0; i < groupTeams.length; i++) {
            for (let j = i + 1; j < groupTeams.length; j++) {
              groupConfronts.push({
                team1: groupTeams[i],
                team2: groupTeams[j],
              });
            }
          }
          if (groupConfronts.length > 0) {
            confrontsByGroup.push({ cat, groupName, confronts: groupConfronts });
          }
        }
      }
      
      // Intercalar confrontos de diferentes grupos/categorias (round-robin)
      // Isto garante que as equipas têm tempo de descanso
      let hasMore = true;
      let roundIndex = 0;
      while (hasMore) {
        hasMore = false;
        for (const group of confrontsByGroup) {
          if (roundIndex < group.confronts.length) {
            allConfronts.push({
              cat: group.cat,
              groupName: group.groupName,
              team1: group.confronts[roundIndex].team1,
              team2: group.confronts[roundIndex].team2,
            });
            hasMore = true;
          }
        }
        roundIndex++;
      }
      
      console.log('[SUPER-SCHEDULE]   - groups/categories:', confrontsByGroup.length);
      console.log('[SUPER-SCHEDULE]   - total confronts to schedule:', allConfronts.length);
      
      if (allConfronts.length === 0) {
        alert('Defina grupos nas super equipas primeiro (Sortear Grupos ou Grupos Manual).');
        setLoading(false);
        return;
      }
      
      // Estrutura para rastrear slots: Map<slotKey, Set<teamId>>
      // slotKey = "day_timeSlot" (ex: "0_0" = dia 0, slot 0)
      const occupiedTeamsPerSlot = new Map<string, Set<string>>();
      const usedCourtsPerSlot = new Map<string, Set<number>>();
      
      // Função para verificar se um confronto pode ser agendado num slot
      const canScheduleInSlot = (slotKey: string, team1Id: string, team2Id: string): boolean => {
        const occupied = occupiedTeamsPerSlot.get(slotKey) || new Set();
        return !occupied.has(team1Id) && !occupied.has(team2Id);
      };
      
      // Função para obter próximo campo disponível num slot
      const getAvailableCourtIndex = (slotKey: string): number | null => {
        const used = usedCourtsPerSlot.get(slotKey) || new Set();
        for (let i = 0; i < numCourts; i++) {
          if (!used.has(i)) return i;
        }
        return null;
      };
      
      // Função para marcar equipas e campo como ocupados
      const markSlotOccupied = (slotKey: string, team1Id: string, team2Id: string, courtIndex: number) => {
        if (!occupiedTeamsPerSlot.has(slotKey)) {
          occupiedTeamsPerSlot.set(slotKey, new Set());
        }
        occupiedTeamsPerSlot.get(slotKey)!.add(team1Id);
        occupiedTeamsPerSlot.get(slotKey)!.add(team2Id);
        
        if (!usedCourtsPerSlot.has(slotKey)) {
          usedCourtsPerSlot.set(slotKey, new Set());
        }
        usedCourtsPerSlot.get(slotKey)!.add(courtIndex);
      };
      
      // Agendar cada confronto
      const unscheduled = [...allConfronts];
      let currentDayIndex = 0;
      let currentTimeSlot = 0;
      let maxDays = 365; // Limite de segurança
      
      while (unscheduled.length > 0 && maxDays > 0) {
        const slotKey = `${currentDayIndex}_${currentTimeSlot}`;
        
        // Tentar agendar o máximo de confrontos possível neste slot
        for (let i = unscheduled.length - 1; i >= 0; i--) {
          const confront = unscheduled[i];
          
          // Verificar se as equipas estão livres
          if (!canScheduleInSlot(slotKey, confront.team1.id, confront.team2.id)) {
            continue;
          }
          
          // Verificar se há campo disponível
          const courtIndex = getAvailableCourtIndex(slotKey);
          if (courtIndex === null) {
            break; // Sem campos disponíveis, ir para próximo slot
          }
          
          // Calcular a data e hora
          const matchDate = new Date(startDate);
          matchDate.setDate(matchDate.getDate() + currentDayIndex);
          
          const totalMinutesFromStart = currentTimeSlot * matchDurationMinutes;
          const matchHour = startHours + Math.floor((startMinutes + totalMinutesFromStart) / 60);
          const matchMinute = (startMinutes + totalMinutesFromStart) % 60;
          
          matchDate.setHours(matchHour, matchMinute, 0, 0);
          
          // Marcar como ocupado
          markSlotOccupied(slotKey, confront.team1.id, confront.team2.id, courtIndex);
          
          console.log(`[SUPER-SCHEDULE] Slot ${slotKey}: ${confront.team1.name} vs ${confront.team2.name} - ${matchDate.toLocaleString()} - ${availableCourts[courtIndex]}`);
          
          toInsert.push({
            tournament_id: tournament.id,
            category_id: confront.cat.id,
            round: 'group',
            group_name: confront.groupName === 'Sem grupo' ? null : confront.groupName,
            super_team_1_id: confront.team1.id,
            super_team_2_id: confront.team2.id,
            scheduled_time: matchDate.toISOString(),
            court_name: availableCourts[courtIndex],
          });
          
          // Remover da lista de não agendados
          unscheduled.splice(i, 1);
        }
        
        // Avançar para próximo slot
        currentTimeSlot++;
        
        // Verificar se ultrapassou os slots do dia
        if (currentTimeSlot >= slotsPerCourtPerDay) {
          currentTimeSlot = 0;
          currentDayIndex++;
          maxDays--;
          
          // Verificar se ultrapassou a data final
          const nextDate = new Date(startDate);
          nextDate.setDate(nextDate.getDate() + currentDayIndex);
          if (nextDate > endDate && unscheduled.length > 0) {
            console.warn('[SUPER-SCHEDULE] Warning: Not enough days to schedule all confronts. Remaining:', unscheduled.length);
          }
        }
      }
      
      if (unscheduled.length > 0) {
        console.warn('[SUPER-SCHEDULE] Could not schedule', unscheduled.length, 'confronts');
      }
      
      // ========== GERAR FASES FINAIS ==========
      const knockoutConfronts: Array<{
        tournament_id: string;
        category_id: string | null;
        round: string;
        group_name: string | null;
        super_team_1_id: string | null;
        super_team_2_id: string | null;
        scheduled_time: string;
        court_name: string;
      }> = [];
      
      console.log('[SUPER-SCHEDULE] Generating knockout rounds...');
      
      for (const cat of categories) {
        const knockoutStage = (cat as any).knockout_stage || 'semifinals';
        const qualifiedPerGroup = (cat as any).qualified_per_group || 2;
        const numberOfGroups = (cat as any).number_of_groups || 2;
        
        console.log(`[SUPER-SCHEDULE] Category ${cat.name}: knockout_stage = ${knockoutStage}, qualified_per_group = ${qualifiedPerGroup}, groups = ${numberOfGroups}`);
        
        // Calculate qualification config to get total qualified
        const qualConfig = calculateQualificationConfig(numberOfGroups, knockoutStage, false);
        const totalQualified = qualConfig.totalQualified;
        
        console.log(`[SUPER-SCHEDULE] Total qualified teams: ${totalQualified}`);
        
        // Determinar quantas partidas de cada fase baseado no número de qualificados
        // Para equipas: cada jogo tem 2 equipas
        let numQuarters = 0, numSemis = 0, numFinals = 0;
        
        if (knockoutStage === 'quarterfinals') {
          // Quartos: precisamos de totalQualified / 2 jogos (cada jogo tem 2 equipas)
          numQuarters = Math.ceil(totalQualified / 2);
          // Meias: vencedores dos quartos / 2
          numSemis = Math.ceil(numQuarters / 2);
          numFinals = 2; // Final + 3º lugar
          console.log(`[SUPER-SCHEDULE] QFs: ${numQuarters}, SFs: ${numSemis}, Finals: ${numFinals}`);
        } else if (knockoutStage === 'semifinals') {
          // Meias: totalQualified / 2 jogos
          numSemis = Math.ceil(totalQualified / 2);
          numFinals = 2; // Final + 3º lugar
          console.log(`[SUPER-SCHEDULE] SFs: ${numSemis}, Finals: ${numFinals}`);
        } else if (knockoutStage === 'final') {
          numFinals = 2; // Final + 3º lugar
          console.log(`[SUPER-SCHEDULE] Finals: ${numFinals}`);
        }
        
        // Criar confrontos de quartos de final
        for (let i = 0; i < numQuarters; i++) {
          const matchDate = new Date(startDate);
          matchDate.setDate(matchDate.getDate() + currentDayIndex);
          const totalMinutesFromStart = currentTimeSlot * matchDurationMinutes;
          const matchHour = startHours + Math.floor((startMinutes + totalMinutesFromStart) / 60);
          const matchMinute = (startMinutes + totalMinutesFromStart) % 60;
          matchDate.setHours(matchHour, matchMinute, 0, 0);
          
          knockoutConfronts.push({
            tournament_id: tournament.id,
            category_id: cat.id,
            round: 'quarter_final',
            group_name: null,
            super_team_1_id: null, // TBD - será preenchido após fase de grupos
            super_team_2_id: null,
            scheduled_time: matchDate.toISOString(),
            court_name: availableCourts[i % numCourts],
          });
          
          // Avançar slot se necessário
          if ((i + 1) % numCourts === 0) {
            currentTimeSlot++;
            if (currentTimeSlot >= slotsPerCourtPerDay) {
              currentTimeSlot = 0;
              currentDayIndex++;
            }
          }
        }
        
        // Avançar para próximo slot após quartos
        if (numQuarters > 0) {
          currentTimeSlot++;
          if (currentTimeSlot >= slotsPerCourtPerDay) {
            currentTimeSlot = 0;
            currentDayIndex++;
          }
        }
        
        // Criar confrontos de meias-finais
        for (let i = 0; i < numSemis; i++) {
          const matchDate = new Date(startDate);
          matchDate.setDate(matchDate.getDate() + currentDayIndex);
          const totalMinutesFromStart = currentTimeSlot * matchDurationMinutes;
          const matchHour = startHours + Math.floor((startMinutes + totalMinutesFromStart) / 60);
          const matchMinute = (startMinutes + totalMinutesFromStart) % 60;
          matchDate.setHours(matchHour, matchMinute, 0, 0);
          
          knockoutConfronts.push({
            tournament_id: tournament.id,
            category_id: cat.id,
            round: 'semi_final',
            group_name: null,
            super_team_1_id: null,
            super_team_2_id: null,
            scheduled_time: matchDate.toISOString(),
            court_name: availableCourts[i % numCourts],
          });
          
          if ((i + 1) % numCourts === 0) {
            currentTimeSlot++;
            if (currentTimeSlot >= slotsPerCourtPerDay) {
              currentTimeSlot = 0;
              currentDayIndex++;
            }
          }
        }
        
        // Avançar para próximo slot após semis
        if (numSemis > 0) {
          currentTimeSlot++;
          if (currentTimeSlot >= slotsPerCourtPerDay) {
            currentTimeSlot = 0;
            currentDayIndex++;
          }
        }
        
        // Criar 3º lugar e final
        if (numFinals >= 1) {
          // 3º lugar
          const thirdPlaceDate = new Date(startDate);
          thirdPlaceDate.setDate(thirdPlaceDate.getDate() + currentDayIndex);
          const totalMinutes3rd = currentTimeSlot * matchDurationMinutes;
          const hour3rd = startHours + Math.floor((startMinutes + totalMinutes3rd) / 60);
          const minute3rd = (startMinutes + totalMinutes3rd) % 60;
          thirdPlaceDate.setHours(hour3rd, minute3rd, 0, 0);
          
          knockoutConfronts.push({
            tournament_id: tournament.id,
            category_id: cat.id,
            round: 'third_place',
            group_name: null,
            super_team_1_id: null,
            super_team_2_id: null,
            scheduled_time: thirdPlaceDate.toISOString(),
            court_name: availableCourts[0],
          });
        }
        
        if (numFinals >= 2) {
          // Final (no mesmo slot mas campo diferente, ou slot seguinte)
          const finalDate = new Date(startDate);
          finalDate.setDate(finalDate.getDate() + currentDayIndex);
          const totalMinutesFinal = currentTimeSlot * matchDurationMinutes;
          const hourFinal = startHours + Math.floor((startMinutes + totalMinutesFinal) / 60);
          const minuteFinal = (startMinutes + totalMinutesFinal) % 60;
          finalDate.setHours(hourFinal, minuteFinal, 0, 0);
          
          knockoutConfronts.push({
            tournament_id: tournament.id,
            category_id: cat.id,
            round: 'final',
            group_name: null,
            super_team_1_id: null,
            super_team_2_id: null,
            scheduled_time: finalDate.toISOString(),
            court_name: numCourts > 1 ? availableCourts[1] : availableCourts[0],
          });
          
          currentTimeSlot++;
          if (currentTimeSlot >= slotsPerCourtPerDay) {
            currentTimeSlot = 0;
            currentDayIndex++;
          }
        }
      }
      
      console.log(`[SUPER-SCHEDULE] Knockout confronts to insert: ${knockoutConfronts.length}`);
      
      // Inserir todos os confrontos (grupo + eliminatórias)
      const allToInsert = [...toInsert, ...knockoutConfronts];
      
      const { error } = await supabase.from('super_team_confrontations').insert(allToInsert);
      if (error) throw error;
      alert(`${toInsert.length} jogos de grupo + ${knockoutConfronts.length} jogos de eliminatórias gerados!`);
      await fetchTournamentData();
    } catch (e) {
      console.error(e);
      alert('Erro ao gerar calendário.');
    } finally {
      setLoading(false);
    }
  };

  const handleSuperTeamsDeleteAllConfrontations = async () => {
    if (!currentTournament || currentTournament.format !== 'super_teams') return;
    const confirmed = confirm('Eliminar todos os confrontos deste torneio? A classificação também será limpa.');
    if (!confirmed) return;
    setLoading(true);
    try {
      // Eliminar standings primeiro
      await supabase.from('super_team_standings').delete().eq('tournament_id', tournament.id);
      // Eliminar confrontos
      const { error } = await supabase.from('super_team_confrontations').delete().eq('tournament_id', tournament.id);
      if (error) throw error;
      await fetchTournamentData();
    } catch (e) {
      console.error(e);
      alert('Erro ao eliminar confrontos.');
    } finally {
      setLoading(false);
    }
  };

  const fetchTournamentData = async (silent = false) => {
    console.log('[FETCH] Starting fetchTournamentData for tournament:', tournament.id, silent ? '(silent)' : '');
    if (!silent) setLoading(true);

    if (currentTournament?.format === 'super_teams') {
      const [categoriesResult, teamsResult, confrontationsResult, standingsResult] = await Promise.all([
        supabase
          .from('tournament_categories')
          .select('id, name, format, number_of_groups, max_teams, knockout_stage, qualified_per_group, rounds')
          .eq('tournament_id', tournament.id)
          .order('name'),
        supabase
          .from('super_teams')
          .select('id, tournament_id, category_id, name, group_name, super_team_players:super_team_players(id, name, email, phone_number, is_captain, player_order)')
          .eq('tournament_id', tournament.id)
          .order('name'),
        supabase
          .from('super_team_confrontations')
          .select('*')
          .eq('tournament_id', tournament.id)
          .order('scheduled_time', { ascending: true, nullsFirst: false }),
        supabase
          .from('super_team_standings')
          .select('id, tournament_id, category_id, super_team_id, group_name, confrontations_played, confrontations_won, confrontations_lost, games_won, games_lost, games_diff, points, position')
          .eq('tournament_id', tournament.id)
      ]);
      if (categoriesResult.data) setCategories(categoriesResult.data);
      if (teamsResult.data) setSuperTeams(teamsResult.data as unknown as SuperTeamRow[]);
      if (confrontationsResult.data) setSuperTeamConfrontations(confrontationsResult.data as SuperTeamConfrontationRow[]);
      if (standingsResult.data) setSuperTeamStandings(standingsResult.data as SuperTeamStandingRow[]);
      setTeams([]);
      setMatches([]);
      setIndividualPlayers([]);
    } else if (isIndividualGroupsKnockout || isIndividualRoundRobin) {
      // Formatos individuais: individual_groups_knockout e round_robin+individual (Americano Individual)
      const [playersResult, matchesResult, categoriesResult] = await Promise.all([
        supabase
          .from('players')
          .select('id, name, email, phone_number, group_name, seed, category_id, user_id, created_at, final_position')
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

        // Use tournament.format (prop) to avoid stale currentTournament state
        if (tournament.format === 'individual_groups_knockout' && playersResult.data && playersResult.data.length > 0) {
          const groupMatches = matchesResult.data.filter((m: any) => m.round.startsWith('group_'));
          const knockoutMatches = matchesResult.data.filter((m: any) => !m.round.startsWith('group_'));
          const allGroupsDone = groupMatches.length > 0 && groupMatches.every((m: any) => m.status === 'completed');
          
          // IMPORTANT: Only check the FIRST knockout round (QFs or SFs) to avoid infinite loop.
          // Later rounds (SF, final, 3rd_place) are expected to be empty until earlier rounds complete.
          const hasQFs = knockoutMatches.some((m: any) => m.round === 'quarterfinal' || m.round === 'quarter_final');
          const firstRoundMatches = hasQFs
            ? knockoutMatches.filter((m: any) => m.round === 'quarterfinal' || m.round === 'quarter_final')
            : knockoutMatches.filter((m: any) => m.round === 'semifinal');
          const hasUnpopulatedFirstRound = firstRoundMatches.length > 0 && firstRoundMatches.some((m: any) =>
            !m.player1_individual_id && !m.player3_individual_id
          );
          
          if (allGroupsDone && hasUnpopulatedFirstRound) {
            console.log('[FETCH] individual_groups_knockout: Auto-populating knockout brackets (first round only)');
            populatePlacementMatches(tournament.id).then(() => {
              fetchTournamentData();
            });
            return;
          }
        }
      }
      if (categoriesResult.data) {
        console.log('[FETCH] Loaded', categoriesResult.data.length, 'categories');
        setCategories(categoriesResult.data);
      }

      // ================================================================
      // AUTO-POPULATE KNOCKOUT quando todos os grupos estão completos
      // ================================================================
      if (matchesResult.data && playersResult.data && categoriesResult.data) {
        const allMatchesLocal = matchesResult.data as unknown as MatchWithTeams[];
        const groupMatchesLocal = allMatchesLocal.filter(m => m.round?.startsWith('group_'));
        const allGroupsDoneLocal = groupMatchesLocal.length > 0 && groupMatchesLocal.every(m => m.status === 'completed');
        const hasCrossedRounds = matchesResult.data.some((m: any) => m.round === 'crossed_r1_j1');
        const hasSemifinalRounds = matchesResult.data.some((m: any) => m.round === 'semifinal');
        
        console.log('[FETCH-CHECK] Format:', currentTournament?.format, 'Groups:', groupMatchesLocal.length, 'All done:', allGroupsDoneLocal, 'HasCrossed:', hasCrossedRounds, 'HasSemifinal:', hasSemifinalRounds);
        
        // AUTO-FIX: Se mixed_american/mixed_gender tem crossed rounds incorretos, corrigir imediatamente
        if ((currentTournament?.format === 'mixed_american' || currentTournament?.format === 'mixed_gender') && hasCrossedRounds) {
          console.log('[FETCH-FIX] mixed_american/mixed_gender com crossed rounds incorretos - corrigindo...');
          await supabase.from('matches').delete()
            .eq('tournament_id', tournament.id)
            .like('round', 'crossed_%');
          
          if (!hasSemifinalRounds) {
            const maxNum = Math.max(...matchesResult.data!.map((m: any) => m.match_number || 0));
            const matchDur = currentTournament.match_duration_minutes || 30;
            const lastGroupMatch = [...groupMatchesLocal].sort((a, b) => 
              new Date(b.scheduled_time || 0).getTime() - new Date(a.scheduled_time || 0).getTime())[0];
            const koTime = lastGroupMatch?.scheduled_time 
              ? new Date(new Date(lastGroupMatch.scheduled_time).getTime() + matchDur * 60000).toISOString()
              : new Date().toISOString();
            
            await supabase.from('matches').insert([
              { tournament_id: tournament.id, category_id: null, round: 'semifinal', match_number: maxNum + 1, scheduled_time: koTime, court: '1', status: 'scheduled' },
              { tournament_id: tournament.id, category_id: null, round: 'semifinal', match_number: maxNum + 2, scheduled_time: koTime, court: '2', status: 'scheduled' },
              { tournament_id: tournament.id, category_id: null, round: '3rd_place', match_number: maxNum + 3, scheduled_time: koTime, court: '1', status: 'scheduled' },
              { tournament_id: tournament.id, category_id: null, round: 'final', match_number: maxNum + 4, scheduled_time: koTime, court: '2', status: 'scheduled' },
            ]);
            console.log('[FETCH-FIX] Crossed rounds apagados, 4 knockout corretos criados. Refetching...');
            await fetchTournamentData(); return;
          }
        }
        
        if (allGroupsDoneLocal) {
          const localCategories = categoriesResult.data as Array<{ id: string; name: string }>;
          const localPlayers = playersResult.data as Array<{ id: string; name: string; category_id: string }>;
          const sortedCats = [...localCategories].sort((a, b) => a.name.localeCompare(b.name));
          
          // Função para calcular rankings de uma categoria
          // USA sortTeamsByTiebreaker (mesma função que Standings.tsx) para rankings idênticos
          const getCatRankings = (categoryId: string) => {
            const catPlayers = localPlayers.filter(p => p.category_id === categoryId);
            const catMatches = matchesResult.data!.filter((m: any) => 
              m.category_id === categoryId && m.round?.startsWith('group_') && m.status === 'completed'
            );
            
            // Construir TeamStats para cada jogador
            const playerStatsMap = new Map<string, { id: string; name: string; wins: number; draws: number; gamesWon: number; gamesLost: number }>();
            catPlayers.forEach(p => playerStatsMap.set(p.id, { id: p.id, name: p.name, wins: 0, draws: 0, gamesWon: 0, gamesLost: 0 }));
            
            catMatches.forEach((match: any) => {
              const t1G = (match.team1_score_set1||0)+(match.team1_score_set2||0)+(match.team1_score_set3||0);
              const t2G = (match.team2_score_set1||0)+(match.team2_score_set2||0)+(match.team2_score_set3||0);
              const t1Won = t1G > t2G;
              const isDraw = t1G === t2G;
              [match.player1_individual_id, match.player2_individual_id].filter(Boolean).forEach((pid: string) => {
                const s = playerStatsMap.get(pid);
                if (s) { s.gamesWon += t1G; s.gamesLost += t2G; if (isDraw) s.draws++; else if (t1Won) s.wins++; }
              });
              [match.player3_individual_id, match.player4_individual_id].filter(Boolean).forEach((pid: string) => {
                const s = playerStatsMap.get(pid);
                if (s) { s.gamesWon += t2G; s.gamesLost += t1G; if (isDraw) s.draws++; else if (!t1Won) s.wins++; }
              });
            });
            
            // Construir arrays no formato TeamStats para sortTeamsByTiebreaker
            const teamStatsArr: TeamStats[] = Array.from(playerStatsMap.values()).map(p => ({
              id: p.id, name: p.name, group_name: '', wins: p.wins, draws: p.draws, gamesWon: p.gamesWon, gamesLost: p.gamesLost
            }));
            
            // INDIVIDUAL AMERICANO: NÃO existe confronto direto (parceiros mudam a cada ronda)
            // Critérios de desempate: 1° Vitórias > 2° Pontos > 3° Diferença de jogos > 4° Jogos ganhos > 5° Data inscrição
            const sorted = sortTeamsByTiebreaker(teamStatsArr, []);
            console.log(`[getCatRankings] Category ${categoryId}: ${sorted.map((s,i) => `${i+1}°${s.name}(W:${s.wins},GD:${s.gamesWon-s.gamesLost},GW:${s.gamesWon})`).join(', ')}`);
            return sorted.map(s => ({ id: s.id, name: s.name, wins: s.wins, gamesWon: s.gamesWon, gamesLost: s.gamesLost }));
          };

          try {
            // ================================================================
            // MIXED AMERICAN: popular meias-finais com cruzamento F + M
            // ================================================================
            if (currentTournament?.format === 'mixed_american' || currentTournament?.format === 'mixed_gender') {
              // Se tem rounds crossed errados (de torneio antigo), apagar e recriar
              if (hasCrossedRounds) {
                console.log('[FETCH-FILL] MA: Apagando crossed rounds incorretos...');
                await supabase.from('matches').delete()
                  .eq('tournament_id', tournament.id)
                  .like('round', 'crossed_%');
                
                // Criar os 4 matches corretos se não existem
                if (!hasSemifinalRounds) {
                  const maxNum = Math.max(...matchesResult.data!.map((m: any) => m.match_number || 0));
                  const matchDuration = currentTournament.match_duration_minutes || 30;
                  const lastGroup = groupMatchesLocal.sort((a, b) => 
                    new Date(b.scheduled_time || 0).getTime() - new Date(a.scheduled_time || 0).getTime())[0];
                  const knockoutTime = lastGroup?.scheduled_time 
                    ? new Date(new Date(lastGroup.scheduled_time).getTime() + matchDuration * 60000).toISOString()
                    : new Date().toISOString();
                  
                  await supabase.from('matches').insert([
                    { tournament_id: tournament.id, category_id: null, round: 'semifinal', match_number: maxNum + 1, scheduled_time: knockoutTime, court: '1', status: 'scheduled' },
                    { tournament_id: tournament.id, category_id: null, round: 'semifinal', match_number: maxNum + 2, scheduled_time: knockoutTime, court: '2', status: 'scheduled' },
                    { tournament_id: tournament.id, category_id: null, round: '3rd_place', match_number: maxNum + 3, scheduled_time: knockoutTime, court: '1', status: 'scheduled' },
                    { tournament_id: tournament.id, category_id: null, round: 'final', match_number: maxNum + 4, scheduled_time: knockoutTime, court: '2', status: 'scheduled' },
                  ]);
                  console.log('[FETCH-FILL] MA: Criados 4 matches knockout corretos. Refetching...');
                  await fetchTournamentData(); return;
                }
              }
              
              // Popular meias-finais (verificar sempre para corrigir populações incorretas)
              if (hasSemifinalRounds && sortedCats.length >= 2) {
                const sfMatches = matchesResult.data!
                  .filter((m: any) => m.round === 'semifinal')
                  .sort((a: any, b: any) => a.match_number - b.match_number);
                
                if (sfMatches.length >= 2) {
                  const rankF = getCatRankings(sortedCats[0].id);
                  const rankM = getCatRankings(sortedCats[1].id);
                  console.log(`[FETCH-FILL] MA Rankings: ${sortedCats[0].name}=[${rankF.map(p=>p.name)}], ${sortedCats[1].name}=[${rankM.map(p=>p.name)}]`);
                  
                  if (rankF.length >= 4 && rankM.length >= 4) {
                    // Verificar se os emparelhamentos estão corretos
                    const sf1 = sfMatches[0];
                    const expectedSF1 = {
                      p1: rankF[0].id, p2: rankM[3].id,
                      p3: rankF[1].id, p4: rankM[2].id
                    };
                    const expectedSF2 = {
                      p1: rankF[2].id, p2: rankM[1].id,
                      p3: rankF[3].id, p4: rankM[0].id
                    };
                    
                    const sf1Correct = sf1.player1_individual_id === expectedSF1.p1 &&
                                       sf1.player2_individual_id === expectedSF1.p2 &&
                                       sf1.player3_individual_id === expectedSF1.p3 &&
                                       sf1.player4_individual_id === expectedSF1.p4;
                    const sf2 = sfMatches[1];
                    const sf2Correct = sf2.player1_individual_id === expectedSF2.p1 &&
                                       sf2.player2_individual_id === expectedSF2.p2 &&
                                       sf2.player3_individual_id === expectedSF2.p3 &&
                                       sf2.player4_individual_id === expectedSF2.p4;
                    
                    if (!sf1Correct || !sf2Correct) {
                      console.log('[FETCH-FILL] MA Semifinals incorretas ou vazias, corrigindo...');
                      // SF1: (1°F + 4°M) vs (2°F + 3°M)
                      await supabase.from('matches').update({
                        player1_individual_id: expectedSF1.p1, player2_individual_id: expectedSF1.p2,
                        player3_individual_id: expectedSF1.p3, player4_individual_id: expectedSF1.p4
                      }).eq('id', sfMatches[0].id);
                      // SF2: (3°F + 2°M) vs (4°F + 1°M)
                      await supabase.from('matches').update({
                        player1_individual_id: expectedSF2.p1, player2_individual_id: expectedSF2.p2,
                        player3_individual_id: expectedSF2.p3, player4_individual_id: expectedSF2.p4
                      }).eq('id', sfMatches[1].id);
                      
                      // Limpar final e 3°/4° se tinham jogadores errados
                      const finalMatch = matchesResult.data!.find((m: any) => m.round === 'final');
                      const thirdMatch = matchesResult.data!.find((m: any) => m.round === '3rd_place');
                      if (finalMatch && finalMatch.status !== 'completed') {
                        await supabase.from('matches').update({
                          player1_individual_id: null, player2_individual_id: null,
                          player3_individual_id: null, player4_individual_id: null
                        }).eq('id', finalMatch.id);
                      }
                      if (thirdMatch && thirdMatch.status !== 'completed') {
                        await supabase.from('matches').update({
                          player1_individual_id: null, player2_individual_id: null,
                          player3_individual_id: null, player4_individual_id: null
                        }).eq('id', thirdMatch.id);
                      }
                      
                      console.log('[FETCH-FILL] MA Semifinals corrigidas! Refreshing...');
                      await fetchTournamentData(); return;
                    } else {
                      console.log('[FETCH-FILL] MA Semifinals já estão corretas');
                    }
                  }
                }
              }
            }
            
            // ================================================================
            // CROSSED PLAYOFFS: preencher R1 se vazio
            // ================================================================
            if (currentTournament?.format === 'crossed_playoffs' && hasCrossedRounds) {
              const r1j1Local = allMatchesLocal.find(m => m.round === 'crossed_r1_j1');
              if (r1j1Local && !r1j1Local.player1_individual_id && sortedCats.length >= 2 && sortedCats.length <= 3) {
                console.log('[FETCH-FILL] Filling crossed playoffs R1...');
                
                if (sortedCats.length === 3) {
                  const [catA, catB, catC] = sortedCats;
                  const rankA = getCatRankings(catA.id), rankB = getCatRankings(catB.id), rankC = getCatRankings(catC.id);
                  if (rankA.length >= 4 && rankB.length >= 4 && rankC.length >= 4) {
                    console.log(`[FETCH-FILL] 3-cat: A=[${rankA.map(p=>p.name)}], B=[${rankB.map(p=>p.name)}], C=[${rankC.map(p=>p.name)}]`);
                    // J1: (1°A + 4°C) vs (2°A + 3°C)
                    await supabase.from('matches').update({ player1_individual_id: rankA[0].id, player2_individual_id: rankC[3].id, player3_individual_id: rankA[1].id, player4_individual_id: rankC[2].id }).eq('round', 'crossed_r1_j1').eq('tournament_id', tournament.id);
                    // J2: (3°A + 2°B) vs (4°A + 1°B)
                    await supabase.from('matches').update({ player1_individual_id: rankA[2].id, player2_individual_id: rankB[1].id, player3_individual_id: rankA[3].id, player4_individual_id: rankB[0].id }).eq('round', 'crossed_r1_j2').eq('tournament_id', tournament.id);
                    // J3: (3°B + 2°C) vs (4°B + 1°C)
                    await supabase.from('matches').update({ player1_individual_id: rankB[2].id, player2_individual_id: rankC[1].id, player3_individual_id: rankB[3].id, player4_individual_id: rankC[0].id }).eq('round', 'crossed_r1_j3').eq('tournament_id', tournament.id);
                    console.log('[FETCH-FILL] R1 filled (3 cat)! Refreshing...');
                    await fetchTournamentData(); return;
                  }
                } else if (sortedCats.length === 2) {
                  const [catA, catB] = sortedCats;
                  const rankA = getCatRankings(catA.id), rankB = getCatRankings(catB.id);
                  if (rankA.length >= 4 && rankB.length >= 4) {
                    console.log(`[FETCH-FILL] 2-cat: A=[${rankA.map(p=>p.name)}], B=[${rankB.map(p=>p.name)}]`);
                    await supabase.from('matches').update({ player1_individual_id: rankA[0].id, player2_individual_id: rankB[3].id, player3_individual_id: rankB[0].id, player4_individual_id: rankA[3].id }).eq('round', 'crossed_r1_j1').eq('tournament_id', tournament.id);
                    await supabase.from('matches').update({ player1_individual_id: rankA[1].id, player2_individual_id: rankB[2].id, player3_individual_id: rankB[1].id, player4_individual_id: rankA[2].id }).eq('round', 'crossed_r1_j2').eq('tournament_id', tournament.id);
                    await supabase.from('matches').update({ player1_individual_id: rankA[0].id, player2_individual_id: rankB[1].id, player3_individual_id: rankB[0].id, player4_individual_id: rankA[1].id }).eq('round', 'crossed_r1_j3').eq('tournament_id', tournament.id);
                    console.log('[FETCH-FILL] R1 filled (2 cat)! Refreshing...');
                    await fetchTournamentData(); return;
                  }
                }
              }
            }
          } catch (err) {
            console.error('[FETCH-FILL] Error:', err);
          }
        }
      }
    } else {
      setSuperTeams([]);
      setSuperTeamConfrontations([]);
      setSuperTeamStandings([]);
      const [teamsResult, playersResult, matchesResult, categoriesResult] = await Promise.all([
        supabase
          .from('teams')
          .select('id, name, group_name, seed, status, category_id, player1_id, player2_id, final_position, player1:players!teams_player1_id_fkey(id, name, email, phone_number), player2:players!teams_player2_id_fkey(id, name, email, phone_number)')
          .eq('tournament_id', tournament.id)
          .order('seed', { ascending: true }),
        supabase
          .from('players')
          .select('id, name, email, phone_number, group_name, seed, category_id, user_id, created_at, final_position')
          .eq('tournament_id', tournament.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('matches')
          .select(`
            id, match_number, round, scheduled_time, court, team1_id, team2_id, team1_score_set1, team2_score_set1, team1_score_set2, team2_score_set2, team1_score_set3, team2_score_set3, status, category_id,
            player1_individual_id, player2_individual_id, player3_individual_id, player4_individual_id,
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

    // Scroll to the match that was just closed (after DOM update)
    if (scrollToMatchIdRef.current) {
      const matchId = scrollToMatchIdRef.current;
      scrollToMatchIdRef.current = null;
      requestAnimationFrame(() => {
        const el = document.getElementById(`match-${matchId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Brief highlight effect
          el.classList.add('ring-2', 'ring-blue-400', 'ring-offset-2');
          setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-2'), 2000);
        }
      });
    }
  };

  const handleAssignGroups = async () => {
    const validFormats = ['groups_knockout', 'individual_groups_knockout', 'crossed_playoffs', 'mixed_gender', 'mixed_american'];
    if (!validFormats.includes(currentTournament.format || '')) {
      alert('Group assignment is only available for Groups + Knockout, Crossed Playoffs, Mixed Gender and Mixed American formats');
      return;
    }

    const isIndividualFormat = currentTournament.format === 'individual_groups_knockout' || 
                               currentTournament.format === 'crossed_playoffs' || 
                               currentTournament.format === 'mixed_gender' ||
                               currentTournament.format === 'mixed_american';
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
          
          // Para mixed_american / mixed_gender, cada categoria = 1 grupo (A, B)
          if (currentTournament.format === 'mixed_american' || currentTournament.format === 'mixed_gender') {
            const sortedCatsMA = [...categories].sort((a, b) => a.name.localeCompare(b.name));
            const allPlayersWithCatGroups: any[] = [];
            sortedCatsMA.forEach((cat, catIdx) => {
              const groupName = String.fromCharCode(65 + catIdx); // A, B
              const catPlayers = individualPlayers.filter(p => p.category_id === cat.id);
              catPlayers.forEach(player => {
                allPlayersWithCatGroups.push({ ...player, group_name: groupName });
              });
              console.log(`[ASSIGN GROUPS] Mixed American: ${catPlayers.length} players of ${cat.name} → group ${groupName}`);
            });
            await savePlayerGroupAssignments(allPlayersWithCatGroups);
            console.log('[ASSIGN GROUPS] Mixed American: Total', allPlayersWithCatGroups.length, 'players assigned');
            await fetchTournamentData();
            setLoading(false);
            return;
          }
          
          // Para playoffs cruzados, cada categoria = 1 grupo com nome diferente (A, B, C...)
          const isCrossedPlayoffs = currentTournament.format === 'crossed_playoffs';
          
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
        // Check if we have quarterfinal matches to populate first
        const quarterfinalMatches = categoryMatches
          .filter(m => m.round === 'quarterfinal' || m.round === 'quarter_final')
          .sort((a, b) => a.match_number - b.match_number);
        
        const hasUnpopulatedQFs = quarterfinalMatches.some(m => 
          !m.player1_individual_id && !m.player3_individual_id
        );

        if (quarterfinalMatches.length > 0 && hasUnpopulatedQFs) {
          // QUARTERFINALS: populate with cross-group matchups
          const confirmed = confirm(
            `This will assign ${qualifiedPlayers.length} qualified players to ${quarterfinalMatches.length} quarterfinals. Continue?`
          );
          if (!confirmed) {
            setLoading(false);
            return;
          }

          if (sortedGroupNames.length === 2) {
            const groupA = sortedGroupNames[0];
            const groupB = sortedGroupNames[1];
            const playersA = qualifiedByGroup.get(groupA)!;
            const playersB = qualifiedByGroup.get(groupB)!;
            
            const unpopulatedQFs = quarterfinalMatches.filter(m => 
              !m.player1_individual_id && !m.player3_individual_id
            );
            
            const maxQFs = Math.min(unpopulatedQFs.length, Math.floor(Math.min(playersA.length, playersB.length) / 2));
            
            for (let i = 0; i < maxQFs; i++) {
              const startRank = i * 2;
              const a1 = playersA[startRank];
              const a2 = playersA[startRank + 1];
              const b1 = playersB[startRank];
              const b2 = playersB[startRank + 1];
              
              if (!a1 || !a2 || !b1 || !b2) break;
              
              const { error } = await supabase.from('matches').update({
                player1_individual_id: a1,
                player2_individual_id: b2,
                player3_individual_id: b1,
                player4_individual_id: a2,
              }).eq('id', unpopulatedQFs[i].id);
              
              if (error) throw error;
            }
            
            // Delete extra empty QF matches
            for (let i = maxQFs; i < unpopulatedQFs.length; i++) {
              await supabase.from('matches').delete().eq('id', unpopulatedQFs[i].id);
            }
          } else {
            // Multiple groups: use populatePlacementMatches for proper seeding
            await populatePlacementMatches(tournament.id, categoryId);
          }
          
          await fetchTournamentData();
          alert('Quarterfinals generated with cross-group matchups!');
        } else {
          // SEMIFINALS: standard flow
          const semifinalMatches = categoryMatches.filter(m => m.round === 'semifinal');
          if (semifinalMatches.length !== 2) {
            alert('Expected exactly 2 semifinal matches');
            setLoading(false);
            return;
          }

          semifinalMatches.sort((a, b) => a.match_number - b.match_number);

          const confirmed = confirm(
            'This will assign qualified players to semifinals with cross-group matchups. Continue?'
          );
          if (!confirmed) {
            setLoading(false);
            return;
          }

          if (sortedGroupNames.length === 2 && qualifiedByGroup.size === 2) {
            // Cross-group matchups for 2 groups
            const groupA = sortedGroupNames[0];
            const groupB = sortedGroupNames[1];
            const playersA = qualifiedByGroup.get(groupA)!;
            const playersB = qualifiedByGroup.get(groupB)!;
            
            // SF1: A1+B2 vs B1+A2
            const { error: sf1Error } = await supabase.from('matches').update({
              player1_individual_id: playersA[0],
              player2_individual_id: playersB[1],
              player3_individual_id: playersB[0],
              player4_individual_id: playersA[1],
            }).eq('id', semifinalMatches[0].id);
            if (sf1Error) throw sf1Error;

            if (playersA.length >= 4 && playersB.length >= 4) {
              // SF2: A3+B4 vs B3+A4
              const { error: sf2Error } = await supabase.from('matches').update({
                player1_individual_id: playersA[2],
                player2_individual_id: playersB[3],
                player3_individual_id: playersB[2],
                player4_individual_id: playersA[3],
              }).eq('id', semifinalMatches[1].id);
              if (sf2Error) throw sf2Error;
            }
          } else {
            // Shuffle for 3+ groups
            const shuffle = (array: string[]) => {
              const shuffled = [...array];
              for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
              }
              return shuffled;
            };
            const shuffledQualified = shuffle(qualifiedPlayers);

            const { error: sf1Error } = await supabase.from('matches').update({
              player1_individual_id: shuffledQualified[0],
              player2_individual_id: shuffledQualified[1],
              player3_individual_id: shuffledQualified[2],
              player4_individual_id: shuffledQualified[3],
            }).eq('id', semifinalMatches[0].id);
            if (sf1Error) throw sf1Error;

            if (shuffledQualified.length >= 8) {
              const { error: sf2Error } = await supabase.from('matches').update({
                player1_individual_id: shuffledQualified[4],
                player2_individual_id: shuffledQualified[5],
                player3_individual_id: shuffledQualified[6],
                player4_individual_id: shuffledQualified[7],
              }).eq('id', semifinalMatches[1].id);
              if (sf2Error) throw sf2Error;
            }
          }

          await fetchTournamentData();
          alert('Semifinals generated with cross-group matchups!');
        }
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
      `  J1: (1°A + 4°C) vs (2°A + 3°C) → (${rankA[0].name} + ${rankC[3].name}) vs (${rankA[1].name} + ${rankC[2].name})\n` +
      `  J2: (3°A + 2°B) vs (4°A + 1°B) → (${rankA[2].name} + ${rankB[1].name}) vs (${rankA[3].name} + ${rankB[0].name})\n` +
      `  J3: (3°B + 2°C) vs (4°B + 1°C) → (${rankB[2].name} + ${rankC[1].name}) vs (${rankB[3].name} + ${rankC[0].name})\n\n` +
      `RONDA 2:\n` +
      `  J4: Vencedor J1 vs Vencedor J2\n` +
      `  J5: Vencedor J3 vs Melhor Perdedor (J1 ou J2, baseado em games)\n` +
      `  J6: Perdedor J3 vs Pior Perdedor → 5º/6º\n\n` +
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
        { // J2: (A3 + B2) vs (A4 + B1) - corrigido: 3°M3+2°M4 vs 4°M3+1°M4
          round: 'crossed_r1_j2',
          p1: rankA[2].id, p2: rankB[1].id,
          p3: rankA[3].id, p4: rankB[0].id
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

  // Função para avançar meias-finais → final e 3°/4° lugar
  const autoAdvanceSemifinals = async (currentMatches: MatchWithTeams[]) => {
    console.log('[AUTO_ADVANCE_SF] Checking semifinals...');
    
    const sfMatches = currentMatches
      .filter(m => m.round === 'semifinal')
      .sort((a, b) => a.match_number - b.match_number);
    const finalMatch = currentMatches.find(m => m.round === 'final');
    const thirdPlaceMatch = currentMatches.find(m => m.round === '3rd_place');
    
    if (sfMatches.length < 2 || !finalMatch || !thirdPlaceMatch) {
      console.log('[AUTO_ADVANCE_SF] Missing matches: SF=', sfMatches.length, 'Final=', !!finalMatch, '3rd=', !!thirdPlaceMatch);
      return;
    }
    
    // Verificar se ambas as meias-finais estão completas
    if (sfMatches[0].status !== 'completed' || sfMatches[1].status !== 'completed') {
      console.log('[AUTO_ADVANCE_SF] Not both semifinals completed yet');
      return;
    }
    
    // Se a final já tem jogadores, não preencher novamente
    if (finalMatch.player1_individual_id) {
      console.log('[AUTO_ADVANCE_SF] Final already populated');
      return;
    }
    
    const getWinnerLoser = (match: MatchWithTeams) => {
      const t1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
      const t2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
      if (t1Games > t2Games) {
        return {
          winner: { p1: match.player1_individual_id, p2: match.player2_individual_id },
          loser: { p1: match.player3_individual_id, p2: match.player4_individual_id }
        };
      } else {
        return {
          winner: { p1: match.player3_individual_id, p2: match.player4_individual_id },
          loser: { p1: match.player1_individual_id, p2: match.player2_individual_id }
        };
      }
    };
    
    try {
      const sf1Result = getWinnerLoser(sfMatches[0]);
      const sf2Result = getWinnerLoser(sfMatches[1]);
      
      // Final: Vencedor SF1 vs Vencedor SF2
      await supabase.from('matches').update({
        player1_individual_id: sf1Result.winner.p1,
        player2_individual_id: sf1Result.winner.p2,
        player3_individual_id: sf2Result.winner.p1,
        player4_individual_id: sf2Result.winner.p2,
      }).eq('id', finalMatch.id);
      
      // 3°/4° lugar: Perdedor SF1 vs Perdedor SF2
      await supabase.from('matches').update({
        player1_individual_id: sf1Result.loser.p1,
        player2_individual_id: sf1Result.loser.p2,
        player3_individual_id: sf2Result.loser.p1,
        player4_individual_id: sf2Result.loser.p2,
      }).eq('id', thirdPlaceMatch.id);
      
      console.log('[AUTO_ADVANCE_SF] Final and 3rd place populated! Refreshing...');
      await fetchTournamentData();
    } catch (err) {
      console.error('[AUTO_ADVANCE_SF] Error:', err);
    }
  };

  // Função para avançar automaticamente os playoffs cruzados
  const autoAdvanceCrossedPlayoffs = async (currentMatches: MatchWithTeams[]) => {
    console.log('[AUTO_ADVANCE] Checking crossed playoffs...');
    
    // Usar novos nomes de rounds: j4, j5, j6, j7, j8
    const r1j1 = currentMatches.find(m => m.round === 'crossed_r1_j1');
    const r1j2 = currentMatches.find(m => m.round === 'crossed_r1_j2');
    const r1j3 = currentMatches.find(m => m.round === 'crossed_r1_j3');
    const r2j4 = currentMatches.find(m => m.round === 'crossed_r2_j4'); // SF1: Vencedor J1 vs Vencedor J2
    const r2j5 = currentMatches.find(m => m.round === 'crossed_r2_j5'); // SF2: Vencedor J3 vs Melhor Perdedor
    const r2j6 = currentMatches.find(m => m.round === 'crossed_r2_j6'); // 5º/6º: Perdedor J3 vs Pior Perdedor
    const r3j7 = currentMatches.find(m => m.round === 'crossed_r3_j7'); // Final
    const r3j8 = currentMatches.find(m => m.round === 'crossed_r3_j8'); // 3º/4º

    if (!r1j1 || !r1j2 || !r1j3 || !r2j4 || !r2j5 || !r2j6 || !r3j7 || !r3j8) {
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
      if (r1j1.status === 'completed' && r1j2.status === 'completed' && r1j3.status === 'completed' && !r2j4.player1_individual_id) {
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

        // J4: Vencedor J1 vs Vencedor J2
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
        }).eq('id', r2j4.id);

        // J5: Vencedor J3 vs Melhor Perdedor
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
        }).eq('id', r2j5.id);

        // J6: Perdedor J3 vs Pior Perdedor (5º/6º)
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
        }).eq('id', r2j6.id);

        console.log('[AUTO_ADVANCE] R2 updated!');
      }

      // Se R2 Semi-finais (J4, J5) estão completas e R3 tem TBD, preencher R3
      if (r2j4.status === 'completed' && r2j5.status === 'completed' && !r3j7.player1_individual_id) {
        console.log('[AUTO_ADVANCE] R2 semifinals complete, advancing to R3...');
        
        const resJ4 = getMatchResult(r2j4)!;
        const resJ5 = getMatchResult(r2j5)!;

        const winnerJ4 = resJ4.winner === 'team1'
          ? { p1: r2j4.player1_individual_id, p2: r2j4.player2_individual_id }
          : { p1: r2j4.player3_individual_id, p2: r2j4.player4_individual_id };
        const winnerJ5 = resJ5.winner === 'team1'
          ? { p1: r2j5.player1_individual_id, p2: r2j5.player2_individual_id }
          : { p1: r2j5.player3_individual_id, p2: r2j5.player4_individual_id };

        // J7: Final
        await supabase.from('matches').update({
          player1_individual_id: winnerJ4.p1,
          player2_individual_id: winnerJ4.p2,
          player3_individual_id: winnerJ5.p1,
          player4_individual_id: winnerJ5.p2,
        }).eq('id', r3j7.id);

        const loserJ4 = resJ4.loser === 'team1'
          ? { p1: r2j4.player1_individual_id, p2: r2j4.player2_individual_id }
          : { p1: r2j4.player3_individual_id, p2: r2j4.player4_individual_id };
        const loserJ5 = resJ5.loser === 'team1'
          ? { p1: r2j5.player1_individual_id, p2: r2j5.player2_individual_id }
          : { p1: r2j5.player3_individual_id, p2: r2j5.player4_individual_id };

        // J8: 3º/4º
        await supabase.from('matches').update({
          player1_individual_id: loserJ4.p1,
          player2_individual_id: loserJ4.p2,
          player3_individual_id: loserJ5.p1,
          player4_individual_id: loserJ5.p2,
        }).eq('id', r3j8.id);

        console.log('[AUTO_ADVANCE] R3 updated!');
      }

      // Refresh data
      await fetchTournamentData();
    } catch (error) {
      console.error('[AUTO_ADVANCE] Error:', error);
    }
  };
  
  // Função para verificar se todos os grupos terminaram e preencher R1 automaticamente
  const autoFillCrossedPlayoffsR1 = async (currentMatches: MatchWithTeams[]) => {
    console.log('[AUTO_FILL_R1] Checking if groups are complete...');
    
    // Verificar se existe R1 e se tem TBD
    const r1j1 = currentMatches.find(m => m.round === 'crossed_r1_j1');
    if (!r1j1 || r1j1.player1_individual_id) {
      console.log('[AUTO_FILL_R1] R1 already filled or not found');
      return;
    }
    
    // Verificar se todos os jogos de grupo estão completos
    const groupMatches = currentMatches.filter(m => m.round.startsWith('group_'));
    const incompleteGroups = groupMatches.filter(m => m.status !== 'completed');
    
    if (incompleteGroups.length > 0) {
      console.log(`[AUTO_FILL_R1] ${incompleteGroups.length} group matches still incomplete`);
      return;
    }
    
    if (groupMatches.length === 0) {
      console.log('[AUTO_FILL_R1] No group matches found');
      return;
    }
    
    console.log('[AUTO_FILL_R1] All groups complete! Filling R1 with ranked players...');
    
    // Ordenar categorias
    const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));
    if (sortedCategories.length < 2 || sortedCategories.length > 3) {
      console.log('[AUTO_FILL_R1] Need 2 or 3 categories, got', sortedCategories.length);
      return;
    }
    
    // Função para calcular ranking de uma categoria
    const getCategoryRankings = (categoryId: string) => {
      const categoryPlayers = individualPlayers.filter(p => p.category_id === categoryId);
      const categoryMatches = currentMatches.filter(m => 
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
          if (b.wins !== a.wins) return b.wins - a.wins;
          return (b.gamesWon - b.gamesLost) - (a.gamesWon - a.gamesLost);
        });
    };
    
    try {
      if (sortedCategories.length === 3) {
        // === 3 CATEGORIAS: lógica original ===
        const [catA, catB, catC] = sortedCategories;
        const rankA = getCategoryRankings(catA.id);
        const rankB = getCategoryRankings(catB.id);
        const rankC = getCategoryRankings(catC.id);
        
        if (rankA.length < 4 || rankB.length < 4 || rankC.length < 4) {
          console.log('[AUTO_FILL_R1] Not enough players ranked (need 4 per category)');
          return;
        }
        
        console.log(`[AUTO_FILL_R1] Rankings: A=${rankA.map(p=>p.name)}, B=${rankB.map(p=>p.name)}, C=${rankC.map(p=>p.name)}`);
        
        // J1: (1°A + 4°C) vs (2°A + 3°C)
        await supabase.from('matches').update({
          player1_individual_id: rankA[0].id,
          player2_individual_id: rankC[3].id,
          player3_individual_id: rankA[1].id,
          player4_individual_id: rankC[2].id,
        }).eq('round', 'crossed_r1_j1').eq('tournament_id', tournament.id);
        
        // J2: (3°A + 2°B) vs (4°A + 1°B)
        await supabase.from('matches').update({
          player1_individual_id: rankA[2].id,
          player2_individual_id: rankB[1].id,
          player3_individual_id: rankA[3].id,
          player4_individual_id: rankB[0].id,
        }).eq('round', 'crossed_r1_j2').eq('tournament_id', tournament.id);
        
        // J3: (3°B + 2°C) vs (4°B + 1°C)
        await supabase.from('matches').update({
          player1_individual_id: rankB[2].id,
          player2_individual_id: rankC[1].id,
          player3_individual_id: rankB[3].id,
          player4_individual_id: rankC[0].id,
        }).eq('round', 'crossed_r1_j3').eq('tournament_id', tournament.id);
        
      } else {
        // === 2 CATEGORIAS: nova lógica ===
        const [catA, catB] = sortedCategories;
        const rankA = getCategoryRankings(catA.id);
        const rankB = getCategoryRankings(catB.id);
        
        if (rankA.length < 4 || rankB.length < 4) {
          console.log('[AUTO_FILL_R1] Not enough players ranked for 2 categories (need 4 per category)');
          return;
        }
        
        console.log(`[AUTO_FILL_R1] 2-cat Rankings: A=${rankA.map(p=>p.name)}, B=${rankB.map(p=>p.name)}`);
        
        // J1: (1°A + 4°B) vs (1°B + 4°A) — Tops cruzam com últimos
        await supabase.from('matches').update({
          player1_individual_id: rankA[0].id,
          player2_individual_id: rankB[3].id,
          player3_individual_id: rankB[0].id,
          player4_individual_id: rankA[3].id,
        }).eq('round', 'crossed_r1_j1').eq('tournament_id', tournament.id);
        
        // J2: (2°A + 3°B) vs (2°B + 3°A) — Segundos cruzam com terceiros
        await supabase.from('matches').update({
          player1_individual_id: rankA[1].id,
          player2_individual_id: rankB[2].id,
          player3_individual_id: rankB[1].id,
          player4_individual_id: rankA[2].id,
        }).eq('round', 'crossed_r1_j2').eq('tournament_id', tournament.id);
        
        // J3: (1°A + 2°B) vs (1°B + 2°A) — Tops cruzam com segundos
        await supabase.from('matches').update({
          player1_individual_id: rankA[0].id,
          player2_individual_id: rankB[1].id,
          player3_individual_id: rankB[0].id,
          player4_individual_id: rankA[1].id,
        }).eq('round', 'crossed_r1_j3').eq('tournament_id', tournament.id);
      }
      
      console.log('[AUTO_FILL_R1] R1 matches filled with players!');
      await fetchTournamentData();
    } catch (error) {
      console.error('[AUTO_FILL_R1] Error:', error);
    }
  };

  // Função manual para avançar jogadores nos playoffs cruzados (botão)
  const handleAdvanceCrossedPlayoffs = async () => {
    console.log('[ADVANCE_CROSSED] Checking for matches to advance...');
    console.log('[ADVANCE_CROSSED] All crossed matches:', matches.filter(m => m.round.startsWith('crossed_')).map(m => ({ round: m.round, status: m.status, p1: m.player1_individual_id })));

    // Obter todas as partidas de playoffs cruzados - usar novos nomes
    const r1j1 = matches.find(m => m.round === 'crossed_r1_j1');
    const r1j2 = matches.find(m => m.round === 'crossed_r1_j2');
    const r1j3 = matches.find(m => m.round === 'crossed_r1_j3');
    const r2j4 = matches.find(m => m.round === 'crossed_r2_j4'); // SF1
    const r2j5 = matches.find(m => m.round === 'crossed_r2_j5'); // SF2
    const r2j6 = matches.find(m => m.round === 'crossed_r2_j6'); // 5º/6º
    const r3j7 = matches.find(m => m.round === 'crossed_r3_j7'); // Final
    const r3j8 = matches.find(m => m.round === 'crossed_r3_j8'); // 3º/4º

    if (!r1j1 || !r1j2 || !r1j3 || !r2j4 || !r2j5 || !r2j6 || !r3j7 || !r3j8) {
      const missing = [
        !r1j1 && 'J1', !r1j2 && 'J2', !r1j3 && 'J3',
        !r2j4 && 'J4', !r2j5 && 'J5', !r2j6 && 'J6',
        !r3j7 && 'J7', !r3j8 && 'J8'
      ].filter(Boolean).join(', ');
      alert(`Jogos não encontrados: ${missing}. Tenta refrescar a página.`);
      console.log('[ADVANCE_CROSSED] Missing matches:', missing);
      return;
    }

    console.log('[ADVANCE_CROSSED] R1 status:', { j1: r1j1.status, j2: r1j2.status, j3: r1j3.status });
    console.log('[ADVANCE_CROSSED] R2 TBD:', { j4: r2j4.player1_individual_id, j5: r2j5.player1_individual_id, j6: r2j6.player1_individual_id });

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
      // Se R1 está completo, preencher R2 (posições FIXAS, não baseadas em pontuação)
      if (r1j1.status === 'completed' && r1j2.status === 'completed' && r1j3.status === 'completed') {
        const res1 = getMatchResult(r1j1)!;
        const res2 = getMatchResult(r1j2)!;
        const res3 = getMatchResult(r1j3)!;

        // Extrair vencedores e perdedores de cada jogo
        const winner1 = res1.winner === 'team1' 
          ? { p1: r1j1.player1_individual_id, p2: r1j1.player2_individual_id }
          : { p1: r1j1.player3_individual_id, p2: r1j1.player4_individual_id };
        const loser1 = res1.loser === 'team1'
          ? { p1: r1j1.player1_individual_id, p2: r1j1.player2_individual_id }
          : { p1: r1j1.player3_individual_id, p2: r1j1.player4_individual_id };
        
        const winner2 = res2.winner === 'team1'
          ? { p1: r1j2.player1_individual_id, p2: r1j2.player2_individual_id }
          : { p1: r1j2.player3_individual_id, p2: r1j2.player4_individual_id };
        const loser2 = res2.loser === 'team1'
          ? { p1: r1j2.player1_individual_id, p2: r1j2.player2_individual_id }
          : { p1: r1j2.player3_individual_id, p2: r1j2.player4_individual_id };
        
        const winner3 = res3.winner === 'team1'
          ? { p1: r1j3.player1_individual_id, p2: r1j3.player2_individual_id }
          : { p1: r1j3.player3_individual_id, p2: r1j3.player4_individual_id };
        const loser3 = res3.loser === 'team1'
          ? { p1: r1j3.player1_individual_id, p2: r1j3.player2_individual_id }
          : { p1: r1j3.player3_individual_id, p2: r1j3.player4_individual_id };

        // J4: Vencedor J1 vs Vencedor J2
        if (!r2j4.player1_individual_id) {
          await supabase.from('matches').update({
            player1_individual_id: winner1.p1,
            player2_individual_id: winner1.p2,
            player3_individual_id: winner2.p1,
            player4_individual_id: winner2.p2,
          }).eq('id', r2j4.id);
        }

        // J5: Vencedor J3 vs Melhor Perdedor (J1 ou J2)
        const loser1Games = res1.loser === 'team1' ? res1.t1Games : res1.t2Games;
        const loser2Games = res2.loser === 'team1' ? res2.t1Games : res2.t2Games;
        const bestLoser = loser1Games >= loser2Games ? loser1 : loser2;
        const worstLoser = loser1Games >= loser2Games ? loser2 : loser1;
        
        if (!r2j5.player1_individual_id) {
          await supabase.from('matches').update({
            player1_individual_id: winner3.p1,
            player2_individual_id: winner3.p2,
            player3_individual_id: bestLoser.p1,
            player4_individual_id: bestLoser.p2,
          }).eq('id', r2j5.id);
        }

        // J6 (5º/6º): Perdedor J3 vs Pior Perdedor
        if (!r2j6.player1_individual_id) {
          await supabase.from('matches').update({
            player1_individual_id: loser3.p1,
            player2_individual_id: loser3.p2,
            player3_individual_id: worstLoser.p1,
            player4_individual_id: worstLoser.p2,
          }).eq('id', r2j6.id);
        }
      }

      // Se R2 (J4, J5) estão completas, preencher R3
      if (r2j4.status === 'completed' && r2j5.status === 'completed') {
        const resJ4 = getMatchResult(r2j4)!;
        const resJ5 = getMatchResult(r2j5)!;

        // J7: Final - Vencedor J4 vs Vencedor J5
        if (!r3j7.player1_individual_id) {
          const winnerJ4 = resJ4.winner === 'team1'
            ? { p1: r2j4.player1_individual_id, p2: r2j4.player2_individual_id }
            : { p1: r2j4.player3_individual_id, p2: r2j4.player4_individual_id };
          const winnerJ5 = resJ5.winner === 'team1'
            ? { p1: r2j5.player1_individual_id, p2: r2j5.player2_individual_id }
            : { p1: r2j5.player3_individual_id, p2: r2j5.player4_individual_id };

          await supabase.from('matches').update({
            player1_individual_id: winnerJ4.p1,
            player2_individual_id: winnerJ4.p2,
            player3_individual_id: winnerJ5.p1,
            player4_individual_id: winnerJ5.p2,
          }).eq('id', r3j7.id);
        }

        // J8: 3º/4º - Perdedor J4 vs Perdedor J5
        if (!r3j8.player1_individual_id) {
          const loserJ4 = resJ4.loser === 'team1'
            ? { p1: r2j4.player1_individual_id, p2: r2j4.player2_individual_id }
            : { p1: r2j4.player3_individual_id, p2: r2j4.player4_individual_id };
          const loserJ5 = resJ5.loser === 'team1'
            ? { p1: r2j5.player1_individual_id, p2: r2j5.player2_individual_id }
            : { p1: r2j5.player3_individual_id, p2: r2j5.player4_individual_id };

          await supabase.from('matches').update({
            player1_individual_id: loserJ4.p1,
            player2_individual_id: loserJ4.p2,
            player3_individual_id: loserJ5.p1,
            player4_individual_id: loserJ5.p2,
          }).eq('id', r3j8.id);
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
      const matchDuration = currentTournament.match_duration_minutes || 30;
      const dailySchedules = currentTournament.daily_schedules || [];
      
      console.log('[SCHEDULE] ====================================');
      console.log('[SCHEDULE] Generating schedule for format:', currentTournament.format, 'type:', currentTournament.round_robin_type);
      console.log('[SCHEDULE] Tournament settings from DB:');
      console.log('[SCHEDULE]   - daily_start_time:', currentTournament.daily_start_time);
      console.log('[SCHEDULE]   - daily_end_time:', currentTournament.daily_end_time);
      console.log('[SCHEDULE]   - match_duration_minutes:', currentTournament.match_duration_minutes);
      console.log('[SCHEDULE]   - daily_schedules:', currentTournament.daily_schedules);
      console.log('[SCHEDULE] Using values:', { numberOfCourts, startDate, startTime, endTime, matchDuration, dailySchedules });
      
      let matchesToInsert: any[] = [];
      
      // Helper to convert "TBD" to null for UUID fields
      const toUuidOrNull = (id: string | undefined | null): string | null => {
        if (!id || id === 'TBD' || id === 'tbd') return null;
        return id;
      };
      
      // Helper to generate American format combinations for any number of players
      // Each player plays with every other player as partner at least once
      const generateAmericanCombinations = (players: typeof individualPlayers): Array<{ p1: string; p2: string; p3: string; p4: string }> => {
        const n = players.length;
        if (n < 4) return [];
        
        const combinations: Array<{ p1: string; p2: string; p3: string; p4: string }> = [];
        const usedPartnerships = new Set<string>();
        
        const getPartnershipKey = (id1: string, id2: string): string => {
          return [id1, id2].sort().join('+');
        };
        
        // Generate all possible pairs
        const allPairs: Array<{ p1: string; p2: string; key: string }> = [];
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const key = getPartnershipKey(players[i].id, players[j].id);
            allPairs.push({ p1: players[i].id, p2: players[j].id, key });
          }
        }
        
        // Shuffle pairs for variety
        const shuffledPairs = [...allPairs].sort(() => Math.random() - 0.5);
        
        // Try to create matches using unique partnerships
        for (let i = 0; i < shuffledPairs.length; i++) {
          const pair1 = shuffledPairs[i];
          if (usedPartnerships.has(pair1.key)) continue;
          
          for (let j = i + 1; j < shuffledPairs.length; j++) {
            const pair2 = shuffledPairs[j];
            if (usedPartnerships.has(pair2.key)) continue;
            
            // Check that all 4 players are different
            const allFour = new Set([pair1.p1, pair1.p2, pair2.p1, pair2.p2]);
            if (allFour.size !== 4) continue;
            
            // Mark partnerships as used
            usedPartnerships.add(pair1.key);
            usedPartnerships.add(pair2.key);
            
            combinations.push({
              p1: pair1.p1,
              p2: pair1.p2,
              p3: pair2.p1,
              p4: pair2.p2
            });
            break;
          }
        }
        
        return combinations;
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
        
      } else if (currentTournament.format === 'mixed_american' || currentTournament.format === 'mixed_gender') {
        // ================================================================
        // AMERICANO MISTO / MIXED GENDER: Cada categoria joga separadamente nos grupos,
        // depois as fases finais cruzam F + M
        // Grupos: F joga contra F (grupo A), M joga contra M (grupo B)  
        // Knockout: SF1(1°F+4°M vs 2°F+3°M), SF2(3°F+2°M vs 4°F+1°M), 3rd, Final
        // ================================================================
        console.log('[SCHEDULE] MIXED AMERICAN/GENDER: Generating separate category groups + mixed knockouts');
        
        const sortedCats = [...categories].sort((a, b) => a.name.localeCompare(b.name));
        
        if (sortedCats.length < 2) {
          alert('O torneio Americano Misto precisa de exatamente 2 categorias (ex: F4-F5-F6 e M5-M6).');
          setLoading(false);
          return;
        }
        
        let matchNumber = 1;
        const baseStartTime = new Date(`${startDate}T${startTime}:00`);
        const endOfDay = new Date(`${startDate}T${endTime}:00`);
        
        // Gerar jogos de grupo para CADA CATEGORIA separadamente
        const categoryData: Array<{
          category: typeof sortedCats[0];
          players: typeof individualPlayers;
          combinations: Array<{ p1: string; p2: string; p3: string; p4: string }>;
          courtsPerGroup: number;
          baseCourtForGroup: number;
          groupName: string;
        }> = [];
        
        let totalCourtsUsed = 0;
        for (let catIdx = 0; catIdx < sortedCats.length; catIdx++) {
          const category = sortedCats[catIdx];
          const categoryPlayers = individualPlayers.filter(p => p.category_id === category.id);
          const groupName = String.fromCharCode(65 + catIdx); // A, B
          
          console.log(`[SCHEDULE] MA Category ${category.name} (Group ${groupName}): ${categoryPlayers.length} players`);
          
          if (categoryPlayers.length < 4) {
            alert(`A categoria ${category.name} precisa de pelo menos 4 jogadores. Tem ${categoryPlayers.length}.`);
            setLoading(false);
            return;
          }
          
          const americanCombinations = generateAmericanCombinations(categoryPlayers);
          const courtsPerGroup = Math.max(1, Math.floor(categoryPlayers.length / 4));
          const baseCourtForGroup = totalCourtsUsed;
          totalCourtsUsed += courtsPerGroup;
          
          categoryData.push({
            category,
            players: categoryPlayers,
            combinations: americanCombinations,
            courtsPerGroup,
            baseCourtForGroup,
            groupName
          });
          
          console.log(`[SCHEDULE] MA ${category.name}: ${americanCombinations.length} matches, ${courtsPerGroup} courts`);
        }
        
        // Gerar jogos de grupo (ambas categorias em paralelo, cada uma nos seus campos)
        let maxGroupEndTime = new Date(baseStartTime);
        for (const catData of categoryData) {
          let groupTime = new Date(baseStartTime);
          
          for (let i = 0; i < catData.combinations.length; i++) {
            const combo = catData.combinations[i];
            const courtInGroup = (i % catData.courtsPerGroup);
            const court = (catData.baseCourtForGroup + courtInGroup + 1).toString();
            
            matchesToInsert.push({
              tournament_id: currentTournament.id,
              category_id: catData.category.id,
              round: `group_${catData.groupName}`,
              match_number: matchNumber++,
              player1_individual_id: combo.p1,
              player2_individual_id: combo.p2,
              player3_individual_id: combo.p3,
              player4_individual_id: combo.p4,
              scheduled_time: groupTime.toISOString(),
              court: court,
              status: 'scheduled'
            });
            
            if ((i + 1) % catData.courtsPerGroup === 0) {
              groupTime = new Date(groupTime.getTime() + matchDuration * 60000);
              if (groupTime >= endOfDay) {
                groupTime.setDate(groupTime.getDate() + 1);
                groupTime.setHours(parseInt(startTime.split(':')[0]), parseInt(startTime.split(':')[1] || '0'), 0, 0);
              }
            }
          }
          if (groupTime > maxGroupEndTime) maxGroupEndTime = groupTime;
        }
        
        console.log(`[SCHEDULE] MA: Generated ${matchesToInsert.length} group matches across ${categoryData.length} categories`);

        // Atribuir group_name a cada jogador por categoria
        for (const catData of categoryData) {
          const playerIds = catData.players.map(p => p.id);
          if (playerIds.length > 0) {
            await supabase
              .from('players')
              .update({ group_name: catData.groupName })
              .in('id', playerIds);
            console.log(`[SCHEDULE] MA: Assigned group "${catData.groupName}" to ${playerIds.length} players of ${catData.category.name}`);
          }
        }

        // Criar 4 matches de knockout (vazios - preenchidos quando grupos terminam)
        let knockoutTime = new Date(maxGroupEndTime.getTime() + matchDuration * 60000);
        if (knockoutTime >= endOfDay) {
          knockoutTime.setDate(knockoutTime.getDate() + 1);
          knockoutTime.setHours(parseInt(startTime.split(':')[0]), parseInt(startTime.split(':')[1] || '0'), 0, 0);
        }

        // SF1 + SF2 (simultâneas)
        matchesToInsert.push({
          tournament_id: currentTournament.id, category_id: null,
          round: 'semifinal', match_number: matchNumber++,
          player1_individual_id: null, player2_individual_id: null,
          player3_individual_id: null, player4_individual_id: null,
          scheduled_time: knockoutTime.toISOString(), court: '1', status: 'scheduled'
        });
        matchesToInsert.push({
          tournament_id: currentTournament.id, category_id: null,
          round: 'semifinal', match_number: matchNumber++,
          player1_individual_id: null, player2_individual_id: null,
          player3_individual_id: null, player4_individual_id: null,
          scheduled_time: knockoutTime.toISOString(), court: '2', status: 'scheduled'
        });

        // 3rd + Final (após SFs)
        knockoutTime = new Date(knockoutTime.getTime() + matchDuration * 60000);
        if (knockoutTime >= endOfDay) {
          knockoutTime.setDate(knockoutTime.getDate() + 1);
          knockoutTime.setHours(parseInt(startTime.split(':')[0]), parseInt(startTime.split(':')[1] || '0'), 0, 0);
        }
        matchesToInsert.push({
          tournament_id: currentTournament.id, category_id: null,
          round: '3rd_place', match_number: matchNumber++,
          player1_individual_id: null, player2_individual_id: null,
          player3_individual_id: null, player4_individual_id: null,
          scheduled_time: knockoutTime.toISOString(), court: '1', status: 'scheduled'
        });
        matchesToInsert.push({
          tournament_id: currentTournament.id, category_id: null,
          round: 'final', match_number: matchNumber++,
          player1_individual_id: null, player2_individual_id: null,
          player3_individual_id: null, player4_individual_id: null,
          scheduled_time: knockoutTime.toISOString(), court: '2', status: 'scheduled'
        });

        console.log(`[SCHEDULE] MIXED AMERICAN: Total ${matchesToInsert.length} matches (groups + 2SF + 3rd + Final)`);

      } else if (currentTournament.format === 'individual_groups_knockout' ||
                 currentTournament.format === 'crossed_playoffs') {
        // Americano COM grupos + eliminatórias (inclui crossed_playoffs)
        console.log('[SCHEDULE] Using Individual Groups Knockout scheduler with', individualPlayers.length, 'players, format:', currentTournament.format);
        
        // Verificar se é formato de playoffs cruzados (cada categoria = 1 grupo)
        const isCrossedPlayoffs = currentTournament.format === 'crossed_playoffs';
        
        if (isCrossedPlayoffs) {
          // PLAYOFFS CRUZADOS: Gerar jogos de grupo para cada categoria + 8 matches knockout (R1+R2+R3)
          console.log('[SCHEDULE] Crossed Playoffs mode - generating group matches for categories');
          
          const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));
          let matchNumber = 1;
          const baseStartTime = new Date(`${startDate}T${startTime}:00`);
          const endOfDay = new Date(`${startDate}T${endTime}:00`);
          
          // Primeiro, processar cada categoria para calcular campos por grupo
          const categoryData: Array<{
            category: typeof sortedCategories[0];
            players: typeof individualPlayers;
            combinations: Array<{ p1: string; p2: string; p3: string; p4: string }>;
            courtsPerGroup: number;
            baseCourtForGroup: number;
            groupName: string;
          }> = [];
          
          let totalCourtsUsed = 0;
          for (let catIdx = 0; catIdx < sortedCategories.length; catIdx++) {
            const category = sortedCategories[catIdx];
            const categoryPlayers = individualPlayers.filter(p => p.category_id === category.id);
            const groupName = String.fromCharCode(65 + catIdx); // A, B, C
            
            console.log(`[SCHEDULE] Category ${category.name} (Group ${groupName}): ${categoryPlayers.length} players`);
            
            if (categoryPlayers.length < 4) {
              console.warn(`[SCHEDULE] Category ${category.name} has fewer than 4 players, skipping`);
              continue;
            }
            
            const americanCombinations = generateAmericanCombinations(categoryPlayers);
            const courtsPerGroup = Math.max(1, Math.floor(categoryPlayers.length / 4));
            const baseCourtForGroup = totalCourtsUsed;
            totalCourtsUsed += courtsPerGroup;
            
            categoryData.push({
              category,
              players: categoryPlayers,
              combinations: americanCombinations,
              courtsPerGroup,
              baseCourtForGroup,
              groupName
            });
            
            console.log(`[SCHEDULE] Category ${category.name}: ${categoryPlayers.length} players, ${americanCombinations.length} matches, ${courtsPerGroup} courts (courts ${baseCourtForGroup + 1}-${baseCourtForGroup + courtsPerGroup})`);
          }
          
          // Agora, gerar jogos COM TODOS OS GRUPOS EM PARALELO
          // Cada grupo começa ao mesmo tempo mas tem os seus próprios campos
          for (const catData of categoryData) {
            // Cada grupo tem o seu próprio tracking de tempo (todos começam ao mesmo tempo)
            let groupTime = new Date(baseStartTime);
            
            for (let i = 0; i < catData.combinations.length; i++) {
              const combo = catData.combinations[i];
              // Atribuir campos dentro do grupo
              const courtInGroup = (i % catData.courtsPerGroup);
              const court = (catData.baseCourtForGroup + courtInGroup + 1).toString();
              
              matchesToInsert.push({
                tournament_id: currentTournament.id,
                category_id: catData.category.id,
                round: `group_${catData.groupName}`,
                match_number: matchNumber++,
                player1_individual_id: combo.p1,
                player2_individual_id: combo.p2,
                player3_individual_id: combo.p3,
                player4_individual_id: combo.p4,
                scheduled_time: groupTime.toISOString(),
                court: court,
                status: 'scheduled'
              });
              
              // Avançar tempo do GRUPO a cada X jogos (baseado nos campos por grupo)
              if ((i + 1) % catData.courtsPerGroup === 0) {
                groupTime = new Date(groupTime.getTime() + matchDuration * 60000);
                if (groupTime >= endOfDay) {
                  groupTime.setDate(groupTime.getDate() + 1);
                  groupTime.setHours(parseInt(startTime.split(':')[0]), parseInt(startTime.split(':')[1] || '0'), 0, 0);
                }
              }
            }
          }
          
          console.log(`[SCHEDULE] Crossed/Mixed Playoffs: Generated ${matchesToInsert.length} group matches total (all groups in parallel)`);
          
          // AGORA GERAR AUTOMATICAMENTE OS PLAYOFFS CRUZADOS COM TBD
          // Estrutura: R1 (3 jogos) + R2 (3 jogos) + R3 (2 jogos) = 8 jogos total
          console.log('[SCHEDULE] Generating Crossed Playoffs matches with TBD...');
          
          // Calcular o tempo máximo dos grupos para começar os playoffs depois
          let maxGroupEndTime = new Date(baseStartTime);
          for (const catData of categoryData) {
            const numRounds = Math.ceil(catData.combinations.length / catData.courtsPerGroup);
            const groupEndTime = new Date(baseStartTime.getTime() + numRounds * matchDuration * 60000);
            if (groupEndTime > maxGroupEndTime) {
              maxGroupEndTime = groupEndTime;
            }
          }
          
          let playoffsTime = new Date(maxGroupEndTime);
          // Verificar se passou do fim do dia
          if (playoffsTime >= endOfDay) {
            playoffsTime.setDate(playoffsTime.getDate() + 1);
            playoffsTime.setHours(parseInt(startTime.split(':')[0]), parseInt(startTime.split(':')[1] || '0'), 0, 0);
          }
          
          // RONDA 1 - Playoffs Cruzados (3 jogos simultâneos)
          // J1: (1°A + 4°C) vs (2°A + 3°C)
          // J2: (3°A + 2°B) vs (4°A + 1°B)
          // J3: (3°B + 2°C) vs (4°B + 1°C)
          const r1Matches = [
            { round: 'crossed_r1_j1', court: '1' },
            { round: 'crossed_r1_j2', court: '2' },
            { round: 'crossed_r1_j3', court: '3' },
          ];
          
          for (const m of r1Matches) {
            matchesToInsert.push({
              tournament_id: currentTournament.id,
              category_id: null,
              round: m.round,
              match_number: matchNumber++,
              player1_individual_id: null, // TBD - será preenchido quando grupos terminarem
              player2_individual_id: null,
              player3_individual_id: null,
              player4_individual_id: null,
              scheduled_time: playoffsTime.toISOString(),
              court: m.court,
              status: 'scheduled'
            });
          }
          
          // RONDA 2 - Meias-finais (3 jogos)
          playoffsTime = new Date(playoffsTime.getTime() + matchDuration * 60000);
          if (playoffsTime >= endOfDay) {
            playoffsTime.setDate(playoffsTime.getDate() + 1);
            playoffsTime.setHours(parseInt(startTime.split(':')[0]), parseInt(startTime.split(':')[1] || '0'), 0, 0);
          }
          
          // J4: Vencedor J1 vs Vencedor J2
          // J5: Vencedor J3 vs Melhor Perdedor
          // J6: Perdedor J3 vs Pior Perdedor (5º/6º lugar)
          const r2Matches = [
            { round: 'crossed_r2_j4', court: '1' },
            { round: 'crossed_r2_j5', court: '2' },
            { round: 'crossed_r2_j6', court: '3' },
          ];
          
          for (const m of r2Matches) {
            matchesToInsert.push({
              tournament_id: currentTournament.id,
              category_id: null,
              round: m.round,
              match_number: matchNumber++,
              player1_individual_id: null,
              player2_individual_id: null,
              player3_individual_id: null,
              player4_individual_id: null,
              scheduled_time: playoffsTime.toISOString(),
              court: m.court,
              status: 'scheduled'
            });
          }
          
          // RONDA 3 - Finais (2 jogos)
          playoffsTime = new Date(playoffsTime.getTime() + matchDuration * 60000);
          if (playoffsTime >= endOfDay) {
            playoffsTime.setDate(playoffsTime.getDate() + 1);
            playoffsTime.setHours(parseInt(startTime.split(':')[0]), parseInt(startTime.split(':')[1] || '0'), 0, 0);
          }
          
          // J7: Final (Vencedor J4 vs Vencedor J5)
          // J8: 3º/4º lugar (Perdedor J4 vs Perdedor J5)
          const r3Matches = [
            { round: 'crossed_r3_j7', court: '1' }, // Final
            { round: 'crossed_r3_j8', court: '2' }, // 3º/4º
          ];
          
          for (const m of r3Matches) {
            matchesToInsert.push({
              tournament_id: currentTournament.id,
              category_id: null,
              round: m.round,
              match_number: matchNumber++,
              player1_individual_id: null,
              player2_individual_id: null,
              player3_individual_id: null,
              player4_individual_id: null,
              scheduled_time: playoffsTime.toISOString(),
              court: m.court,
              status: 'scheduled'
            });
          }
          
          console.log(`[SCHEDULE] Crossed Playoffs: Added 8 playoff matches (R1:3 + R2:3 + R3:2) with TBD. Total matches: ${matchesToInsert.length}`);
          
        } else {
          const groupNames = [...new Set(individualPlayers.map(p => p.group_name).filter(Boolean))];
          const numberOfGroups = groupNames.length || Math.min(Math.floor(individualPlayers.length / 4), 4);

          const categoryKnockoutStage = categories.length > 0
            ? ((categories[0] as any).knockout_stage || 'semifinals')
            : ((currentTournament as any).knockout_stage || 'semifinals');
          
          // Calculate qualified_per_group from category or use default
          const categoryQualifiedPerGroup = categories.length > 0
            ? ((categories[0] as any).qualified_per_group as number | undefined)
            : undefined;
          
          const qualConfig = calculateQualificationConfig(numberOfGroups, categoryKnockoutStage, true);
          const qualifiedPerGroup = categoryQualifiedPerGroup ?? qualConfig.qualifiedPerGroup;
          
          console.log(`[SCHEDULE] Individual Groups Knockout: ${numberOfGroups} groups, ${qualifiedPerGroup} qualified per group, stage: ${categoryKnockoutStage}`);

          const individualMatches = generateIndividualGroupsKnockoutSchedule(
            individualPlayers,
            numberOfGroups,
            numberOfCourts,
            startDate,
            startTime,
            endTime,
            matchDuration,
            qualifiedPerGroup,
            categoryKnockoutStage as 'semifinals' | 'quarterfinals'
          );

          const groupOnlyMatches = individualMatches.filter(m =>
            m.round.startsWith('group_') || m.round === 'group_stage'
          );

          // Save group assignments to DB if players got new group_name from scheduler
          const playersWithNewGroups = individualPlayers.filter(p => p.group_name);
          if (playersWithNewGroups.length > 0) {
            const groupAssignments = new Map<string, string[]>();
            playersWithNewGroups.forEach(p => {
              if (p.group_name) {
                if (!groupAssignments.has(p.group_name)) {
                  groupAssignments.set(p.group_name, []);
                }
                groupAssignments.get(p.group_name)!.push(p.id);
              }
            });
            for (const [groupName, playerIds] of groupAssignments) {
              await supabase.from('players').update({ group_name: groupName }).in('id', playerIds);
              console.log(`[SCHEDULE] Saved group "${groupName}" to ${playerIds.length} players in DB`);
            }
          }

          matchesToInsert = groupOnlyMatches.map(m => ({
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

          const lastTime = groupOnlyMatches.length > 0
            ? new Date(groupOnlyMatches[groupOnlyMatches.length - 1].scheduled_time)
            : new Date(`${startDate}T${startTime}:00`);

          let koTime = new Date(lastTime.getTime() + matchDuration * 60000);
          const koEndOfDay = new Date(`${startDate}T${endTime}:00`);
          koEndOfDay.setDate(koTime.getDate());

          const advanceKoTime = () => {
            koTime = new Date(koTime.getTime() + matchDuration * 60000);
            if (koTime >= koEndOfDay) {
              koTime.setDate(koTime.getDate() + 1);
              koTime.setHours(parseInt(startTime.split(':')[0]), parseInt(startTime.split(':')[1] || '0'), 0, 0);
              koEndOfDay.setDate(koTime.getDate());
            }
          };

          let koMatchNum = matchesToInsert.length + 1;
          const addKoMatch = (round: string, court: string) => {
            matchesToInsert.push({
              tournament_id: currentTournament.id,
              category_id: categories.length === 1 ? categories[0].id : null,
              round,
              match_number: koMatchNum++,
              player1_individual_id: null,
              player2_individual_id: null,
              player3_individual_id: null,
              player4_individual_id: null,
              scheduled_time: koTime.toISOString(),
              court,
              status: 'scheduled'
            });
          };

          // Dynamically calculate knockout structure based on total qualified players
          const groupCount = groupNames.length || numberOfGroups;
          
          // Reuse qualConfig and qualifiedPerGroup already calculated above
          // Calculate total qualified players for knockout structure
          const knockoutQualConfig = calculateQualificationConfig(groupCount, categoryKnockoutStage, true);
          const totalQualifiedPlayers = knockoutQualConfig.totalQualified;
          
          console.log(`[SCHEDULE] Knockout: ${groupCount} groups, ${qualifiedPerGroup} qualified per group, ${totalQualifiedPlayers} total qualified, stage: ${categoryKnockoutStage}`);

          // Calculate knockout structure dynamically
          // Each match has 4 players (2v2), so we need totalQualifiedPlayers / 4 matches in first round
          const numFirstRoundMatches = Math.ceil(totalQualifiedPlayers / 4);
          
          console.log(`[SCHEDULE] Knockout structure: ${numFirstRoundMatches} first-round matches (${totalQualifiedPlayers} players)`);

          if (categoryKnockoutStage === 'quarterfinals') {
            // Create quarterfinals (first round)
            const numQuarters = numFirstRoundMatches;
            console.log(`[SCHEDULE] Creating ${numQuarters} quarterfinal matches`);
            
            for (let i = 0; i < numQuarters; i++) {
              addKoMatch('quarterfinal', ((i % numberOfCourts) + 1).toString());
            }
            advanceKoTime();

            // Create semifinals (second round)
            // Each quarter produces 1 winner (2 players), so we have numQuarters winners (numQuarters * 2 players)
            // Each semifinal needs 4 players (2 teams of 2), so we need numQuarters * 2 / 4 = numQuarters / 2 semifinals
            // Round up to ensure we have enough semifinals, but minimum 1
            const numSemis = Math.max(1, Math.ceil(numQuarters / 2));
            console.log(`[SCHEDULE] Creating ${numSemis} semifinal matches (from ${numQuarters} quarterfinal winners = ${numQuarters * 2} players)`);
            
            // Note: If numQuarters is odd (e.g., 3), we'll have 6 players which allows 1 full semifinal (4 players)
            // The remaining 2 players will need special handling (could go to final directly or have a play-in)
            for (let i = 0; i < numSemis; i++) {
              addKoMatch('semifinal', ((i % numberOfCourts) + 1).toString());
            }
            advanceKoTime();
          } else if (categoryKnockoutStage === 'semifinals') {
            // Direct to semifinals (no quarters)
            const numSemis = numFirstRoundMatches;
            console.log(`[SCHEDULE] Creating ${numSemis} semifinal matches (no quarters)`);
            
            for (let i = 0; i < numSemis; i++) {
              addKoMatch('semifinal', ((i % numberOfCourts) + 1).toString());
            }
            advanceKoTime();
          } else if (categoryKnockoutStage === 'final') {
            // Direct to final (no quarters, no semis)
            console.log(`[SCHEDULE] Creating final match only`);
            // Will be created below
          }

          // Always create 3rd place and final matches
          addKoMatch('3rd_place', '1');
          addKoMatch('final', '2');

          console.log(`[SCHEDULE] Individual Groups Knockout: ${groupOnlyMatches.length} group matches + knockout (stage: ${categoryKnockoutStage}). Total: ${matchesToInsert.length}`);
        }
        
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
          matchDuration,
          dailySchedules
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
        // Torneios de equipas standard (round_robin, single_elimination, groups_knockout)
        console.log('[SCHEDULE] Using standard Tournament scheduler with', teams.length, 'teams');
        
        // Se há categorias e não é round_robin puro, gerar quadros separados por categoria
        const hasCategories = categories.length > 0 && teams.some(t => t.category_id);
        const isRoundRobin = currentTournament.format === 'round_robin' && !currentTournament.round_robin_type;
        
        if (hasCategories && !isRoundRobin) {
          console.log('[SCHEDULE] Generating separate brackets for', categories.length, 'categories - ALL PARALLEL');
          
          // 1. Gerar todos os jogos de todas as categorias (sem horário ainda)
          const allCategoryMatches: Array<{
            category_id: string;
            round: string;
            round_order: number; // Para ordenar: primeira ronda = 1, SF = 2, Final = 3
            team1_id: string | null;
            team2_id: string | null;
          }> = [];
          
          const getRoundOrder = (round: string): number => {
            if (round === 'final') return 100;
            if (round === '3rd_place') return 99;
            if (round === 'semi_final' || round === 'semifinal') return 90;
            if (round === 'quarter_final') return 80;
            if (round.startsWith('round_of_')) return 70;
            if (round.startsWith('round_')) return 60;
            return 50;
          };
          
          for (const category of categories) {
            const categoryTeams = teams.filter(t => t.category_id === category.id);
            
            if (categoryTeams.length === 0) {
              console.log(`[SCHEDULE] Skipping category ${category.name} - no teams`);
              continue;
            }
            
            console.log(`[SCHEDULE] Category ${category.name}: ${categoryTeams.length} teams`);
            
            const catKnockoutStage = (category as any).knockout_stage || 'semifinals';
            const categoryMatches = generateTournamentSchedule(
              categoryTeams,
              numberOfCourts,
              startDate,
              currentTournament.format || 'single_elimination',
              startTime,
              endTime,
              matchDuration,
              false,
              dailySchedules,
              catKnockoutStage
            );
            
            categoryMatches.forEach(m => {
              allCategoryMatches.push({
                category_id: category.id,
                round: m.round,
                round_order: getRoundOrder(m.round),
                team1_id: m.team1_id,
                team2_id: m.team2_id,
              });
            });
          }
          
          console.log(`[SCHEDULE] Total matches from all categories: ${allCategoryMatches.length}`);
          
          // 2. Ordenar por round_order (primeiras rondas primeiro, finais por último)
          allCategoryMatches.sort((a, b) => a.round_order - b.round_order);
          
          // 3. Distribuir pelos slots de tempo, preenchendo todos os campos
          matchesToInsert = [];
          let matchNumber = 1;
          
          console.log('[SCHEDULE] dailySchedules:', JSON.stringify(dailySchedules));
          
          // Função para obter o horário de um dia específico
          const getDaySchedule = (dateStr: string) => {
            console.log(`[SCHEDULE] Looking for schedule for date: ${dateStr}`);
            if (dailySchedules && dailySchedules.length > 0) {
              const schedule = dailySchedules.find((s: { date: string; start_time: string; end_time: string }) => s.date === dateStr);
              if (schedule) {
                console.log(`[SCHEDULE] Found schedule: ${schedule.start_time} - ${schedule.end_time}`);
                return { start: schedule.start_time, end: schedule.end_time };
              }
            }
            console.log(`[SCHEDULE] No schedule found, using defaults: ${startTime} - ${endTime}`);
            return { start: startTime, end: endTime };
          };
          
          // Começar com o horário do primeiro dia
          let currentDateStr = startDate;
          let daySchedule = getDaySchedule(currentDateStr);
          
          // Criar data corretamente (sem problemas de timezone)
          const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
          const [startHr, startMin] = daySchedule.start.split(':').map(Number);
          let currentTime = new Date(startYear, startMonth - 1, startDay, startHr, startMin, 0, 0);
          
          console.log(`[SCHEDULE] Starting on ${currentDateStr} at ${daySchedule.start} (ends ${daySchedule.end})`);
          console.log(`[SCHEDULE] Initial currentTime: ${currentTime.toISOString()}`);
          
          let matchIndex = 0;
          while (matchIndex < allCategoryMatches.length) {
            // Criar string de data/hora no formato ISO LOCAL (sem Z para não converter para UTC)
            const year = currentTime.getFullYear();
            const month = String(currentTime.getMonth() + 1).padStart(2, '0');
            const day = String(currentTime.getDate()).padStart(2, '0');
            const hours = String(currentTime.getHours()).padStart(2, '0');
            const minutes = String(currentTime.getMinutes()).padStart(2, '0');
            // Usar formato sem Z para evitar conversão de timezone
            const scheduledTimeStr = `${year}-${month}-${day}T${hours}:${minutes}:00`;
            
            console.log(`[SCHEDULE] Slot: ${hours}:${minutes} on ${day}/${month}/${year}`);
            
            // Preencher todos os campos neste slot de tempo
            for (let court = 1; court <= numberOfCourts && matchIndex < allCategoryMatches.length; court++) {
              const m = allCategoryMatches[matchIndex];
              
              matchesToInsert.push({
                tournament_id: currentTournament.id,
                category_id: m.category_id,
                round: m.round,
                match_number: matchNumber++,
                team1_id: m.team1_id,
                team2_id: m.team2_id,
                scheduled_time: scheduledTimeStr,
                court: court.toString(),
                status: 'scheduled'
              });
              
              matchIndex++;
            }
            
            // Calcular o fim do dia em minutos desde meia-noite
            const endOfDayHour = parseInt(daySchedule.end.split(':')[0]);
            const endOfDayMinute = parseInt(daySchedule.end.split(':')[1] || '0');
            const endOfDayInMinutes = endOfDayHour * 60 + endOfDayMinute;
            
            // Calcular a hora do próximo slot em minutos desde meia-noite
            const currentHour = currentTime.getHours();
            const currentMinute = currentTime.getMinutes();
            const currentInMinutes = currentHour * 60 + currentMinute;
            const nextSlotInMinutes = currentInMinutes + matchDuration;
            
            // Se o próximo slot passar do fim do dia, mover para o dia seguinte
            if (nextSlotInMinutes > endOfDayInMinutes) {
              // Mover para o dia seguinte
              currentTime.setDate(currentTime.getDate() + 1);
              // Obter a data em formato local
              const nextYear = currentTime.getFullYear();
              const nextMonth = String(currentTime.getMonth() + 1).padStart(2, '0');
              const nextDay = String(currentTime.getDate()).padStart(2, '0');
              currentDateStr = `${nextYear}-${nextMonth}-${nextDay}`;
              daySchedule = getDaySchedule(currentDateStr);
              // Definir a hora de início do novo dia
              currentTime.setHours(parseInt(daySchedule.start.split(':')[0]), parseInt(daySchedule.start.split(':')[1] || '0'), 0, 0);
              console.log(`[SCHEDULE] Moving to ${currentDateStr} at ${daySchedule.start} (ends ${daySchedule.end})`);
            } else {
              // Avançar para o próximo slot de tempo
              currentTime = new Date(currentTime.getTime() + matchDuration * 60000);
            }
          }
          
          console.log(`[SCHEDULE] Scheduled ${matchesToInsert.length} matches across ${Math.ceil(matchesToInsert.length / numberOfCourts)} time slots`);
        } else {
          console.log('[SCHEDULE] Generating single bracket for all teams');
          const tournamentKnockoutStage = (currentTournament as any).knockout_stage || 'semifinals';
          const teamMatches = generateTournamentSchedule(
            teams,
            numberOfCourts,
            startDate,
            currentTournament.format || 'round_robin',
            startTime,
            endTime,
            matchDuration,
            false,
            dailySchedules,
            tournamentKnockoutStage
          );
          
          matchesToInsert = teamMatches.map(m => {
            // Para cada match, pegar o category_id da team1 (se houver)
            const matchTeam1 = teams.find(t => t.id === m.team1_id);
            const matchTeam2 = teams.find(t => t.id === m.team2_id);
            const categoryId = matchTeam1?.category_id || matchTeam2?.category_id || null;
            
            return {
              tournament_id: currentTournament.id,
              category_id: categoryId,
              round: m.round,
              match_number: m.match_number,
              team1_id: m.team1_id,
              team2_id: m.team2_id,
              scheduled_time: m.scheduled_time,
              court: m.court,
              status: 'scheduled'
            };
          });
        }
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
      // 1. Calculate final positions
      if (isIndividualFormat()) {
        console.log('[FINALIZE] Calculating individual final positions...');
        // Se o torneio tem categorias, calcular posições para TODAS as categorias
        if (categories.length > 0) {
          for (const cat of categories) {
            console.log('[FINALIZE] Calculating positions for category:', cat.name, '(', cat.id, ')');
            await calculateIndividualFinalPositions(tournament.id, cat.id);
          }
          // Também calcular para jogadores sem categoria (se existirem)
          const { data: playersWithoutCategory } = await supabase
            .from('players')
            .select('id')
            .eq('tournament_id', tournament.id)
            .is('category_id', null)
            .limit(1);
          if (playersWithoutCategory && playersWithoutCategory.length > 0) {
            console.log('[FINALIZE] Calculating positions for players without category');
            await calculateIndividualFinalPositions(tournament.id, 'no-category');
          }
        } else {
          // Sem categorias - calcular para todos
          await calculateIndividualFinalPositions(tournament.id, selectedCategory);
        }
      } else {
        // For team tournaments, calculate team positions from match results
        console.log('[FINALIZE] Calculating team final positions from match results...');
        
        // Get only round_robin completed matches (not knockout/elimination matches)
        const { data: completedMatches } = await supabase
          .from('matches')
          .select('*')
          .eq('tournament_id', tournament.id)
          .eq('status', 'completed')
          .eq('round', 'round_robin');

        console.log('[FINALIZE] Round robin matches found:', completedMatches?.length || 0);

        // Get all teams
        const { data: tournamentTeams } = await supabase
          .from('teams')
          .select('*')
          .eq('tournament_id', tournament.id);

        if (completedMatches && tournamentTeams && tournamentTeams.length > 0) {
          // Calculate stats for each team using winner_id and set scores
          const teamStats = tournamentTeams.map(team => {
            let wins = 0;
            let draws = 0;
            let losses = 0;
            let gamesWon = 0;
            let gamesLost = 0;

            completedMatches.forEach(match => {
              const isTeam1 = match.team1_id === team.id;
              const isTeam2 = match.team2_id === team.id;
              
              if (!isTeam1 && !isTeam2) return;
              
              // Calculate games from set scores
              const t1Score = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
              const t2Score = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
              const isDraw = t1Score === t2Score;
              const t1Won = t1Score > t2Score;
              
              if (isTeam1) {
                gamesWon += t1Score;
                gamesLost += t2Score;
                if (isDraw) draws++;
                else if (t1Won) wins++;
                else losses++;
              } else {
                gamesWon += t2Score;
                gamesLost += t1Score;
                if (isDraw) draws++;
                else if (!t1Won) wins++;
                else losses++;
              }
            });

            return {
              teamId: team.id,
              teamName: team.name,
              wins,
              draws,
              losses,
              gamesWon,
              gamesLost,
              gameDiff: gamesWon - gamesLost,
              points: wins * 2 + draws,
              matchesPlayed: wins + draws + losses
            };
          });

          const teamStatsForSort: TeamStats[] = teamStats.map(s => ({
            id: s.teamId,
            name: s.teamName,
            group_name: 'Geral',
            wins: s.wins,
            draws: s.draws,
            gamesWon: s.gamesWon,
            gamesLost: s.gamesLost,
            created_at: tournamentTeams.find(t => t.id === s.teamId)?.created_at
          }));
          const matchDataForSort: MatchData[] = completedMatches.map(m => ({
            team1_id: m.team1_id,
            team2_id: m.team2_id,
            team1_score_set1: m.team1_score_set1,
            team2_score_set1: m.team2_score_set1,
            team1_score_set2: m.team1_score_set2,
            team2_score_set2: m.team2_score_set2,
            team1_score_set3: m.team1_score_set3,
            team2_score_set3: m.team2_score_set3
          }));
          const teamOrder = new Map(tournamentTeams.map((t, i) => [t.id, i]));
          const sortedStats = sortTeamsByTiebreaker(teamStatsForSort, matchDataForSort, teamOrder);

          console.log('[FINALIZE] Team standings (com confronto direto):', sortedStats);

          for (let i = 0; i < sortedStats.length; i++) {
            const position = i + 1;
            await supabase
              .from('teams')
              .update({ final_position: position })
              .eq('id', sortedStats[i].id);
          }

          console.log('[FINALIZE] Updated', teamStats.length, 'team positions');
        } else {
          console.log('[FINALIZE] No teams or matches found');
        }
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

      // 4. Process ratings ONLY for matches in THIS tournament (not all tournaments!)
      console.log('[FINALIZE] Processing player ratings for tournament:', tournament.id);
      try {
        const ratingResult = await processAllUnratedMatches(undefined, undefined, tournament.id);
        console.log('[FINALIZE] Rating processing result:', ratingResult);
      } catch (ratingErr) {
        console.error('[FINALIZE] Error processing ratings:', ratingErr);
        // Não bloquear a finalização se o rating falhar
      }

      // 5. Refresh data
      await fetchTournamentData();
      setCurrentTournament({ ...currentTournament, status: 'completed' });
      
      alert('Torneio finalizado com sucesso! Os resultados e ratings foram atualizados.');
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
                  {isSuperTeams
                    ? filteredSuperTeams.length
                    : isIndividualFormat()
                    ? filteredIndividualPlayers.length
                    : filteredTeams.length}{' '}
                  {isSuperTeams ? 'Equipas' : isIndividualFormat() ? t.nav.players : t.nav.teams}
                </span>
                <span className="flex items-center gap-1">
                  <Trophy className="w-4 h-4" />
                  {isSuperTeams ? filteredSuperTeamConfrontations.length : filteredMatches.length} {t.nav.matches}
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

      {/* Seletor de Categorias - sempre visível (estrutura definida nas categorias) */}
      <div className="bg-white rounded-xl shadow-lg p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-700 mr-2">Categoria:</span>
          {categories.length > 0 ? (
            <>
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
            </>
          ) : (
            <span className="text-sm text-amber-600 font-medium">{t.category.noCategories} — {t.category.addFirst}</span>
          )}
          <button
            onClick={() => setShowManageCategories(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition ml-2"
          >
            <FolderTree className="w-4 h-4" />
            {categories.length > 0 ? t.nav.manageCategories : t.category.add}
          </button>
        </div>
      </div>

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
            isSuperTeams ? (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold">Super Equipas</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSuperTeamsDrawGroups}
                      disabled={loading}
                      className="flex items-center gap-2 px-3 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
                    >
                      <Shuffle className="w-4 h-4" />
                      Sortear Grupos (Todas)
                    </button>
                    <button
                      onClick={() => {}}
                      className="flex items-center gap-2 px-3 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition"
                    >
                      <Hand className="w-4 h-4" />
                      Grupos Manual
                    </button>
                  </div>
                </div>
                <p className="text-gray-600">{filteredSuperTeams.length} super equipas inscritas</p>
                {(selectedCategory ? categories.filter(c => c.id === selectedCategory) : categories).length === 0 ? (
                  (() => {
                    const byGroup = filteredSuperTeams.reduce<Record<string, SuperTeamRow[]>>((acc, st) => {
                      const g = st.group_name || 'Sem grupo';
                      if (!acc[g]) acc[g] = [];
                      acc[g].push(st);
                      return acc;
                    }, {});
                    return (
                      <div className="rounded-xl overflow-hidden border border-gray-200">
                        <div className="px-4 py-2 bg-gray-600 text-white font-semibold text-center">
                          Todas ({filteredSuperTeams.length} equipas)
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50">
                          {Object.entries(byGroup).sort(([a], [b]) => a.localeCompare(b)).map(([groupName, groupTeams]) => (
                            <div key={groupName} className="bg-white border rounded-lg overflow-hidden">
                              <div className="bg-gray-200 px-3 py-2 font-medium text-gray-800">Grupo {groupName}</div>
                              <div className="p-3 space-y-2">
                                {groupTeams.map(st => (
                                  <div 
                                    key={st.id} 
                                    className="p-2 bg-gray-50 rounded-lg hover:bg-purple-50 cursor-pointer transition border border-transparent hover:border-purple-200"
                                    onClick={() => {
                                      setSelectedSuperTeam(st);
                                      setShowEditSuperTeam(true);
                                    }}
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="font-medium text-gray-900">{st.name}</span>
                                      <Pencil className="w-4 h-4 text-gray-400" />
                                    </div>
                                    {st.super_team_players && st.super_team_players.length > 0 && (
                                      <div className="mt-1 text-xs text-gray-500">
                                        {st.super_team_players
                                          .sort((a, b) => a.player_order - b.player_order)
                                          .map((p, i) => (
                                            <span key={p.id}>
                                              {p.is_captain && '👑 '}
                                              {p.name}
                                              {i < st.super_team_players!.length - 1 && ', '}
                                            </span>
                                          ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()
                ) : (selectedCategory ? categories.filter(c => c.id === selectedCategory) : categories).map(cat => {
                  const catTeams = filteredSuperTeams.filter(st => st.category_id === cat.id);
                  const byGroup = catTeams.reduce<Record<string, SuperTeamRow[]>>((acc, st) => {
                    const g = st.group_name || 'Sem grupo';
                    if (!acc[g]) acc[g] = [];
                    acc[g].push(st);
                    return acc;
                  }, {});
                  return (
                    <div key={cat.id} className="rounded-xl overflow-hidden border border-gray-200">
                      <div className="px-4 py-2 text-white font-semibold text-center" style={{ backgroundColor: getCategoryColor(cat.id) }}>
                        {cat.name} ({catTeams.length} equipas)
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50">
                        {Object.entries(byGroup).sort(([a], [b]) => a.localeCompare(b)).map(([groupName, groupTeams]) => (
                          <div key={groupName} className="bg-white border rounded-lg overflow-hidden">
                            <div className="bg-gray-200 px-3 py-2 font-medium text-gray-800">
                              Grupo {groupName}
                            </div>
                            <div className="p-3 space-y-2">
                              {groupTeams.map(st => (
                                <div 
                                  key={st.id} 
                                  className="p-2 bg-gray-50 rounded-lg hover:bg-purple-50 cursor-pointer transition border border-transparent hover:border-purple-200"
                                  onClick={() => {
                                    setSelectedSuperTeam(st);
                                    setShowEditSuperTeam(true);
                                  }}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium text-gray-900">{st.name}</span>
                                    <Pencil className="w-4 h-4 text-gray-400" />
                                  </div>
                                  {st.super_team_players && st.super_team_players.length > 0 && (
                                    <div className="mt-1 text-xs text-gray-500">
                                      {st.super_team_players
                                        .sort((a, b) => a.player_order - b.player_order)
                                        .map((p, i) => (
                                          <span key={p.id}>
                                            {p.is_captain && '👑 '}
                                            {p.name}
                                            {i < st.super_team_players!.length - 1 && ', '}
                                          </span>
                                        ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {filteredSuperTeams.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Ainda não há super equipas inscritas</p>
                  </div>
                )}
              </div>
            ) : (
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
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-gray-900">{player.name}</p>
                              {player.category_id && categories.length > 0 && (
                                <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full font-medium">
                                  {categories.find(c => c.id === player.category_id)?.name || ''}
                                </span>
                              )}
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
                                  <p className="font-semibold text-gray-900">{team.name}</p>
                                  <p className="text-sm text-gray-600">
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
                            <p className="font-semibold text-gray-900">{team.name}</p>
                            <p className="text-sm text-gray-600">
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
          ) )}

          {/* Matches Tab */}
          {activeTab === 'matches' && (
            isSuperTeams ? (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold">Jogos</h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleSuperTeamsGenerateSchedule}
                      disabled={loading}
                      className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                    >
                      <Calendar className="w-4 h-4" />
                      Gerar Calendário
                    </button>
                    {filteredSuperTeamConfrontations.length > 0 && (
                      <button
                        onClick={handleSuperTeamsDeleteAllConfrontations}
                        disabled={loading}
                        className="flex items-center gap-2 px-3 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                        Eliminar Todos
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-gray-50 rounded-lg">
                  {/* Filtro por Campo */}
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-700">Campo:</label>
                    <select
                      value={selectedCourtFilter || ''}
                      onChange={(e) => setSelectedCourtFilter(e.target.value || null)}
                      className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">Todos</option>
                      {uniqueCourts.map(court => (
                        <option key={court} value={court}>{court}</option>
                      ))}
                    </select>
                  </div>
                  
                  {/* Filtro por Data */}
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-700">Data:</label>
                    <select
                      value={selectedDateFilter || ''}
                      onChange={(e) => setSelectedDateFilter(e.target.value || null)}
                      className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">Todas</option>
                      {uniqueDates.map(date => (
                        <option key={date} value={date}>
                          {new Date(date).toLocaleDateString(language === 'pt' ? 'pt-PT' : 'en-GB', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  {/* Limpar filtros */}
                  {(selectedCourtFilter || selectedDateFilter) && (
                    <button
                      onClick={() => { setSelectedCourtFilter(null); setSelectedDateFilter(null); }}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Limpar filtros
                    </button>
                  )}
                  
                  {/* Contador */}
                  <span className="text-sm text-gray-500 ml-auto">
                    {filteredSuperTeamConfrontations.length} de {superTeamConfrontations.length} jogos
                  </span>
                </div>
                {filteredSuperTeamConfrontations.length > 0 ? (
                  <div className="flex flex-col gap-4">
                    {filteredSuperTeamConfrontations.map(conf => {
                      const team1 = getSuperTeamById(conf.super_team_1_id);
                      const team2 = getSuperTeamById(conf.super_team_2_id);
                      const category = conf.category_id ? categories.find(c => c.id === conf.category_id) : null;
                      const catName = category?.name ?? '';
                      // Usar a função getCategoryColor para consistência
                      const catColor = conf.category_id ? getCategoryColor(conf.category_id) : '#3B82F6';
                      const dateStr = conf.scheduled_time
                        ? new Date(conf.scheduled_time).toLocaleDateString(language === 'pt' ? 'pt-PT' : 'en-GB', { day: '2-digit', month: '2-digit' })
                        : '—';
                      const timeStr = conf.scheduled_time
                        ? new Date(conf.scheduled_time).toLocaleTimeString(language === 'pt' ? 'pt-PT' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
                        : '—';
                      
                      // Tipo de jogo (fase)
                      const roundLabels: Record<string, string> = {
                        'group': 'Fase de Grupos',
                        'quarter_final': 'Quartos de Final',
                        'semi_final': 'Meia-Final',
                        'third_place': '3º Lugar',
                        'final': 'Final'
                      };
                      const roundLabel = roundLabels[conf.round || 'group'] || conf.round || 'Fase de Grupos';
                      const isKnockout = conf.round && conf.round !== 'group';
                      
                      const isCompleted = conf.status === 'completed';
                      
                      return (
                        <div 
                          key={conf.id} 
                          className={`border-2 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition ${isCompleted ? 'opacity-60 grayscale-[30%]' : ''}`}
                          style={{ borderColor: isCompleted ? '#9CA3AF' : catColor }}
                        >
                          {/* Header: Mobile-friendly layout */}
                          <div 
                            className="px-3 py-2 text-xs text-white"
                            style={{ backgroundColor: isCompleted ? '#6B7280' : catColor }}
                          >
                            {/* Linha 1: Tipo de jogo e status */}
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className={`font-bold px-2 py-0.5 rounded text-xs ${isKnockout ? 'bg-yellow-400 text-gray-900' : 'bg-white/20'}`}>
                                {roundLabel}
                              </span>
                              <span 
                                className={`px-2 py-0.5 rounded font-medium text-xs ${
                                  conf.status === 'completed' 
                                    ? 'bg-green-500 text-white' 
                                    : 'bg-white/20 text-white'
                                }`}
                              >
                                {conf.status === 'completed' ? 'Concluído' : 'Agendado'}
                              </span>
                            </div>
                            {/* Linha 2: Data, hora, campo, grupo, categoria */}
                            <div className="flex flex-wrap items-center gap-1.5 text-[10px] sm:text-xs">
                              <span className="flex items-center gap-1 font-medium">
                                <Clock className="w-3 h-3" />
                                {dateStr} {timeStr}
                              </span>
                              {conf.court_name && (
                                <span className="bg-white/20 px-1.5 py-0.5 rounded truncate max-w-[80px] sm:max-w-none">{conf.court_name}</span>
                              )}
                              {conf.group_name && (
                                <span className="bg-white/20 px-1.5 py-0.5 rounded">G.{conf.group_name}</span>
                              )}
                              {catName && (
                                <span className="bg-white/20 px-1.5 py-0.5 rounded truncate max-w-[60px] sm:max-w-none">{catName}</span>
                              )}
                            </div>
                          </div>
                          
                          {/* Body with light background - Mobile optimized */}
                          <div className="p-3 sm:p-4" style={{ backgroundColor: `${catColor}10` }}>
                            {/* Teams and Score - stacked on mobile, grid on desktop */}
                            <div className="flex flex-col sm:grid sm:grid-cols-3 gap-1 sm:gap-2 items-center">
                              {/* Team 1 */}
                              <div className="text-center sm:text-right w-full">
                                <p className="font-bold text-gray-900 text-sm sm:text-base truncate">{team1?.name ?? 'A definir'}</p>
                              </div>
                              {/* Score */}
                              <div className="text-center py-1">
                                <span className="text-2xl sm:text-3xl font-black text-gray-900">
                                  {conf.team1_matches_won ?? 0} - {conf.team2_matches_won ?? 0}
                                </span>
                                {conf.has_super_tiebreak && (
                                  <span className="block text-[10px] sm:text-xs text-orange-600 font-medium">Super Tie-Break</span>
                                )}
                              </div>
                              {/* Team 2 */}
                              <div className="text-center sm:text-left w-full">
                                <p className="font-bold text-gray-900 text-sm sm:text-base truncate">{team2?.name ?? 'A definir'}</p>
                              </div>
                            </div>
                            
                            {/* Actions - Stack on mobile */}
                            <div className="flex flex-col sm:flex-row gap-2 mt-3 pt-3 border-t border-gray-200/50">
                              <div className="flex gap-2 justify-center sm:justify-start">
                                {team1 && (
                                  <button
                                    onClick={() => { setSelectedConfrontation(conf); setSelectedLineupTeam(team1); setShowLineupModal(true); }}
                                    className="text-xs text-blue-600 hover:underline truncate max-w-[120px]"
                                  >
                                    Duplas {team1.name}
                                  </button>
                                )}
                                {team2 && (
                                  <button
                                    onClick={() => { setSelectedConfrontation(conf); setSelectedLineupTeam(team2); setShowLineupModal(true); }}
                                    className="text-xs text-purple-600 hover:underline truncate max-w-[120px]"
                                  >
                                    Duplas {team2.name}
                                  </button>
                                )}
                              </div>
                              <button
                                onClick={() => { setSelectedConfrontation(conf); setShowResultsModal(true); }}
                                className="sm:ml-auto flex items-center justify-center gap-1 px-3 py-2 sm:py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition w-full sm:w-auto"
                              >
                                <Pencil className="w-3 h-3" />
                                Resultados
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    <CalendarClock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Ainda não há jogos agendados</p>
                    <p className="text-sm mt-2">Clique em &quot;Gerar Calendário&quot; para criar os confrontos</p>
                  </div>
                )}
              </div>
            ) : (
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
                  
                  {/* Playoffs cruzados são agora gerados automaticamente pelo scheduler */}
                  {/* Jogadores avançam automaticamente quando os jogos terminam */}
                  
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
                  onScheduleUpdate={fetchTournamentData}
                />
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <CalendarClock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Ainda não há jogos agendados</p>
                  <p className="text-sm mt-2">Clique em "Gerar Calendário" para criar os jogos automaticamente</p>
                </div>
              )}
            </div>
          ) )}

          {/* Standings Tab */}
          {activeTab === 'standings' && (
            isSuperTeams ? (
              <div className="space-y-6">
                {(selectedCategory ? categories.filter(c => c.id === selectedCategory) : categories).map(cat => {
                  const catStandings = filteredSuperTeamStandings.filter(s => s.category_id === cat.id);
                  const byGroup = catStandings.reduce<Record<string, SuperTeamStandingRow[]>>((acc, s) => {
                    const g = s.group_name || 'Sem grupo';
                    if (!acc[g]) acc[g] = [];
                    acc[g].push(s);
                    return acc;
                  }, {});
                  return (
                    <div key={cat.id} className="rounded-xl overflow-hidden border border-gray-200">
                      <div className="px-4 py-2 text-white font-semibold text-center flex items-center justify-center gap-2" style={{ backgroundColor: getCategoryColor(cat.id) }}>
                        <Award className="w-5 h-5" />
                        {cat.name}
                      </div>
                      {Object.entries(byGroup).sort(([a], [b]) => a.localeCompare(b)).map(([groupName, rows]) => (
                        <div key={groupName} className="p-4 bg-gray-50">
                          <h4 className="font-medium text-gray-800 mb-3 flex items-center gap-2">
                            <Users className="w-4 h-4" />
                            Grupo {groupName}
                          </h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-gray-200 text-gray-600">
                                  <th className="text-left py-2 px-2">#</th>
                                  <th className="text-left py-2 px-2">EQUIPA</th>
                                  <th className="text-center py-2 px-2">J</th>
                                  <th className="text-center py-2 px-2">V</th>
                                  <th className="text-center py-2 px-2">D</th>
                                  <th className="text-center py-2 px-2">SG</th>
                                  <th className="text-center py-2 px-2">SP</th>
                                  <th className="text-center py-2 px-2">+/-</th>
                                  <th className="text-center py-2 px-2">PTS</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.sort((a, b) => (b.points - a.points) || (b.games_diff - a.games_diff)).map((s, idx) => (
                                  <tr key={s.id} className="border-b border-gray-100 hover:bg-white">
                                    <td className="py-2 px-2 font-medium">{idx + 1}</td>
                                    <td className="py-2 px-2">{getSuperTeamById(s.super_team_id)?.name ?? s.super_team_id.slice(0, 8)}</td>
                                    <td className="text-center py-2 px-2">{s.confrontations_played}</td>
                                    <td className="text-center py-2 px-2">{s.confrontations_won}</td>
                                    <td className="text-center py-2 px-2">{s.confrontations_lost}</td>
                                    <td className="text-center py-2 px-2">{s.games_won}</td>
                                    <td className="text-center py-2 px-2">{s.games_lost}</td>
                                    <td className="text-center py-2 px-2">{s.games_diff >= 0 ? '+' : ''}{s.games_diff}</td>
                                    <td className="text-center py-2 px-2 font-semibold">{s.points}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                      {catStandings.length === 0 && (
                        <p className="p-4 text-gray-500 text-center text-sm">Sem classificação para esta categoria</p>
                      )}
                    </div>
                  );
                })}
                {filteredSuperTeamStandings.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <Award className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Ainda não há classificação</p>
                  </div>
                )}
              </div>
            ) : (
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
            )
          )}

          {/* Knockout Tab */}
          {activeTab === 'knockout' && (
            isSuperTeams ? (
              <div className="space-y-6">
                {(selectedCategory ? categories.filter(c => c.id === selectedCategory) : categories).map(cat => {
                  const catConfrontations = filteredSuperTeamConfrontations.filter(c => c.category_id === cat.id && c.round !== 'group');
                  const qualified = filteredSuperTeamStandings
                    .filter(s => s.category_id === cat.id)
                    .sort((a, b) => (b.points - a.points) || (b.games_diff - a.games_diff))
                    .slice(0, 4);
                  return (
                    <div key={cat.id} className="rounded-xl overflow-hidden border border-gray-200">
                      <div className="px-4 py-2 text-white font-semibold text-center" style={{ backgroundColor: getCategoryColor(cat.id) }}>
                        {cat.name} - Eliminatórias
                      </div>
                      <div className="p-4 space-y-4">
                        <div>
                          <h4 className="font-medium text-gray-700 mb-2">Equipas qualificadas ({qualified.length}/4)</h4>
                          <ul className="flex flex-wrap gap-2">
                            {qualified.map((s, i) => {
                              const labels = ['A1°', 'A2°', 'B1°', 'B2°'];
                              return (
                                <li key={s.id}>
                                  <span className="text-sm text-gray-600">{labels[i] ?? ''} </span>
                                  <span className="text-sm font-medium">{getSuperTeamById(s.super_team_id)?.name ?? ''}</span>
                                </li>
                              );
                            })}
                          </ul>
                          {qualified.length >= 2 && catConfrontations.some(c => !c.super_team_1_id || !c.super_team_2_id) && (
                            <button
                              onClick={async () => {
                                try {
                                  setLoading(true);
                                  const knockoutStage = (cat as any).knockout_stage || 'semifinals';
                                  
                                  // Obter standings ordenados por grupo
                                  const catStandings = superTeamStandings
                                    .filter(s => s.category_id === cat.id)
                                    .sort((a, b) => {
                                      // Primeiro por grupo
                                      if ((a.group_name || '') < (b.group_name || '')) return -1;
                                      if ((a.group_name || '') > (b.group_name || '')) return 1;
                                      // Depois por pontos e diferença de jogos
                                      return (b.points - a.points) || (b.games_diff - a.games_diff);
                                    });
                                  
                                  // Agrupar por grupo
                                  const byGroup: Record<string, typeof catStandings> = {};
                                  catStandings.forEach(s => {
                                    const g = s.group_name || 'A';
                                    if (!byGroup[g]) byGroup[g] = [];
                                    byGroup[g].push(s);
                                  });
                                  
                                  const groupNames = Object.keys(byGroup).sort();
                                  console.log('[ASSIGN-QUALIFIED] Groups:', groupNames);
                                  console.log('[ASSIGN-QUALIFIED] Standings by group:', byGroup);
                                  
                                  // Atribuir às fases finais
                                  const semiFinals = catConfrontations.filter(c => c.round === 'semi_final');
                                  const quarterFinals = catConfrontations.filter(c => c.round === 'quarter_final');
                                  
                                  if (knockoutStage === 'semifinals' && semiFinals.length >= 2 && groupNames.length >= 2) {
                                    // 2 grupos: A1 vs B2, B1 vs A2
                                    const A = byGroup[groupNames[0]] || [];
                                    const B = byGroup[groupNames[1]] || [];
                                    
                                    if (A.length >= 2 && B.length >= 2) {
                                      // SF1: A1 vs B2
                                      await supabase.from('super_team_confrontations').update({
                                        super_team_1_id: A[0].super_team_id,
                                        super_team_2_id: B[1].super_team_id,
                                      }).eq('id', semiFinals[0].id);
                                      
                                      // SF2: B1 vs A2
                                      await supabase.from('super_team_confrontations').update({
                                        super_team_1_id: B[0].super_team_id,
                                        super_team_2_id: A[1].super_team_id,
                                      }).eq('id', semiFinals[1].id);
                                      
                                      alert('Equipas atribuídas às meias-finais!');
                                    } else {
                                      alert('Necessário pelo menos 2 equipas por grupo.');
                                    }
                                  } else if (knockoutStage === 'quarterfinals' && quarterFinals.length >= 4 && groupNames.length >= 2) {
                                    // Quartos com 2 grupos: A1 vs B4, A2 vs B3, B1 vs A4, B2 vs A3
                                    const A = byGroup[groupNames[0]] || [];
                                    const B = byGroup[groupNames[1]] || [];
                                    
                                    if (A.length >= 4 && B.length >= 4) {
                                      await supabase.from('super_team_confrontations').update({
                                        super_team_1_id: A[0].super_team_id,
                                        super_team_2_id: B[3].super_team_id,
                                      }).eq('id', quarterFinals[0].id);
                                      
                                      await supabase.from('super_team_confrontations').update({
                                        super_team_1_id: A[1].super_team_id,
                                        super_team_2_id: B[2].super_team_id,
                                      }).eq('id', quarterFinals[1].id);
                                      
                                      await supabase.from('super_team_confrontations').update({
                                        super_team_1_id: B[0].super_team_id,
                                        super_team_2_id: A[3].super_team_id,
                                      }).eq('id', quarterFinals[2].id);
                                      
                                      await supabase.from('super_team_confrontations').update({
                                        super_team_1_id: B[1].super_team_id,
                                        super_team_2_id: A[2].super_team_id,
                                      }).eq('id', quarterFinals[3].id);
                                      
                                      alert('Equipas atribuídas aos quartos de final!');
                                    } else {
                                      alert('Necessário pelo menos 4 equipas por grupo.');
                                    }
                                  } else if (knockoutStage === 'final' && groupNames.length >= 1) {
                                    // Só final: 1º vs 2º
                                    const allTeams = catStandings.slice(0, 2);
                                    const finalMatch = catConfrontations.find(c => c.round === 'final');
                                    const thirdPlace = catConfrontations.find(c => c.round === 'third_place');
                                    
                                    if (finalMatch && allTeams.length >= 2) {
                                      await supabase.from('super_team_confrontations').update({
                                        super_team_1_id: allTeams[0].super_team_id,
                                        super_team_2_id: allTeams[1].super_team_id,
                                      }).eq('id', finalMatch.id);
                                    }
                                    if (thirdPlace && catStandings.length >= 4) {
                                      await supabase.from('super_team_confrontations').update({
                                        super_team_1_id: catStandings[2].super_team_id,
                                        super_team_2_id: catStandings[3].super_team_id,
                                      }).eq('id', thirdPlace.id);
                                    }
                                    alert('Equipas atribuídas à final!');
                                  } else {
                                    alert('Configuração não suportada. Verifique grupos e fase de eliminatórias.');
                                  }
                                  
                                  await fetchTournamentData();
                                } catch (err) {
                                  console.error(err);
                                  alert('Erro ao atribuir equipas.');
                                } finally {
                                  setLoading(false);
                                }
                              }}
                              disabled={loading}
                              className="mt-2 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                            >
                              Atribuir equipas qualificadas
                            </button>
                          )}
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-700 mb-2">Jogos das eliminatórias</h4>
                          {catConfrontations.length > 0 ? (
                            <div className="space-y-3">
                              {/* Agrupar por fase */}
                              {['quarter_final', 'semi_final', 'third_place', 'final'].map(roundType => {
                                const roundConfronts = catConfrontations.filter(c => c.round === roundType);
                                if (roundConfronts.length === 0) return null;
                                const roundLabels: Record<string, string> = {
                                  'quarter_final': 'Quartos de Final',
                                  'semi_final': 'Meias-Finais',
                                  'third_place': '3º Lugar',
                                  'final': 'Final'
                                };
                                const roundColors: Record<string, string> = {
                                  'quarter_final': 'bg-purple-100 border-purple-300',
                                  'semi_final': 'bg-orange-100 border-orange-300',
                                  'third_place': 'bg-amber-100 border-amber-300',
                                  'final': 'bg-green-100 border-green-300'
                                };
                                return (
                                  <div key={roundType} className={`rounded-lg border p-3 ${roundColors[roundType]}`}>
                                    <h5 className="font-semibold text-gray-800 mb-2">{roundLabels[roundType]}</h5>
                                    <ul className="space-y-2">
                                      {roundConfronts.map(conf => {
                                        const t1 = getSuperTeamById(conf.super_team_1_id);
                                        const t2 = getSuperTeamById(conf.super_team_2_id);
                                        const dateStr = conf.scheduled_time 
                                          ? new Date(conf.scheduled_time).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })
                                          : '';
                                        const timeStr = conf.scheduled_time 
                                          ? new Date(conf.scheduled_time).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
                                          : '';
                                        return (
                                          <li key={conf.id} className="flex flex-wrap items-center justify-between gap-2 bg-white/60 rounded-lg p-3">
                                            <div className="flex flex-col">
                                              <span className="text-sm font-bold text-gray-900">
                                                {t1?.name ?? 'A definir'} vs {t2?.name ?? 'A definir'}
                                              </span>
                                              <span className="text-xs text-gray-600">
                                                {dateStr} {timeStr} - {conf.court_name || 'Campo TBD'}
                                              </span>
                                              {conf.status === 'completed' && (
                                                <span className="text-sm font-bold text-green-700">
                                                  {conf.team1_matches_won ?? 0} - {conf.team2_matches_won ?? 0}
                                                </span>
                                              )}
                                            </div>
                                            {t1 && t2 ? (
                                              <button
                                                onClick={() => { setSelectedConfrontation(conf); setShowResultsModal(true); }}
                                                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                                              >
                                                {conf.status === 'completed' ? 'Ver/Editar' : 'Resultados'}
                                              </button>
                                            ) : (
                                              <span className="text-xs text-gray-500 px-2 py-1 bg-gray-200 rounded">Aguardar qualificados</span>
                                            )}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500">Ainda não há jogos de eliminatórias. Gere o calendário primeiro.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
            <BracketView
              key={refreshKey}
              matches={filteredMatches}
              onMatchClick={(matchId) => {
                setSelectedMatchId(matchId);
                setShowMatchModal(true);
              }}
              isIndividual={isIndividualFormat()}
              individualPlayers={filteredIndividualPlayers}
              tournamentFormat={currentTournament?.format}
            />
            )
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
          categoryId={selectedCategory}
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
            // Save match ID for scroll restoration
            if (selectedMatchId) scrollToMatchIdRef.current = selectedMatchId;
            setShowMatchModal(false);
            setSelectedMatchId(undefined);
            // Silent refresh to keep scroll position
            fetchTournamentData(true);
          }}
          onSuccess={() => {
            // Save match ID for scroll restoration
            if (selectedMatchId) scrollToMatchIdRef.current = selectedMatchId;
            setShowMatchModal(false);
            setSelectedMatchId(undefined);
            // Silent refresh to keep scroll position
            fetchTournamentData(true);
          }}
          isIndividualRoundRobin={isIndividualFormat()}
          individualPlayers={individualPlayers}
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
          tournamentId={tournament.id}
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

      {isSuperTeams && showLineupModal && selectedConfrontation && selectedLineupTeam && (
        <SuperTeamLineupModal
          confrontation={{
            id: selectedConfrontation.id,
            super_team_1_id: selectedConfrontation.super_team_1_id,
            super_team_2_id: selectedConfrontation.super_team_2_id,
          }}
          team={{
            id: selectedLineupTeam.id,
            name: selectedLineupTeam.name,
            super_team_players: selectedLineupTeam.super_team_players ?? [],
          }}
          onClose={() => {
            setShowLineupModal(false);
            setSelectedConfrontation(null);
            setSelectedLineupTeam(null);
          }}
          onSuccess={() => {
            setShowLineupModal(false);
            setSelectedConfrontation(null);
            setSelectedLineupTeam(null);
            fetchTournamentData();
          }}
        />
      )}

      {isSuperTeams && showResultsModal && selectedConfrontation && (
        <SuperTeamResultsModal
          confrontation={{
            id: selectedConfrontation.id,
            super_team_1_id: selectedConfrontation.super_team_1_id,
            super_team_2_id: selectedConfrontation.super_team_2_id,
            status: selectedConfrontation.status,
            team1_matches_won: selectedConfrontation.team1_matches_won,
            team2_matches_won: selectedConfrontation.team2_matches_won,
            has_super_tiebreak: selectedConfrontation.has_super_tiebreak,
            winner_super_team_id: selectedConfrontation.winner_super_team_id,
            next_confrontation_id: selectedConfrontation.next_confrontation_id,
            next_team_slot: selectedConfrontation.next_team_slot,
          }}
          team1={getSuperTeamById(selectedConfrontation.super_team_1_id) ?? null}
          team2={getSuperTeamById(selectedConfrontation.super_team_2_id) ?? null}
          gameFormat={categories.find(c => c.id === selectedConfrontation.category_id)?.game_format || '1set'}
          onClose={() => {
            setShowResultsModal(false);
            setSelectedConfrontation(null);
          }}
          onSuccess={() => {
            setShowResultsModal(false);
            setSelectedConfrontation(null);
            fetchTournamentData();
          }}
        />
      )}

      {isSuperTeams && showEditSuperTeam && selectedSuperTeam && (
        <EditSuperTeamModal
          superTeam={selectedSuperTeam}
          tournamentId={currentTournament.id}
          categories={categories}
          onClose={() => {
            setShowEditSuperTeam(false);
            setSelectedSuperTeam(null);
          }}
          onSuccess={() => {
            setShowEditSuperTeam(false);
            setSelectedSuperTeam(null);
            fetchTournamentData();
          }}
        />
      )}

      {showEditPlayer && selectedPlayer && (
        <EditIndividualPlayerModal
          player={selectedPlayer}
          tournamentId={tournament.id}
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
