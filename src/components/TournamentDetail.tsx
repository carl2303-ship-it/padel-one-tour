import { useEffect, useState, useRef } from 'react';
import { supabase, Tournament, Team, Player, Match, TournamentCategory } from '../lib/supabase';
import { useI18n } from '../lib/i18nContext';
import { useAuth } from '../lib/authContext';
import {
  computeTournamentPlayerPrice,
  normalizeNameKey,
  normalizePhoneKey,
  type MemberPriceInfo,
} from '../lib/playerTournamentPrice';
import { ArrowLeft, Users, Calendar, Trophy, Plus, CreditCard as Edit, CalendarClock, Award, Link, Check, Trash2, FolderTree, Pencil, Clock, ChevronDown, Shuffle, Hand, FileDown, TrendingUp, Mail, RotateCcw, Bell } from 'lucide-react';
import { notifyTournamentPlayers } from '../lib/notifyTournament';
import AddTeamModal from './AddTeamModal';
import AddIndividualPlayerModal from './AddIndividualPlayerModal';
import MatchModal from './MatchModal';
import EditTournamentModal from './EditTournamentModal';
import EditTeamModal from './EditTeamModal';
import EditIndividualPlayerModal from './EditIndividualPlayerModal';
import Standings from './Standings';
import BracketView from './BracketView';
import ManageCategoriesModal from './ManageCategoriesModal';
import ManageInvitesModal from './ManageInvitesModal';
import MatchScheduleView from './MatchScheduleView';
import { ManualGroupAssignmentModal } from './ManualGroupAssignmentModal';
import { processAllUnratedMatches, reprocessTournamentRatings, awardTournamentRewardPoints } from '../lib/ratingEngine';
import { generateTournamentSchedule } from '../lib/scheduler';
import { generateAmericanSchedule } from '../lib/americanScheduler';
import { generateIndividualGroupsKnockoutSchedule } from '../lib/individualGroupsKnockoutScheduler';
import { generateMixedAmericanSchedule, MixedPlayer } from '../lib/mixedAmericanScheduler';
import { getTeamsByGroup, getPlayersByGroup, sortTeamsByTiebreaker, populatePlacementMatches, populateTeamPlacementMatches, advanceKnockoutWinner, calculateTeamQualificationConfig } from '../lib/groups';
import { recalculateSeedsByLevel } from '../lib/levelSeeding';
import type { TeamStats, MatchData } from '../lib/groups';
import { scheduleMultipleCategories, validateGeneratedSchedule } from '../lib/multiCategoryScheduler';
import { updateLeagueStandings, calculateIndividualFinalPositions } from '../lib/leagueStandings';
import { exportTournamentPDF } from '../lib/pdfExport';
import { deleteTeamAndPlayers } from '../lib/deleteTeamRegistration';
import {
  buildOpponentMap,
  buildSwissRoundMatches,
  clampSwissRounds,
  computeSwissStandings,
  getHighestSwissRound,
  isSwissRound,
  isSwissRoundComplete,
  orderTeamsForRound1,
  pairRound1,
  pairSwissRound,
  parseSwissRoundNumber,
} from '../lib/swissTeamsScheduler';
import SuperTeamLineupModal from './SuperTeamLineupModal';
import SuperTeamResultsModal from './SuperTeamResultsModal';
import EditSuperTeamModal from './EditSuperTeamModal';
import AddSuperTeamModal from './AddSuperTeamModal';
import LadderTournamentView from './LadderTournamentView';

type TournamentDetailProps = {
  tournament: Tournament;
  onBack: () => void;
};

type TeamWithPlayers = Team & {
  player1: Player;
  player2: Player;
};

// partner_match_invite_id / organizer_review_status are not deployed yet;
// selecting them makes PostgREST fail and the teams list renders empty.
const TEAMS_WITH_PLAYERS_SELECT =
  'id, name, group_name, seed, status, category_id, player1_id, player2_id, final_position, registration_source, player1:players!teams_player1_id_fkey(id, name, email, phone_number, wants_dinner, payment_status), player2:players!teams_player2_id_fkey(id, name, email, phone_number, wants_dinner, payment_status)';

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
  const { user } = useAuth();
  const [teams, setTeams] = useState<TeamWithPlayers[]>([]);
  const [individualPlayers, setIndividualPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<MatchWithTeams[]>([]);
  const [categories, setCategories] = useState<TournamentCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedCourtFilter, setSelectedCourtFilter] = useState<string | null>(null);
  const [selectedDateFilter, setSelectedDateFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentSavingId, setPaymentSavingId] = useState<string | null>(null);
  const [reviewSavingId, setReviewSavingId] = useState<string | null>(null);
  const [memberPriceLookup, setMemberPriceLookup] = useState<Map<string, MemberPriceInfo>>(new Map());
  const [activeTab, setActiveTab] = useState<'teams' | 'matches' | 'standings' | 'knockout'>('teams');
  const [isMatchGridView, setIsMatchGridView] = useState(false);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [showEditTournament, setShowEditTournament] = useState(false);
  const [showEditTeam, setShowEditTeam] = useState(false);
  const [showManageCategories, setShowManageCategories] = useState(false);
  const [showManageInvites, setShowManageInvites] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState<string | undefined>();
  const [selectedTeam, setSelectedTeam] = useState<TeamWithPlayers | undefined>();
  const [selectedPlayer, setSelectedPlayer] = useState<Player | undefined>();
  const [showEditPlayer, setShowEditPlayer] = useState(false);
  const [currentTournament, setCurrentTournament] = useState<Tournament>(tournament);
  const [resolvedFormat, setResolvedFormat] = useState<string>(tournament.format);
  const [resolvedRoundRobinType, setResolvedRoundRobinType] = useState<string | null>((tournament as any).round_robin_type || null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [liveLinkCopied, setLiveLinkCopied] = useState(false);
  const [notifySending, setNotifySending] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [matchViewSortBy, setMatchViewSortBy] = useState<'time' | 'court' | 'group' | 'courts_grid'>('time');
  const [outdoorCourtKeys, setOutdoorCourtKeys] = useState<string[]>([]);
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
  const [showAddSuperTeam, setShowAddSuperTeam] = useState(false);

  const [playerLevelByPhone, setPlayerLevelByPhone] = useState<Map<string, number>>(new Map());

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
    if (eventType === 'UPDATE' && newRecord) {
      // Use the value coming from DB literally. Any normalization of
      // numeric court ("1" -> "Court A") happens once at fetch time via
      // normalizeNumericCourtsInDB, so the realtime payload is already
      // in the correct shape.
      setMatches(prev => {
        const updated = prev.map(m => m.id === newRecord.id ? { ...m, ...newRecord } : m);
        const hasResultScores = (m: any) =>
          (m.team1_score_set1 != null && m.team2_score_set1 != null) ||
          (m.team1_score_set2 != null && m.team2_score_set2 != null) ||
          (m.team1_score_set3 != null && m.team2_score_set3 != null);
        // Verificar se precisa avançar playoffs cruzados
        if (newRecord.status === 'completed' || hasResultScores(newRecord)) {
          if (newRecord.round?.startsWith('crossed_')) {
            // Avançar R1→R2 ou R2→R3
            setTimeout(() => autoAdvanceCrossedPlayoffs(updated), 500);
          } else if (newRecord.round === 'quarterfinal' || newRecord.round === 'quarter_final') {
            // Avançar quarterfinals → semifinals
            setTimeout(async () => {
              await advanceKnockoutWinner(tournament.id, newRecord.id, newRecord.category_id || undefined);
              fetchTournamentData();
            }, 500);
          } else if (newRecord.round === 'semifinal') {
            // Avançar meias-finais → final e 3°/4° lugar
            setTimeout(() => autoAdvanceSemifinals(updated), 500);
          } else if (newRecord.round?.startsWith('group_') || newRecord.round?.startsWith('round_')) {
            const fmt = tournament.format;
            const roundPrefix = fmt === 'mixed_american' ? 'round_' : 'group_';
            const groupMatches = updated.filter(m => m.round.startsWith(roundPrefix));
            const allGroupsDone = groupMatches.length > 0 && groupMatches.every(m => m.status === 'completed');
            
            if (allGroupsDone) {
              if (fmt === 'mixed_american') {
                setTimeout(() => fetchTournamentData(), 500);
              } else if (fmt === 'crossed_playoffs_teams') {
                setTimeout(() => fetchTournamentData(), 500);
              } else if (fmt === 'individual_groups_knockout') {
                setTimeout(async () => {
                  await populatePlacementMatches(tournament.id);
                  fetchTournamentData();
                }, 600);
              } else {
                // Fallback: refetch for any format with groups
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
    if (eventType === 'UPDATE' && newRecord) {
      setTeams(prev => prev.map(t => t.id === newRecord.id ? { ...t, ...newRecord } : t));
    } else {
      fetchTournamentData();
    }
  };

  const handlePlayerRealtime = async (payload: any) => {
    const { eventType, new: newRecord } = payload;
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
    const ownerId = (currentTournament as any).user_id || user?.id;
    if (!ownerId) return;

    const loadMembers = async () => {
      const { data } = await supabase
        .from('member_subscriptions')
        .select('member_phone, member_name, plan:membership_plans(name, tournament_discount_percent)')
        .eq('club_owner_id', ownerId)
        .eq('status', 'active')
        .gte('end_date', new Date().toISOString().split('T')[0]);

      const map = new Map<string, MemberPriceInfo>();
      (data || []).forEach((m: any) => {
        const planName = m.plan?.name || null;
        const info: MemberPriceInfo = {
          isMember: true,
          isStaff: !!(planName && String(planName).toLowerCase().includes('staff')),
          planName,
          discountPercent: Number(m.plan?.tournament_discount_percent) || 0,
        };
        const phone = normalizePhoneKey(m.member_phone);
        const name = normalizeNameKey(m.member_name);
        if (phone) map.set(phone, info);
        if (name) map.set(name, info);
      });
      setMemberPriceLookup(map);
    };

    void loadMembers();
  }, [currentTournament, user?.id]);

  useEffect(() => {
    const loadOutdoorCourts = async () => {
      const clubId = (currentTournament as any)?.club_id;
      const courtNames: string[] = (currentTournament as any)?.court_names || [];
      if (!clubId || courtNames.length === 0) {
        setOutdoorCourtKeys([]);
        return;
      }
      const { data: clubData } = await supabase
        .from('clubs')
        .select('owner_id')
        .eq('id', clubId)
        .maybeSingle();
      if (!clubData?.owner_id) {
        setOutdoorCourtKeys([]);
        return;
      }
      const { data: courtData } = await supabase
        .from('club_courts')
        .select('name, type')
        .eq('user_id', clubData.owner_id)
        .eq('is_active', true);
      if (!courtData || courtData.length === 0) {
        setOutdoorCourtKeys([]);
        return;
      }
      const typeByName = new Map(courtData.map((c) => [c.name, c.type || 'indoor']));
      const keys: string[] = [];
      courtNames.forEach((name, idx) => {
        if (typeByName.get(name) === 'outdoor') {
          keys.push(name);
          keys.push(String(idx + 1));
        }
      });
      setOutdoorCourtKeys(keys);
    };
    void loadOutdoorCourts();
  }, [currentTournament?.club_id, (currentTournament as any)?.court_names]);

  useEffect(() => {
    const handleClickOutside = () => setShowGroupDropdown(false);
    if (showGroupDropdown) {
      document.addEventListener('click', handleClickOutside);
    }
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showGroupDropdown]);

  const isIndividualRoundRobin = resolvedFormat === 'round_robin' && resolvedRoundRobinType === 'individual';
  const isIndividualGroupsKnockout = resolvedFormat === 'individual_groups_knockout' ||
    resolvedFormat === 'mixed_american';
  const isSuperTeams = resolvedFormat === 'super_teams';
  const isSwissTeams = resolvedFormat === 'swiss_teams';

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
      }
    } catch (error) {
      console.error('[COURT BOOKINGS] Error deleting:', error);
    }
  };

  const createCourtBookingsForMatches = async (
    matchesData: Array<{ id: string; scheduled_time: string; court: string }>,
    tournamentData: typeof currentTournament
  ) => {
    if (tournamentData.format === 'ladder') {
      return;
    }
    if (!tournamentData.club_id || !tournamentData.court_names || tournamentData.court_names.length === 0) {
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
        const { error } = await supabase
          .from('court_bookings')
          .insert(bookingsToCreate);

        if (error) {
          console.error('[COURT BOOKINGS] Error creating bookings:', error);
        } else {
        }
      }
    } catch (error) {
      console.error('[COURT BOOKINGS] Error:', error);
    }
  };

  const isIndividualFormat = () => {
    return isIndividualRoundRobin || isIndividualGroupsKnockout;
  };

  const calculateQualificationConfig = (numberOfGroups: number, knockoutStage: string, isIndividual: boolean): {
    qualifiedPerGroup: number;
    extraBestNeeded: number;
    totalQualified: number;
    extraFromPosition: number;
  } => {
    if (knockoutStage === 'none') {
      return { qualifiedPerGroup: 0, extraBestNeeded: 0, totalQualified: 0, extraFromPosition: 0 };
    }

    if (isIndividual) {
      const individualKnockoutSizes: Record<string, number> = {
        'final': 4,
        'semifinals': 8,
        'quarterfinals': 16,
        'round_of_16': 16,
      };

      const totalQualified = individualKnockoutSizes[knockoutStage] || 8;
      const qualifiedPerGroup = Math.floor(totalQualified / numberOfGroups);
      const extraBestNeeded = totalQualified - (qualifiedPerGroup * numberOfGroups);

      return { qualifiedPerGroup, extraBestNeeded, totalQualified, extraFromPosition: qualifiedPerGroup + 1 };
    }

    const teamKnockoutSizes: Record<string, number> = {
      'final': 2,
      'semifinals': 4,
      'quarterfinals': 8,
      'round_of_16': 16,
    };

    const totalQualified = teamKnockoutSizes[knockoutStage] || 4;
    const qualifiedPerGroup = Math.floor(totalQualified / numberOfGroups);
    const extraBestNeeded = totalQualified - (qualifiedPerGroup * numberOfGroups);
    const extraFromPosition = qualifiedPerGroup + 1;


    return { qualifiedPerGroup, extraBestNeeded, totalQualified, extraFromPosition };
  };

  const calculateQualifiedPerGroup = (numberOfGroups: number, knockoutStage: string, isIndividual: boolean = false): number => {
    return calculateQualificationConfig(numberOfGroups, knockoutStage, isIndividual).qualifiedPerGroup;
  };

  const filteredTeams = (selectedCategory === 'no-category'
    ? teams.filter(t => !t.category_id)
    : selectedCategory
    ? teams.filter(t => t.category_id === selectedCategory)
    : teams
  ).slice().sort((a, b) => (a.seed ?? 9999) - (b.seed ?? 9999) || a.name.localeCompare(b.name));

  const filteredMatches = selectedCategory === 'no-category'
    ? matches.filter(m => !m.category_id)
    : selectedCategory
    ? matches.filter(m => m.category_id === selectedCategory)
    : matches;

  const filteredIndividualPlayers = (selectedCategory === 'no-category'
    ? individualPlayers.filter(p => !p.category_id)
    : selectedCategory
    ? individualPlayers.filter(p => p.category_id === selectedCategory)
    : individualPlayers
  ).slice().sort((a, b) => ((a as any).seed ?? 9999) - ((b as any).seed ?? 9999) || a.name.localeCompare(b.name));

  const getMemberInfoForPlayer = (player: Player): MemberPriceInfo => {
    const phoneKey = normalizePhoneKey(player.phone_number || (player as any).phone);
    const nameKey = normalizeNameKey(player.name);
    return (
      (phoneKey && memberPriceLookup.get(phoneKey)) ||
      (nameKey && memberPriceLookup.get(nameKey)) || {
        isMember: false,
        isStaff: false,
        planName: null,
        discountPercent: 0,
      }
    );
  };

  const getPlayerPriceInfo = (player: Player) => {
    const cat = categories.find(c => c.id === player.category_id);
    return computeTournamentPlayerPrice(
      {
        registrationFee: Number((currentTournament as any).registration_fee) || 0,
        memberPrice: Number((currentTournament as any).member_price) || 0,
        nonMemberPrice: Number((currentTournament as any).non_member_price) || 0,
        categoryRegistrationFee: Number(cat?.registration_fee) || 0,
        categoryMemberPrice: Number(cat?.member_price) || 0,
        categoryNonMemberPrice: Number(cat?.non_member_price) || 0,
      },
      getMemberInfoForPlayer(player),
    );
  };

  const normalizePaymentPhone = (phone: string | null | undefined): string | null => {
    const key = normalizePhoneKey(phone);
    return key || null;
  };

  const handleTogglePlayerPayment = async (player: Player) => {
    if (!user || !player.id) return;
    const memberInfo = getMemberInfoForPlayer(player);
    const priceInfo = getPlayerPriceInfo(player);
    const currentStatus = memberInfo.isStaff ? 'exempt' : (player.payment_status || 'pending');
    if (currentStatus === 'exempt' || memberInfo.isStaff) return;
    const newStatus = currentStatus === 'paid' ? 'pending' : 'paid';
    setPaymentSavingId(player.id);
    try {
      const { error } = await supabase
        .from('players')
        .update({ payment_status: newStatus })
        .eq('id', player.id);
      if (error) throw error;

      const normalizedPhone = normalizePaymentPhone(player.phone_number || (player as any).phone);
      let playerAccountId: string | null = null;
      if (normalizedPhone) {
        const { data: existingAccount } = await supabase
          .from('player_accounts')
          .select('id')
          .eq('phone_number', normalizedPhone)
          .maybeSingle();
        playerAccountId = existingAccount?.id || null;
        if (!existingAccount) {
          const { data: newAccount } = await supabase
            .from('player_accounts')
            .insert({ phone_number: normalizedPhone, name: player.name })
            .select('id')
            .single();
          playerAccountId = newAccount?.id || null;
        }
      }

      const ownerId = (currentTournament as any).user_id || user.id;
      if (newStatus === 'paid') {
        const rpcParams: Record<string, unknown> = {
          p_club_owner_id: ownerId,
          p_player_name: (player.name || '').trim(),
          p_player_phone: normalizedPhone || 'unknown',
          p_transaction_type: 'tournament',
          p_amount: priceInfo.amount,
          p_reference_id: currentTournament.id,
          p_reference_type: 'tournament',
          p_notes: `Torneio: ${currentTournament.name} (${priceInfo.label}, pagamento no local)`,
        };
        if (playerAccountId) rpcParams.p_player_account_id = playerAccountId;
        const { error: insertTxError } = await supabase.rpc('insert_player_transaction', rpcParams);
        if (insertTxError) throw insertTxError;
      } else {
        const { error: deleteTxError } = await supabase.rpc('delete_player_transaction', {
          p_club_owner_id: ownerId,
          p_reference_id: currentTournament.id,
          p_reference_type: 'tournament',
          p_player_name: (player.name || '').trim(),
          p_player_phone: normalizedPhone,
        });
        if (deleteTxError) throw deleteTxError;
      }

      setIndividualPlayers(prev =>
        prev.map(p => (p.id === player.id ? { ...p, payment_status: newStatus } : p))
      );
      setTeams(prev =>
        prev.map(team => ({
          ...team,
          player1: team.player1?.id === player.id ? { ...team.player1, payment_status: newStatus } : team.player1,
          player2: team.player2?.id === player.id ? { ...team.player2, payment_status: newStatus } : team.player2,
        }))
      );
    } catch (err) {
      console.error('[PAYMENT] toggle error:', err);
      alert('Erro ao atualizar pagamento.');
    } finally {
      setPaymentSavingId(null);
    }
  };

  const PlayerPriceBadge = ({ player }: { player: Player | null | undefined }) => {
    if (!player) return null;
    const info = getPlayerPriceInfo(player);
    const colors =
      info.kind === 'exempt'
        ? 'text-blue-700'
        : info.kind === 'member'
        ? 'text-green-700'
        : 'text-gray-900';
    return (
      <div className="text-right min-w-[4.5rem]">
        <p className={`text-sm font-bold ${colors}`}>
          {info.kind === 'exempt' ? 'Isento' : `${info.amount}€`}
        </p>
        <p className="text-[10px] text-gray-500 leading-tight">{info.label}</p>
      </div>
    );
  };

  const PaymentToggleButton = ({ player }: { player: Player | null | undefined }) => {
    if (!player) return null;
    const memberInfo = getMemberInfoForPlayer(player);
    if (memberInfo.isStaff || player.payment_status === 'exempt') {
      return (
        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
          Isento
        </span>
      );
    }
    const isPaid = player.payment_status === 'paid';
    return (
      <button
        type="button"
        disabled={paymentSavingId === player.id}
        onClick={(e) => {
          e.stopPropagation();
          void handleTogglePlayerPayment(player);
        }}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition disabled:opacity-50 ${
          isPaid
            ? 'bg-green-100 text-green-700 hover:bg-green-200'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
        title={isPaid ? 'Marcado como pago — clicar para reverter' : 'Marcar como pago (pagamento no local)'}
      >
        {isPaid ? (
          <><Check className="w-3.5 h-3.5" /> Pago</>
        ) : (
          <><Clock className="w-3.5 h-3.5" /> Pendente</>
        )}
      </button>
    );
  };

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
    if (!currentTournament || currentTournament.format !== 'super_teams') {
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
      
      
      // Obter os nomes dos campos definidos
      const courtNames = (currentTournament as any).court_names || [];
      const availableCourts = courtNames.length > 0 ? courtNames : ['Campo 1'];
      const numCourts = availableCourts.length;
      
      
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
      
      
      for (const cat of categories) {
        const knockoutStage = (cat as any).knockout_stage || 'semifinals';
        const qualifiedPerGroup = (cat as any).qualified_per_group || 2;
        const numberOfGroups = (cat as any).number_of_groups || 2;
        
        
        // Calculate qualification config to get total qualified
        const qualConfig = calculateQualificationConfig(numberOfGroups, knockoutStage, false);
        const totalQualified = qualConfig.totalQualified;
        
        
        // Determinar quantas partidas de cada fase baseado no número de qualificados
        // Para equipas: cada jogo tem 2 equipas
        // NOTA: jogo de 3º/4º lugar deixou de ser gerado automaticamente.
        // Por isso numFinals representa apenas 1 Final por categoria.
        let numQuarters = 0, numSemis = 0, numFinals = 0;
        
        if (knockoutStage === 'none') {
        } else if (knockoutStage === 'quarterfinals') {
          numQuarters = Math.ceil(totalQualified / 2);
          numSemis = Math.ceil(numQuarters / 2);
          numFinals = 1;
        } else if (knockoutStage === 'semifinals') {
          numSemis = Math.ceil(totalQualified / 2);
          numFinals = 1;
        } else if (knockoutStage === 'final') {
          numFinals = 1;
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
        
        const hasThirdPlace = (cat as any).has_third_place_match ?? true;

        if (numFinals >= 1) {
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
            court_name: availableCourts[0],
          });

          if (hasThirdPlace && numSemis > 0) {
            knockoutConfronts.push({
              tournament_id: tournament.id,
              category_id: cat.id,
              round: '3rd_place',
              group_name: null,
              super_team_1_id: null,
              super_team_2_id: null,
              scheduled_time: finalDate.toISOString(),
              court_name: availableCourts.length > 1 ? availableCourts[1] : availableCourts[0],
            });
          }
          
          currentTimeSlot++;
          if (currentTimeSlot >= slotsPerCourtPerDay) {
            currentTimeSlot = 0;
            currentDayIndex++;
          }
        }
      }
      
      
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

  // Normalize purely-numeric court strings ("1", "2", ...) directly in the
  // database to the matching court_names[i-1]. Runs at most once per
  // tournament load: if everything is already a name, this is a no-op and
  // does not touch the DB.
  // We deliberately ONLY rewrite courts that are *purely numeric*. Strings
  // like "1-Estrella LandsCoping" are real, user-defined names and must be
  // left untouched (rewriting them was the source of "matches jumping
  // between courts" between renders).
  const courtsNormalizedRef = useRef<Set<string>>(new Set());
  const normalizeNumericCourtsInDB = async (
    matchList: Array<{ id: string; court: string | null }>,
  ): Promise<boolean> => {
    if (courtsNormalizedRef.current.has(tournament.id)) return false;
    const cn: string[] = (currentTournament as any)?.court_names || (tournament as any)?.court_names || [];
    if (cn.length === 0) {
      courtsNormalizedRef.current.add(tournament.id);
      return false;
    }
    const updates = matchList
      .filter(m => m.court && /^\d+$/.test(m.court.trim()))
      .map(m => {
        const num = parseInt(m.court!.trim(), 10);
        if (num < 1 || num > cn.length) return null;
        return { id: m.id, newCourt: cn[num - 1] };
      })
      .filter((u): u is { id: string; newCourt: string } => u !== null);

    if (updates.length === 0) {
      courtsNormalizedRef.current.add(tournament.id);
      return false;
    }

    for (const u of updates) {
      const { error } = await supabase
        .from('matches')
        .update({ court: u.newCourt })
        .eq('id', u.id);
      if (error) {
        console.error('[NORMALIZE-COURTS] Update failed for', u.id, error);
      }
    }
    courtsNormalizedRef.current.add(tournament.id);
    return true;
  };

  const fetchPlayerLevelsFromAccounts = async (players: { phone_number?: string | null }[]) => {
    const phones = players
      .map((p) => (p.phone_number || '').replace(/[\s\-\(\)\.]/g, ''))
      .filter(Boolean);
    if (phones.length === 0) return;
    const { data } = await supabase
      .from('player_accounts')
      .select('phone_number, level')
      .in('phone_number', phones);
    if (!data) return;
    const map = new Map<string, number>();
    for (const row of data) {
      if (row.phone_number && row.level != null) {
        map.set(row.phone_number.replace(/[\s\-\(\)\.]/g, ''), row.level);
      }
    }
    setPlayerLevelByPhone(map);
  };

  const fetchDepthRef = useRef(0);
  const autoPopulateAttemptedRef = useRef(false);
  const gkSyncFingerprintRef = useRef<Map<string, string>>(new Map());
  const seedSyncRef = useRef<string | null>(null);
  const fetchTournamentData = async (silent = false) => {
    if (fetchDepthRef.current >= 3) {
      console.warn('[FETCH] Max recursive depth reached, aborting');
      fetchDepthRef.current = 0;
      autoPopulateAttemptedRef.current = false;
      setLoading(false);
      return;
    }
    fetchDepthRef.current++;
    try {
    if (!silent) setLoading(true);

    if (seedSyncRef.current !== tournament.id) {
      seedSyncRef.current = tournament.id;
      void recalculateSeedsByLevel(tournament.id).catch((err) => {
        console.error('[FETCH] Level seeding failed:', err);
      });
    }

    // Prefer currentTournament (estado local atualizado) e fazer fallback para prop inicial.
    const effectiveFormat = currentTournament?.format || tournament.format;
    let effectiveRoundRobinType = (currentTournament as any)?.round_robin_type ?? (tournament as any).round_robin_type;
    const individualFormats = ['individual_groups_knockout', 'mixed_american'];

    // Auto-detect round_robin type for legacy tournaments with null round_robin_type
    if (effectiveFormat === 'round_robin' && !effectiveRoundRobinType) {
      const [{ count: teamCount }, { count: playerCount }] = await Promise.all([
        supabase.from('teams').select('id', { count: 'exact', head: true }).eq('tournament_id', tournament.id),
        supabase.from('players').select('id', { count: 'exact', head: true }).eq('tournament_id', tournament.id),
      ]);
      if ((teamCount ?? 0) > 0) {
        effectiveRoundRobinType = 'teams';
      } else if ((playerCount ?? 0) > 0) {
        effectiveRoundRobinType = 'individual';
      }
      if (effectiveRoundRobinType) {
        // Persist to DB so this only runs once
        await supabase.from('tournaments').update({ round_robin_type: effectiveRoundRobinType }).eq('id', tournament.id);
      }
    }

    const isEffectiveIndividual = individualFormats.includes(effectiveFormat) ||
      (effectiveFormat === 'round_robin' && effectiveRoundRobinType === 'individual');

    setResolvedFormat(effectiveFormat);
    setResolvedRoundRobinType(effectiveRoundRobinType);


    if (effectiveFormat === 'super_teams') {
      const [categoriesResult, teamsResult, confrontationsResult, standingsResult] = await Promise.all([
        supabase
          .from('tournament_categories')
          .select('id, name, format, number_of_groups, max_teams, knockout_stage, qualified_per_group, rounds, court_names, category_schedule, match_duration_minutes')
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
    } else if (effectiveFormat === 'ladder') {
      const [teamsResult, categoriesResult] = await Promise.all([
        supabase
          .from('teams')
          .select(TEAMS_WITH_PLAYERS_SELECT)
          .eq('tournament_id', tournament.id)
          .order('seed', { ascending: true }),
        supabase
          .from('tournament_categories')
          .select('id, name, format, number_of_groups, max_teams, knockout_stage, qualified_per_group, rounds, court_names, category_schedule, match_duration_minutes, registration_fee, member_price, non_member_price, swiss_rounds')
          .eq('tournament_id', tournament.id)
          .order('name'),
      ]);
      if (teamsResult.error) {
        console.error('[FETCH] Teams error:', teamsResult.error);
        setTeams([]);
      } else if (teamsResult.data) setTeams(teamsResult.data as unknown as TeamWithPlayers[]);
      else setTeams([]);
      if (categoriesResult.data) setCategories(categoriesResult.data);
      else setCategories([]);
      setIndividualPlayers([]);
      setMatches([]);
      setSuperTeams([]);
      setSuperTeamConfrontations([]);
      setSuperTeamStandings([]);
    } else if (isEffectiveIndividual) {
      // Formatos individuais: individual_groups_knockout e round_robin+individual (Americano Individual)
      const [playersResult, matchesResult, categoriesResult] = await Promise.all([
        supabase
          .from('players')
          .select('id, name, email, phone_number, group_name, seed, category_id, user_id, created_at, final_position, wants_dinner, payment_status')
          .eq('tournament_id', tournament.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('matches')
          .select('id, match_number, round, scheduled_time, court, team1_id, team2_id, team1_score_set1, team2_score_set1, team1_score_set2, team2_score_set2, team1_score_set3, team2_score_set3, status, category_id, player1_individual_id, player2_individual_id, player3_individual_id, player4_individual_id')
          .eq('tournament_id', tournament.id)
          .order('match_number', { ascending: true }),
        supabase
          .from('tournament_categories')
          .select('id, name, format, number_of_groups, max_teams, knockout_stage, qualified_per_group, rounds, court_names, category_schedule, match_duration_minutes, registration_fee, member_price, non_member_price, swiss_rounds')
          .eq('tournament_id', tournament.id)
          .order('name')
      ]);

      if (playersResult.data) {
        setIndividualPlayers(playersResult.data);
        fetchPlayerLevelsFromAccounts(playersResult.data);
      } else {
        console.error('[FETCH] No individual players data');
      }
      if (matchesResult.data) {
        const rawMatches = matchesResult.data as unknown as MatchWithTeams[];
        // One-shot DB normalization for purely-numeric courts ("1" -> court_names[0]).
        // Once done, the DB is consistent and renders are deterministic.
        const didNormalize = await normalizeNumericCourtsInDB(rawMatches as any);
        if (didNormalize) {
          await fetchTournamentData(silent);
          return;
        }
        const sortedMatches = rawMatches.slice().sort(
          (a, b) => new Date(a.scheduled_time).getTime() - new Date(b.scheduled_time).getTime()
        );
        setMatches(sortedMatches);
        try {
          const fp = (matchesResult.data as any[])
            .slice()
            .sort((a, b) => (a.match_number || 0) - (b.match_number || 0))
            .map((m: any) => `#${m.match_number}|${(m.court || '').toString().trim()}|${m.scheduled_time || ''}`)
            .join('\n');
          (window as any).__matchesFP = fp;
          (window as any).__matches = matchesResult.data;
        } catch {}

        if (!autoPopulateAttemptedRef.current && effectiveFormat === 'individual_groups_knockout' && playersResult.data && playersResult.data.length > 0) {
          const groupMatches = matchesResult.data.filter((m: any) => m.round.startsWith('group_'));
          const knockoutMatches = matchesResult.data.filter((m: any) => !m.round.startsWith('group_'));
          const allGroupsDone = groupMatches.length > 0 && groupMatches.every((m: any) => m.status === 'completed');
          
          const hasRo16 = knockoutMatches.some((m: any) => m.round === 'round_of_16');
          const hasQFs = knockoutMatches.some((m: any) => m.round === 'quarterfinal' || m.round === 'quarter_final');
          const firstRoundMatches = hasRo16
            ? knockoutMatches.filter((m: any) => m.round === 'round_of_16')
            : hasQFs
            ? knockoutMatches.filter((m: any) => m.round === 'quarterfinal' || m.round === 'quarter_final')
            : knockoutMatches.filter((m: any) => m.round === 'semifinal');
          const hasUnpopulatedFirstRound = firstRoundMatches.length > 0 && firstRoundMatches.some((m: any) =>
            !m.player1_individual_id && !m.player3_individual_id
          );
          
          if (allGroupsDone && hasUnpopulatedFirstRound) {
            autoPopulateAttemptedRef.current = true;
            await populatePlacementMatches(tournament.id);
            await fetchTournamentData(silent);
            return;
          }
        }

        if (effectiveFormat === 'groups_knockout' && categoriesResult.data && categoriesResult.data.length > 0) {
          // Detect categories whose knockout state is OUT OF SYNC with the
          // current group results, in either direction:
          //   (a) groups all done + knockouts still empty -> POPULATE
          //   (b) groups NOT all done + knockouts still hold teams -> CLEAR
          // populateTeamPlacementMatches handles both branches internally.
          const categoriesNeedingSync: string[] = [];
          const hasResultLocal = (m: any) => {
            const t1 = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
            const t2 = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);
            return m.status === 'completed' || t1 > 0 || t2 > 0;
          };
          for (const cat of categoriesResult.data as Array<{ id: string }>) {
            const catGroupMatches = matchesResult.data.filter((m: any) => m.category_id === cat.id && typeof m.round === 'string' && m.round.startsWith('group_'));
            if (catGroupMatches.length === 0) continue;
            const allDone = catGroupMatches.every(hasResultLocal);

            const koRounds = ['round_of_16', 'quarter_final', 'quarterfinal', 'semi_final', 'semifinal', 'final', '3rd_place', '5th_semi', '5th_place', '7th_place'];
            const catKnockouts = matchesResult.data.filter((m: any) =>
              m.category_id === cat.id && koRounds.includes(m.round)
            );
            if (catKnockouts.length === 0) continue;

            const hasEmpty = catKnockouts.some((m: any) => !m.team1_id || !m.team2_id);
            const hasStaleTeams = catKnockouts.some((m: any) => {
              if (hasResultLocal(m)) return false;
              return !!(m.team1_id || m.team2_id);
            });

            if (allDone) {
              categoriesNeedingSync.push(cat.id);
            } else if (!allDone && hasStaleTeams) {
              categoriesNeedingSync.push(cat.id);
            }
          }

          if (!autoPopulateAttemptedRef.current && categoriesNeedingSync.length > 0) {
            autoPopulateAttemptedRef.current = true;
            for (const cId of categoriesNeedingSync) {
              try { await populateTeamPlacementMatches(tournament.id, cId); }
              catch (err) { console.error('[FETCH] populateTeamPlacementMatches error:', err); }
            }
            await fetchTournamentData(silent);
            return;
          }
        }
      }
      if (categoriesResult.data) {
        setCategories(categoriesResult.data);
      }

      // ================================================================
      // AUTO-POPULATE KNOCKOUT quando todos os grupos estão completos
      // ================================================================
      if (matchesResult.data && playersResult.data && categoriesResult.data) {
        const allMatchesLocal = matchesResult.data as unknown as MatchWithTeams[];
        const roundPrefix = effectiveFormat === 'mixed_american' ? 'round_' : 'group_';
        const groupMatchesLocal = allMatchesLocal.filter(m => m.round?.startsWith(roundPrefix));
        const allGroupsDoneLocal = groupMatchesLocal.length > 0 && groupMatchesLocal.every(m => m.status === 'completed');
        const hasCrossedRounds = matchesResult.data.some((m: any) => m.round === 'crossed_r1_j1');
        const hasSemifinalRounds = matchesResult.data.some((m: any) => m.round === 'semifinal');
        
        
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
            return sorted.map(s => ({ id: s.id, name: s.name, wins: s.wins, gamesWon: s.gamesWon, gamesLost: s.gamesLost }));
          };

          try {
            // ================================================================
            // MIXED AMERICAN (1H+1M): popular semifinals com equipas mistas
            // Ranking geral individual → top 4 homens + top 4 mulheres
            // SF1: 1°H + 4°M vs 2°H + 3°M
            // SF2: 3°H + 2°M vs 4°H + 1°M
            // ================================================================
            if (effectiveFormat === 'mixed_american' && hasSemifinalRounds) {
              const sfMatches = matchesResult.data!
                .filter((m: any) => m.round === 'semifinal')
                .sort((a: any, b: any) => a.match_number - b.match_number);

              if (sfMatches.length >= 2) {
                // Get gender for all players from player_accounts
                const allPlayerIds = allMatchesLocal.flatMap(m => [
                  m.player1_individual_id, m.player2_individual_id,
                  m.player3_individual_id, m.player4_individual_id
                ].filter(Boolean));
                const enrolledPlayers = playersResult.data || [];
                const playerPhones = enrolledPlayers
                  .map((p: any) => (p.phone_number || '').replace(/[\s\-\(\)\.]/g, ''))
                  .filter(Boolean);
                const { data: genderAccounts } = await supabase
                  .from('player_accounts')
                  .select('phone_number, gender')
                  .in('phone_number', playerPhones);
                const genderByPhone = new Map<string, string>();
                (genderAccounts || []).forEach((a: any) => {
                  if (a.phone_number && a.gender) {
                    genderByPhone.set(a.phone_number.replace(/[\s\-\(\)\.]/g, ''), a.gender);
                  }
                });

                // Build ranking from all round_* matches (individual points)
                const groupMatches = allMatchesLocal.filter(m => m.round?.startsWith('round_'));
                const playerStats = new Map<string, { id: string; name: string; wins: number; gamesWon: number; gamesLost: number; gender: string }>();
                for (const p of enrolledPlayers) {
                  const phone = ((p as any).phone_number || '').replace(/[\s\-\(\)\.]/g, '');
                  const g = genderByPhone.get(phone) === 'female' ? 'F' : 'M';
                  playerStats.set(p.id, { id: p.id, name: p.name, wins: 0, gamesWon: 0, gamesLost: 0, gender: g });
                }

                for (const m of groupMatches) {
                  if (m.status !== 'completed') continue;
                  const s1 = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
                  const s2 = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);
                  const t1Players = [m.player1_individual_id, m.player2_individual_id].filter(Boolean);
                  const t2Players = [m.player3_individual_id, m.player4_individual_id].filter(Boolean);
                  const t1Won = s1 > s2;
                  for (const pid of t1Players) {
                    const st = playerStats.get(pid!);
                    if (st) { st.gamesWon += s1; st.gamesLost += s2; if (t1Won) st.wins++; }
                  }
                  for (const pid of t2Players) {
                    const st = playerStats.get(pid!);
                    if (st) { st.gamesWon += s2; st.gamesLost += s1; if (!t1Won) st.wins++; }
                  }
                }

                const allRanked = Array.from(playerStats.values())
                  .sort((a, b) => b.wins - a.wins || (b.gamesWon - b.gamesLost) - (a.gamesWon - a.gamesLost) || b.gamesWon - a.gamesWon);
                const rankedMen = allRanked.filter(p => p.gender === 'M');
                const rankedWomen = allRanked.filter(p => p.gender === 'F');


                if (rankedMen.length >= 2 && rankedWomen.length >= 2) {
                  const topMen = rankedMen.slice(0, Math.min(4, rankedMen.length));
                  const topWomen = rankedWomen.slice(0, Math.min(4, rankedWomen.length));

                  // SF1: 1°H + last°F vs 2°H + (last-1)°F
                  // SF2: (last-1)°H + 2°F vs last°H + 1°F
                  const expectedSF1 = {
                    p1: topMen[0].id, p2: topWomen[topWomen.length - 1].id,
                    p3: topMen[1].id, p4: topWomen[topWomen.length > 1 ? topWomen.length - 2 : 0].id
                  };
                  const expectedSF2 = {
                    p1: topMen.length > 2 ? topMen[topMen.length - 2].id : topMen[topMen.length - 1].id,
                    p2: topWomen[1].id,
                    p3: topMen[topMen.length - 1].id,
                    p4: topWomen[0].id
                  };

                  const sf1 = sfMatches[0];
                  const sf1Correct = sf1.player1_individual_id === expectedSF1.p1 &&
                                     sf1.player2_individual_id === expectedSF1.p2 &&
                                     sf1.player3_individual_id === expectedSF1.p3 &&
                                     sf1.player4_individual_id === expectedSF1.p4;
                  const sf2 = sfMatches[1];
                  const sf2Correct = sf2.player1_individual_id === expectedSF2.p1 &&
                                     sf2.player2_individual_id === expectedSF2.p2 &&
                                     sf2.player3_individual_id === expectedSF2.p3 &&
                                     sf2.player4_individual_id === expectedSF2.p4;

                  if (!autoPopulateAttemptedRef.current && (!sf1Correct || !sf2Correct)) {
                    autoPopulateAttemptedRef.current = true;
                    await supabase.from('matches').update({
                      player1_individual_id: expectedSF1.p1, player2_individual_id: expectedSF1.p2,
                      player3_individual_id: expectedSF1.p3, player4_individual_id: expectedSF1.p4
                    }).eq('id', sf1.id);
                    await supabase.from('matches').update({
                      player1_individual_id: expectedSF2.p1, player2_individual_id: expectedSF2.p2,
                      player3_individual_id: expectedSF2.p3, player4_individual_id: expectedSF2.p4
                    }).eq('id', sf2.id);

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

                    await fetchTournamentData(silent); return;
                  } else {
                  }
                }
              }
            }
            
          } catch (err) {
            console.error('[FETCH-FILL] Error:', err);
          }
        }
      }
    }
    
    if (!isEffectiveIndividual && effectiveFormat !== 'super_teams' && effectiveFormat !== 'ladder') {
      setSuperTeams([]);
      setSuperTeamConfrontations([]);
      setSuperTeamStandings([]);
      const [teamsResult, playersResult, matchesResult, categoriesResult] = await Promise.all([
        supabase
          .from('teams')
          .select(TEAMS_WITH_PLAYERS_SELECT)
          .eq('tournament_id', tournament.id)
          .order('seed', { ascending: true }),
        supabase
          .from('players')
          .select('id, name, email, phone_number, group_name, seed, category_id, user_id, created_at, final_position, wants_dinner, payment_status')
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
          .select('id, name, format, number_of_groups, max_teams, knockout_stage, qualified_per_group, rounds, court_names, category_schedule, match_duration_minutes, registration_fee, member_price, non_member_price, swiss_rounds')
          .eq('tournament_id', tournament.id)
          .order('name')
      ]);

      if (teamsResult.error) {
        console.error('[FETCH] Teams error:', teamsResult.error);
      } else if (teamsResult.data) {
        setTeams(teamsResult.data as unknown as TeamWithPlayers[]);
      }
      if (playersResult.data) {
        setIndividualPlayers(playersResult.data);
        const teamPlayerPhones = (teamsResult.data || []).flatMap((t: any) => [
          t.player1?.phone_number ? { phone_number: t.player1.phone_number } : null,
          t.player2?.phone_number ? { phone_number: t.player2.phone_number } : null,
        ]).filter(Boolean);
        fetchPlayerLevelsFromAccounts([...playersResult.data, ...teamPlayerPhones]);
      }
      if (matchesResult.data) {
        const knockoutFetched = matchesResult.data.filter((m: any) => !m.round.startsWith('group_'));
        if (knockoutFetched.length > 0) {
        }
        const rawMatches = matchesResult.data as unknown as MatchWithTeams[];
        const didNormalize = await normalizeNumericCourtsInDB(rawMatches as any);
        if (didNormalize) {
          await fetchTournamentData(silent);
          return;
        }
        const sortedMatches = rawMatches.slice().sort(
          (a, b) => new Date(a.scheduled_time).getTime() - new Date(b.scheduled_time).getTime()
        );
        setMatches(sortedMatches);
        try {
          const fp = (matchesResult.data as any[])
            .slice()
            .sort((a, b) => (a.match_number || 0) - (b.match_number || 0))
            .map((m: any) => `#${m.match_number}|${(m.court || '').toString().trim()}|${m.scheduled_time || ''}`)
            .join('\n');
          (window as any).__matchesFP = fp;
          (window as any).__matches = matchesResult.data;
        } catch {}
      }
      if (categoriesResult.data) {
        setCategories(categoriesResult.data);
      }

      // ================================================================
      // AUTO-SYNC groups_knockout TEAMS (per category)
      // Detecta categorias com format='groups_knockout' onde os knockouts
      // estão fora de sincro com o estado dos grupos:
      //   (a) grupos completos + knockouts vazios -> POPULATE
      //   (b) grupos NÃO completos + knockouts ainda têm equipas -> CLEAR
      // Funciona mesmo quando o torneio top-level NÃO é groups_knockout
      // (e.g. torneio misto com várias categorias de formats diferentes).
      // ================================================================
      if (matchesResult.data && categoriesResult.data && categoriesResult.data.length > 0) {
        const gkCategories = (categoriesResult.data as any[]).filter(c => c.format === 'groups_knockout');
        if (gkCategories.length > 0) {
          const hasResultLocal = (m: any) => {
            const t1 = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
            const t2 = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);
            return m.status === 'completed' || t1 > 0 || t2 > 0;
          };
          const categoriesNeedingSync: string[] = [];
          const koRounds2 = ['round_of_16', 'quarter_final', 'quarterfinal', 'semi_final', 'semifinal', 'final', '3rd_place', '5th_semi', '5th_place', '7th_place'];
          for (const cat of gkCategories) {
            const catGroupMatches = matchesResult.data.filter((m: any) => m.category_id === cat.id && typeof m.round === 'string' && m.round.startsWith('group_'));
            if (catGroupMatches.length === 0) continue;
            const allDone = catGroupMatches.every(hasResultLocal);

            const catKnockouts = matchesResult.data.filter((m: any) =>
              m.category_id === cat.id && koRounds2.includes(m.round)
            );
            if (catKnockouts.length === 0) continue;

            const hasEmpty = catKnockouts.some((m: any) => !m.team1_id || !m.team2_id);
            const hasStaleTeams = catKnockouts.some((m: any) => {
              if (hasResultLocal(m)) return false;
              return !!(m.team1_id || m.team2_id);
            });


            const needsPopulate = allDone;
            const needsClear = !allDone && hasStaleTeams;
            if (!needsPopulate && !needsClear) continue;

            // Build a fingerprint of the relevant state. If we already tried to
            // sync this exact state and nothing changed, the populate clearly
            // can't resolve it (e.g. too few teams) — skip to break the loop.
            const doneCount = catGroupMatches.filter(hasResultLocal).length;
            const koEmptyCount = catKnockouts.filter((m: any) => !m.team1_id || !m.team2_id).length;
            const koStaleCount = catKnockouts.filter((m: any) => !hasResultLocal(m) && (m.team1_id || m.team2_id)).length;
            const koPairSig = catKnockouts
              .filter((m: any) => ['round_of_16', 'quarter_final', 'quarterfinal', 'semi_final', 'semifinal'].includes(m.round))
              .map((m: any) => `${m.round}:${m.match_number}:${m.team1_id || ''}-${m.team2_id || ''}`)
              .sort()
              .join(',');
            const fingerprint = `${doneCount}/${catGroupMatches.length}|emp:${koEmptyCount}|stale:${koStaleCount}|pairs:${koPairSig}|action:${needsPopulate ? 'pop' : 'clr'}`;
            const lastFingerprint = gkSyncFingerprintRef.current.get(cat.id);
            if (lastFingerprint === fingerprint) {
              continue;
            }
            gkSyncFingerprintRef.current.set(cat.id, fingerprint);
            categoriesNeedingSync.push(cat.id);
          }

          if (categoriesNeedingSync.length > 0) {
            (async () => {
              for (const cId of categoriesNeedingSync) {
                try { await populateTeamPlacementMatches(tournament.id, cId); }
                catch (err) { console.error('[FETCH-GK] populateTeamPlacementMatches error:', err); }
              }
              await fetchTournamentData();
            })();
            return;
          }
        }
      }

      // ================================================================
      // AUTO-POPULATE CROSSED PLAYOFFS TEAMS quando todos os grupos estão completos
      // ================================================================
      const tournamentFormat = effectiveFormat;
      
      if (tournamentFormat === 'crossed_playoffs_teams' && matchesResult.data && teamsResult.data && categoriesResult.data) {
        const allMatchesLocal = matchesResult.data as unknown as MatchWithTeams[];
        const groupMatchesLocal = allMatchesLocal.filter(m => m.round?.startsWith('group_'));
        
        // Verificação robusta: jogo está "done" se status é 'completed' OU se tem scores preenchidos
        const isMatchDone = (m: MatchWithTeams) => {
          if (m.status === 'completed') return true;
          // Se tem scores preenchidos (pelo menos set1), considerar como done
          const hasScores = (m.team1_score_set1 != null && m.team2_score_set1 != null) && 
            ((m.team1_score_set1 as number) > 0 || (m.team2_score_set1 as number) > 0);
          return hasScores;
        };
        
        const allGroupsDoneLocal = groupMatchesLocal.length > 0 && groupMatchesLocal.every(m => isMatchDone(m));
        const crossedMatches = allMatchesLocal.filter(m => m.round?.startsWith('crossed_'));
        const hasCrossedRounds = crossedMatches.length > 0;
        
        
        // ================================================================
        // AUTO-FIX: Verificar se estrutura de playoffs está completa
        // Se faltam jogos (ex: só tem 4 em vez de 10), criar os que faltam
        // ================================================================
        const localCats = categoriesResult.data as Array<{ id: string; name: string; qualified_per_group?: number; knockout_stage?: string }>;
        
        // Fallback robusto: categoria → torneio → auto-cálculo
        let qualifiedPerGroupLocal = (localCats[0] as any)?.qualified_per_group;
        let knockoutStageLocal = (localCats[0] as any)?.knockout_stage;
        
        if (!qualifiedPerGroupLocal || qualifiedPerGroupLocal <= 0) {
          const ksGuess =
            knockoutStageLocal ||
            (localCats[0] as any)?.knockout_stage ||
            (currentTournament as any)?.knockout_stage ||
            'semifinals';
          qualifiedPerGroupLocal = calculateTeamQualificationConfig(localCats.length, ksGuess).qualifiedPerGroup;
        }
        if (!knockoutStageLocal) {
          const tournamentKS = (currentTournament as any)?.knockout_stage;
          if (tournamentKS) {
            knockoutStageLocal = tournamentKS;
          } else {
            const totalQ = localCats.length * qualifiedPerGroupLocal;
            knockoutStageLocal = totalQ >= 8 ? 'quarterfinals' : totalQ >= 4 ? 'semifinals' : 'final';
          }
        }
        const totalQualifiedLocal = localCats.length * qualifiedPerGroupLocal;
        
        // Calcular quantos playoffs DEVEM existir
        let expectedR1 = 0, expectedR2 = 0, expectedR3 = 2, expectedR4 = 0, expectedR5 = 0;
        if (knockoutStageLocal === 'quarterfinals') {
          expectedR1 = totalQualifiedLocal / 2; // ex: 8/2 = 4 quartos
          expectedR2 = expectedR1 / 2; // 2 meias
          expectedR4 = 1; // 5-6
          expectedR5 = 1; // 7-8
        } else {
          expectedR1 = totalQualifiedLocal / 2; // meias diretas
        }
        const expectedTotal = expectedR1 + expectedR2 + expectedR3 + expectedR4 + expectedR5;
        
        // Contar quantos playoffs EXISTEM
        const existingR1 = crossedMatches.filter(m => m.round?.startsWith('crossed_r1_')).length;
        const existingR2 = crossedMatches.filter(m => m.round?.startsWith('crossed_r2_')).length;
        const existingR3 = crossedMatches.filter(m => m.round?.startsWith('crossed_r3_')).length;
        const existingR4 = crossedMatches.filter(m => m.round?.startsWith('crossed_r4_')).length;
        const existingR5 = crossedMatches.filter(m => m.round?.startsWith('crossed_r5_')).length;
        const existingTotal = existingR1 + existingR2 + existingR3 + existingR4 + existingR5;
        
        
        // [DISABLED] AUTO-FIX que apagava TODOS os playoffs e recriava em cada fetch.
        // Causava alteração contínua de campos/horários sempre que se abria a app.
        // Para regenerar, use o botão "Gerar Calendário" manualmente.
        if (false && hasCrossedRounds && existingTotal < expectedTotal) {
          
          // Apagar TODOS os playoffs existentes e recriá-los
          const { error: deleteErr } = await supabase.from('matches')
            .delete()
            .eq('tournament_id', tournament.id)
            .like('round', 'crossed_%');
          
          if (deleteErr) {
            console.error('[FETCH-AUTOFIX] Error deleting old playoffs:', deleteErr);
          } else {
            // Calcular horário para os playoffs (último jogo de grupo + duração)
            const matchDuration = currentTournament?.match_duration_minutes || 20;
            const lastGroupMatch = [...groupMatchesLocal].sort((a, b) => 
              new Date(b.scheduled_time || 0).getTime() - new Date(a.scheduled_time || 0).getTime()
            )[0];
            const baseTime = lastGroupMatch?.scheduled_time 
              ? new Date(new Date(lastGroupMatch.scheduled_time).getTime() + matchDuration * 60000)
              : new Date();
            
            const maxNum = Math.max(...allMatchesLocal.map(m => m.match_number || 0), 0);
            let matchNum = maxNum + 1;
            const numberOfCourts = currentTournament?.number_of_courts || 4;
            const fixCourtNames: string[] = (currentTournament as any)?.court_names || [];
            const fixCourtName = (idx: number) => fixCourtNames[idx] || (idx + 1).toString();
            
            const formatTime = (d: Date) => d.toISOString();
            
            const newPlayoffs: any[] = [];
            let currentTime = new Date(baseTime);
            
            // R1 - Quartos de final
            const r1TimeStr = formatTime(currentTime);
            for (let i = 0; i < expectedR1; i++) {
              newPlayoffs.push({
                tournament_id: tournament.id,
                category_id: null,
                round: `crossed_r1_j${i + 1}`,
                match_number: matchNum++,
                team1_id: null,
                team2_id: null,
                scheduled_time: r1TimeStr,
                court: fixCourtName(i % numberOfCourts),
                status: 'scheduled'
              });
            }
            
            // R2 - Meias-finais
            if (expectedR2 > 0) {
              currentTime = new Date(currentTime.getTime() + matchDuration * 60000);
              const r2TimeStr = formatTime(currentTime);
              for (let i = 0; i < expectedR2; i++) {
                newPlayoffs.push({
                  tournament_id: tournament.id,
                  category_id: null,
                  round: `crossed_r2_j${i + 1}`,
                  match_number: matchNum++,
                  team1_id: null,
                  team2_id: null,
                  scheduled_time: r2TimeStr,
                  court: fixCourtName(i % numberOfCourts),
                  status: 'scheduled'
                });
              }
            }
            
            // R3 - Final + 3º/4º (+ 5-6 e 7-8 no mesmo slot)
            currentTime = new Date(currentTime.getTime() + matchDuration * 60000);
            const r3TimeStr = formatTime(currentTime);
            
            newPlayoffs.push({
              tournament_id: tournament.id, category_id: null,
              round: 'crossed_r3_final', match_number: matchNum++,
              team1_id: null, team2_id: null,
              scheduled_time: r3TimeStr, court: fixCourtName(0), status: 'scheduled'
            });
            newPlayoffs.push({
              tournament_id: tournament.id, category_id: null,
              round: 'crossed_r3_3rd_place', match_number: matchNum++,
              team1_id: null, team2_id: null,
              scheduled_time: r3TimeStr, court: fixCourtName(1), status: 'scheduled'
            });
            
            if (expectedR4 > 0) {
              newPlayoffs.push({
                tournament_id: tournament.id, category_id: null,
                round: 'crossed_r4_5th', match_number: matchNum++,
                team1_id: null, team2_id: null,
                scheduled_time: r3TimeStr, court: fixCourtName(2), status: 'scheduled'
              });
            }
            if (expectedR5 > 0) {
              newPlayoffs.push({
                tournament_id: tournament.id, category_id: null,
                round: 'crossed_r5_7th', match_number: matchNum++,
                team1_id: null, team2_id: null,
                scheduled_time: r3TimeStr, court: fixCourtName(3), status: 'scheduled'
              });
            }
            
            const { error: insertErr } = await supabase.from('matches').insert(newPlayoffs);
            if (insertErr) {
              console.error('[FETCH-AUTOFIX] Error inserting playoffs:', insertErr);
            } else {
              await fetchTournamentData();
              return;
            }
          }
        }
        
        
        if (allGroupsDoneLocal && hasCrossedRounds) {
          const r1j1Local = allMatchesLocal.find(m => m.round === 'crossed_r1_j1');
          const localCategories = categoriesResult.data as Array<{ id: string; name: string }>;
          const sortedCats = [...localCategories].sort((a, b) => a.name.localeCompare(b.name));
          
          
          if (!autoPopulateAttemptedRef.current && r1j1Local && sortedCats.length >= 2 && sortedCats.length <= 3) {
            autoPopulateAttemptedRef.current = true;
            
            // Função para calcular ranking de equipas de uma categoria
            const getCategoryTeamRankings = (categoryId: string) => {
              const categoryTeams = teamsResult.data!.filter((t: any) => t.category_id === categoryId);
              const categoryMatches = matchesResult.data!.filter((m: any) => {
                if (m.category_id !== categoryId || !m.round?.startsWith('group_') || !m.team1_id || !m.team2_id) return false;
                // Aceitar se status é 'completed' OU se tem scores preenchidos
                if (m.status === 'completed') return true;
                const hasScores = (m.team1_score_set1 != null && m.team2_score_set1 != null) && 
                  ((m.team1_score_set1 || 0) > 0 || (m.team2_score_set1 || 0) > 0);
                return hasScores;
              });


              const teamStats = new Map<string, { id: string; name: string; wins: number; gamesWon: number; gamesLost: number }>();
              
              categoryTeams.forEach((team: any) => {
                teamStats.set(team.id, { 
                  id: team.id, 
                  name: team.name, 
                  wins: 0, 
                  gamesWon: 0, 
                  gamesLost: 0 
                });
              });

              categoryMatches.forEach((match: any) => {
                const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
                const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
                const team1Won = team1Games > team2Games;

                if (match.team1_id) {
                  const stats = teamStats.get(match.team1_id);
                  if (stats) {
                    stats.gamesWon += team1Games;
                    stats.gamesLost += team2Games;
                    if (team1Won) stats.wins++;
                  }
                }

                if (match.team2_id) {
                  const stats = teamStats.get(match.team2_id);
                  if (stats) {
                    stats.gamesWon += team2Games;
                    stats.gamesLost += team1Games;
                    if (!team1Won) stats.wins++;
                  }
                }
              });

              return Array.from(teamStats.values())
                .sort((a, b) => {
                  if (a.wins !== b.wins) return b.wins - a.wins;
                  const diffA = a.gamesWon - a.gamesLost;
                  const diffB = b.gamesWon - b.gamesLost;
                  return diffB - diffA;
                });
            };
            
            try {
              if (sortedCats.length === 3) {
                const [catA, catB, catC] = sortedCats;
                const rankA = getCategoryTeamRankings(catA.id);
                const rankB = getCategoryTeamRankings(catB.id);
                const rankC = getCategoryTeamRankings(catC.id);
                
                
                // Ler configurações das categorias para determinar quantas equipas qualificam
                let qualifiedPerGroup = (sortedCats[0] as any).qualified_per_group;
                if (!qualifiedPerGroup || qualifiedPerGroup <= 0) {
                  const ksGuess =
                    (sortedCats[0] as any).knockout_stage ||
                    (currentTournament as any)?.knockout_stage ||
                    'semifinals';
                  qualifiedPerGroup = calculateTeamQualificationConfig(sortedCats.length, ksGuess).qualifiedPerGroup;
                }
                
                // Encontrar todos os jogos R1 (usar allMatchesLocal do scope pai)
                const r1MatchesLocal = allMatchesLocal.filter(m => m.round?.startsWith('crossed_r1_j')).sort((a, b) => {
                  const aNum = parseInt(a.round?.match(/j(\d+)/)?.[1] || '0');
                  const bNum = parseInt(b.round?.match(/j(\d+)/)?.[1] || '0');
                  return aNum - bNum;
                });
                
                
                if (rankA.length >= qualifiedPerGroup && rankB.length >= qualifiedPerGroup && rankC.length >= qualifiedPerGroup) {
                  
                  // Para 3 categorias, distribuir os jogos entre as categorias
                  // J1: 1°A vs 4°B
                  // J2: 2°A vs 3°B
                  // J3: 1°B vs 4°C
                  // J4: 2°B vs 3°C (ou 1°C vs 4°A se houver mais jogos)
                  
                  const matchups = [];
                  if (qualifiedPerGroup === 4) {
                    matchups.push({ team1: rankA[0], team2: rankB[3] }); // J1: 1°A vs 4°B
                    matchups.push({ team1: rankA[1], team2: rankB[2] }); // J2: 2°A vs 3°B
                    matchups.push({ team1: rankB[0], team2: rankC[3] }); // J3: 1°B vs 4°C
                    if (r1MatchesLocal.length >= 4) {
                      matchups.push({ team1: rankB[1], team2: rankC[2] }); // J4: 2°B vs 3°C
                    }
                  } else if (qualifiedPerGroup === 2) {
                    matchups.push({ team1: rankA[0], team2: rankB[1] }); // J1: 1°A vs 2°B
                    matchups.push({ team1: rankB[0], team2: rankC[1] }); // J2: 1°B vs 2°C
                  }
                  
                  // Preencher os jogos R1
                  for (let i = 0; i < Math.min(r1MatchesLocal.length, matchups.length); i++) {
                    const match = r1MatchesLocal[i];
                    const matchup = matchups[i];
                    const { error, data } = await supabase.from('matches').update({
                      team1_id: matchup.team1.id,
                      team2_id: matchup.team2.id
                    }).eq('id', match.id).select();
                  }
                  
                  await fetchTournamentData(silent); return;
                } else {
                }
              } else if (sortedCats.length === 2) {
                const [catA, catB] = sortedCats;
                const rankA = getCategoryTeamRankings(catA.id);
                const rankB = getCategoryTeamRankings(catB.id);
                const hasResult = (m: any) =>
                  (m.team1_score_set1 != null && m.team2_score_set1 != null) ||
                  (m.team1_score_set2 != null && m.team2_score_set2 != null) ||
                  (m.team1_score_set3 != null && m.team2_score_set3 != null);
                const isKnockoutDone = (m: any) => m?.status === 'completed' || hasResult(m);
                const getWinnerLoser = (m: any) => {
                  const t1 = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
                  const t2 = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);
                  if (t1 >= t2) return { winnerId: m.team1_id, loserId: m.team2_id };
                  return { winnerId: m.team2_id, loserId: m.team1_id };
                };
                
                
                // Ler configurações das categorias para determinar quantas equipas qualificam
                let qualifiedPerGroup = (sortedCats[0] as any).qualified_per_group;
                if (!qualifiedPerGroup || qualifiedPerGroup <= 0) {
                  const ksGuess =
                    (sortedCats[0] as any).knockout_stage ||
                    (currentTournament as any)?.knockout_stage ||
                    'semifinals';
                  qualifiedPerGroup = calculateTeamQualificationConfig(sortedCats.length, ksGuess).qualifiedPerGroup;
                }
                
                // Encontrar todos os jogos R1
                const r1MatchesLocal = allMatchesLocal.filter(m => m.round?.startsWith('crossed_r1_j')).sort((a, b) => {
                  const aNum = parseInt(a.round?.match(/j(\d+)/)?.[1] || '0');
                  const bNum = parseInt(b.round?.match(/j(\d+)/)?.[1] || '0');
                  return aNum - bNum;
                });
                const r4MatchLocal = allMatchesLocal.find(m => m.round === 'crossed_r4_5th');
                const r5MatchLocal = allMatchesLocal.find(m => m.round === 'crossed_r5_7th');
                const r2SemisLocal = allMatchesLocal.filter(m => m.round === 'crossed_r2_j1' || m.round === 'crossed_r2_j2');
                const finalMatchLocal = allMatchesLocal.find(m => m.round === 'crossed_r3_final');
                const thirdPlaceLocal = allMatchesLocal.find(m => m.round === 'crossed_r3_3rd_place');
                const r6aLocal = allMatchesLocal.find(m => m.round === 'crossed_r6_5th_final');
                const r6bLocal = allMatchesLocal.find(m => m.round === 'crossed_r6_7th_final');
                
                
                if (rankA.length >= qualifiedPerGroup && rankB.length >= qualifiedPerGroup) {
                  
                  // Preencher os jogos R1 baseado no número de jogos e equipas qualificadas
                  // Para 4 equipas qualificadas por categoria (8 total), temos 4 jogos:
                  // J1: 1°A vs 4°B
                  // J2: 2°A vs 3°B
                  // J3: 3°A vs 2°B
                  // J4: 4°A vs 1°B
                  
                  const matchups = [];
                  if (qualifiedPerGroup === 4) {
                    matchups.push({ team1: rankA[0], team2: rankB[3] }); // J1: 1°A vs 4°B
                    matchups.push({ team1: rankA[1], team2: rankB[2] }); // J2: 2°A vs 3°B
                    matchups.push({ team1: rankA[2], team2: rankB[1] }); // J3: 3°A vs 2°B
                    matchups.push({ team1: rankA[3], team2: rankB[0] }); // J4: 4°A vs 1°B
                  } else if (qualifiedPerGroup === 2) {
                    matchups.push({ team1: rankA[0], team2: rankB[1] }); // J1: 1°A vs 2°B
                    matchups.push({ team1: rankA[1], team2: rankB[0] }); // J2: 2°A vs 1°B
                  }
                  
                  let changed = false;

                  // Preencher os jogos R1 (meias diretas quando qualifiedPerGroup=2)
                  for (let i = 0; i < Math.min(r1MatchesLocal.length, matchups.length); i++) {
                    const match = r1MatchesLocal[i];
                    const matchup = matchups[i];
                    if (match.team1_id && match.team2_id) continue;
                    const { error, data } = await supabase.from('matches').update({
                      team1_id: matchup.team1.id,
                      team2_id: matchup.team2.id
                    }).eq('id', match.id).select();
                    changed = true;
                  }

                  // Para cenário com 2 qualificadas/categoria, preencher também jogos de classificação
                  // com as não qualificadas (3º/4º de cada categoria): 3A vs 4B e 4A vs 3B.
                  if (qualifiedPerGroup === 2 && rankA.length >= 4 && rankB.length >= 4) {
                    if (r4MatchLocal && (!r4MatchLocal.team1_id || !r4MatchLocal.team2_id)) {
                      await supabase.from('matches').update({
                        team1_id: rankA[2].id,
                        team2_id: rankB[3].id,
                      }).eq('id', r4MatchLocal.id);
                      changed = true;
                    }
                    if (r5MatchLocal && (!r5MatchLocal.team1_id || !r5MatchLocal.team2_id)) {
                      await supabase.from('matches').update({
                        team1_id: rankA[3].id,
                        team2_id: rankB[2].id,
                      }).eq('id', r5MatchLocal.id);
                      changed = true;
                    }
                  }

                  // Fallback robusto: preencher FINAL e 3º/4º quando as meias já têm resultado.
                  const isDirectSemis = r2SemisLocal.length === 0;
                  if (isDirectSemis && r1MatchesLocal.length >= 2 && finalMatchLocal && thirdPlaceLocal) {
                    const sf1 = r1MatchesLocal[0];
                    const sf2 = r1MatchesLocal[1];
                    if (isKnockoutDone(sf1) && isKnockoutDone(sf2)) {
                      const sf1Res = getWinnerLoser(sf1);
                      const sf2Res = getWinnerLoser(sf2);
                      if (!finalMatchLocal.team1_id || !finalMatchLocal.team2_id) {
                        await supabase.from('matches').update({
                          team1_id: sf1Res.winnerId,
                          team2_id: sf2Res.winnerId,
                        }).eq('id', finalMatchLocal.id);
                        changed = true;
                      }
                      if (!thirdPlaceLocal.team1_id || !thirdPlaceLocal.team2_id) {
                        await supabase.from('matches').update({
                          team1_id: sf1Res.loserId,
                          team2_id: sf2Res.loserId,
                        }).eq('id', thirdPlaceLocal.id);
                        changed = true;
                      }
                    }
                  }

                  // Nova fase de classificação final (5º/6º e 7º/8º) a partir dos jogos A/B.
                  if (r4MatchLocal && r5MatchLocal && r6aLocal && r6bLocal && isKnockoutDone(r4MatchLocal) && isKnockoutDone(r5MatchLocal)) {
                    const r4Res = getWinnerLoser(r4MatchLocal);
                    const r5Res = getWinnerLoser(r5MatchLocal);
                    if (!r6aLocal.team1_id || !r6aLocal.team2_id) {
                      await supabase.from('matches').update({
                        team1_id: r4Res.winnerId,
                        team2_id: r5Res.winnerId,
                      }).eq('id', r6aLocal.id);
                      changed = true;
                    }
                    if (!r6bLocal.team1_id || !r6bLocal.team2_id) {
                      await supabase.from('matches').update({
                        team1_id: r4Res.loserId,
                        team2_id: r5Res.loserId,
                      }).eq('id', r6bLocal.id);
                      changed = true;
                    }
                  }
                  
                  if (changed) {
                    await fetchTournamentData(silent); return;
                  }
                } else {
                }
              } else {
              }
            } catch (err) {
              console.error('[FETCH-FILL-TEAMS] Error:', err);
            }
          } else {
          }
        } else {
        }
      }
    }

    } finally {
      fetchDepthRef.current = Math.max(0, fetchDepthRef.current - 1);
      if (fetchDepthRef.current === 0) autoPopulateAttemptedRef.current = false;
      setLoading(false);
      setRefreshKey(prev => prev + 1);

      if (scrollToMatchIdRef.current) {
        const matchId = scrollToMatchIdRef.current;
        scrollToMatchIdRef.current = null;
        requestAnimationFrame(() => {
          const el = document.getElementById(`match-${matchId}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('ring-2', 'ring-blue-400', 'ring-offset-2');
            setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-2'), 2000);
          }
        });
      }
    }
  };

  const handleAssignGroups = async () => {
    const validFormats = ['groups_knockout', 'individual_groups_knockout', 'crossed_playoffs_teams', 'mixed_american'];
    if (!validFormats.includes(currentTournament.format || '')) {
      alert('Group assignment is only available for Groups + Knockout, Crossed Playoffs, Mixed Gender and Mixed American formats');
      return;
    }

    const isIndividualFormat = currentTournament.format === 'individual_groups_knockout' || 
                               currentTournament.format === 'mixed_american';
    // crossed_playoffs_teams é formato de EQUIPAS, não individual
    const participantLabel = isIndividualFormat ? 'players' : 'teams';

    const scopeLabel = selectedCategory
      ? `na categoria "${categories.find(c => c.id === selectedCategory)?.name || selectedCategory}"`
      : 'em TODAS as categorias';
    const confirmed = confirm(
      `Vai sortear ${participantLabel} ${scopeLabel}. As atribuições de grupo existentes serão substituídas. Continuar?`
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      const { teamSeeds, playerSeeds } = await recalculateSeedsByLevel(tournament.id);
      const teamsForDraw = teams.map(t => ({ ...t, seed: teamSeeds.get(t.id) ?? t.seed }));
      const playersForDraw = individualPlayers.map(p => ({ ...p, seed: playerSeeds.get(p.id) ?? p.seed }));

      const { data: latestTournament } = await supabase
        .from('tournaments')
        .select('*')
        .eq('id', tournament.id)
        .single();

      if (!latestTournament) {
        throw new Error('Failed to fetch tournament data');
      }
      setCurrentTournament(latestTournament as Tournament);


      if (isIndividualFormat) {
        const { assignPlayersToGroups, savePlayerGroupAssignments } = await import('../lib/groups');

        if (categories.length > 0) {
          const allPlayersWithGroups: any[] = [];
          const tournamentNumberOfGroups = (latestTournament as any).number_of_groups || 2;
          
          // Para playoffs cruzados de equipas, cada categoria = 1 grupo com nome diferente (A, B, C...)
          const isCrossedPlayoffs = currentTournament.format === 'crossed_playoffs_teams';
          
          // Ordenar categorias por nome para consistência (primeira = A, segunda = B, terceira = C)
          const allSortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));
          const sortedCategories = selectedCategory
            ? allSortedCategories.filter(c => c.id === selectedCategory)
            : allSortedCategories;

          for (let catIndex = 0; catIndex < sortedCategories.length; catIndex++) {
            const category = sortedCategories[catIndex];
            
            // Para playoffs cruzados de equipas, usar teams em vez de players
            if (currentTournament.format === 'crossed_playoffs_teams') {
              const categoryTeams = teamsForDraw.filter(t => t.category_id === category.id);
              // Se é playoffs cruzados, forçar 1 grupo por categoria
              const numberOfGroups = isCrossedPlayoffs ? 1 : ((category as any).number_of_groups || tournamentNumberOfGroups);
              const minTeams = numberOfGroups * 2;
              
              // Nome do grupo: para playoffs cruzados, usar A, B, C baseado na ordem da categoria
              const crossedGroupName = String.fromCharCode(65 + catIndex); // A, B, C
              
              
              if (categoryTeams.length < minTeams) {
                alert(`Categoria "${category.name}" precisa de pelo menos ${minTeams} equipas para ${numberOfGroups} grupo(s). Encontradas: ${categoryTeams.length}`);
                setLoading(false);
                return;
              }
              
              // Atribuir grupos às equipas
              if (isCrossedPlayoffs) {
                // Para playoffs cruzados de equipas, atribuir o mesmo grupo a todas as equipas da categoria
                for (const team of categoryTeams) {
                  await supabase
                    .from('teams')
                    .update({ group_name: crossedGroupName })
                    .eq('id', team.id);
                }
              } else {
                // Distribuição normal por grupos
                const shuffled = [...categoryTeams].sort(() => Math.random() - 0.5);
                for (let i = 0; i < shuffled.length; i++) {
                  const groupIndex = i % numberOfGroups;
                  const groupName = String.fromCharCode(65 + groupIndex);
                  await supabase
                    .from('teams')
                    .update({ group_name: groupName })
                    .eq('id', shuffled[i].id);
                }
              }
            } else {
              // Lógica original para jogadores individuais
            const categoryPlayers = playersForDraw.filter(p => p.category_id === category.id);
            // Se é playoffs cruzados, forçar 1 grupo por categoria
            const numberOfGroups = isCrossedPlayoffs ? 1 : ((category as any).number_of_groups || tournamentNumberOfGroups);
            const minPlayers = numberOfGroups * 4;
            
            // Nome do grupo: para playoffs cruzados, usar A, B, C baseado na ordem da categoria
            const crossedGroupName = String.fromCharCode(65 + catIndex); // A, B, C


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
          }

          await savePlayerGroupAssignments(allPlayersWithGroups);
        } else {
          const numberOfGroups = (latestTournament as any).number_of_groups || 2;
          const minPlayers = numberOfGroups * 4;


          if (playersForDraw.length < minPlayers) {
            alert(`You need at least ${minPlayers} players for ${numberOfGroups} groups (minimum 4 per group for American format)`);
            setLoading(false);
            return;
          }

          const playersWithGroups = assignPlayersToGroups(playersForDraw, numberOfGroups);
          await savePlayerGroupAssignments(playersWithGroups);
        }

        await fetchTournamentData();
        alert('Players have been randomly assigned to groups!');
      } else {
        const { assignTeamsToGroups, saveGroupAssignments } = await import('../lib/groups');

        if (categories.length > 0) {
          const allTeamsWithGroups: any[] = [];
          const tournamentNumberOfGroups = (latestTournament as any).number_of_groups || 4;
          const allTeamCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));
          const sortedTeamCategories = selectedCategory
            ? allTeamCategories.filter(c => c.id === selectedCategory)
            : allTeamCategories;

          for (const category of sortedTeamCategories) {
            const categoryTeams = teamsForDraw.filter(t => t.category_id === category.id);
            const numberOfGroups = (category as any).number_of_groups || tournamentNumberOfGroups;
            const minTeams = numberOfGroups * 2;


            if (categoryTeams.length < minTeams) {
              alert(`Category "${category.name}" needs at least ${minTeams} teams for ${numberOfGroups} groups`);
              setLoading(false);
              return;
            }

            let teamsWithGroups = assignTeamsToGroups(categoryTeams, numberOfGroups);
            // Evita colisões quando há várias categorias com os mesmos nomes de grupo (A, B, ...).
            // Ex.: M3-A e M4-A em vez de misturar tudo em "A" na UI/standings.
            if (sortedTeamCategories.length > 1) {
              const categoryLabel = (category.name || '').trim() || category.id.slice(0, 8);
              teamsWithGroups = teamsWithGroups.map((team) => ({
                ...team,
                group_name: `${categoryLabel}-${team.group_name}`,
              }));
            }
            allTeamsWithGroups.push(...teamsWithGroups);
          }

          await saveGroupAssignments(tournament.id, allTeamsWithGroups);
        } else {
          const numberOfGroups = (latestTournament as any).number_of_groups || 4;
          const minTeams = numberOfGroups * 2;


          if (teamsForDraw.length < minTeams) {
            alert(`You need at least ${minTeams} teams for ${numberOfGroups} groups`);
            setLoading(false);
            return;
          }

          const teamsWithGroups = assignTeamsToGroups(teamsForDraw, numberOfGroups);
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

    const category = categories.find(c => c.id === categoryId);
    if (!category) {
      alert('Category not found');
      return;
    }

    const categoryMatches = matches.filter(m => m.category_id === categoryId);
    const groupMatches = categoryMatches.filter(m => m.round.startsWith('group_'));
    const categoryPlayers = individualPlayers.filter(p => p.category_id === categoryId);

    const uniqueGroups = new Set(categoryPlayers.map(p => p.group_name).filter(Boolean));
    const numberOfGroups = uniqueGroups.size || (category as any).number_of_groups || 2;
    const knockoutStage = (category as any).knockout_stage || 'semifinals';


    const qualConfig = calculateQualificationConfig(numberOfGroups, knockoutStage, true);
    const { qualifiedPerGroup, extraBestNeeded, totalQualified, extraFromPosition } = qualConfig;


    if ((category as any).qualified_per_group !== qualifiedPerGroup) {
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
              if (team2Games > team1Games) stats.wins++;
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
              if (team2Games > team1Games) stats.wins++;
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
        const ro16Matches = categoryMatches
          .filter(m => m.round === 'round_of_16')
          .sort((a, b) => a.match_number - b.match_number);
        const hasUnpopulatedRo16 = ro16Matches.some(m =>
          !m.player1_individual_id && !m.player3_individual_id
        );

        if (ro16Matches.length > 0 && hasUnpopulatedRo16) {
          const confirmed = confirm(
            `Atribuir ${qualifiedPlayers.length} jogadores qualificados a ${ro16Matches.length} oitavos de final?`
          );
          if (!confirmed) { setLoading(false); return; }

          const usedInPairing = new Set<string>();
          const ro16Pairs: Array<[string, string]> = [];

          for (let g = 0; g < sortedGroupNames.length; g++) {
            const gNext = (g + 1) % sortedGroupNames.length;
            const playersG = qualifiedByGroup.get(sortedGroupNames[g]) || [];
            const playersGNext = qualifiedByGroup.get(sortedGroupNames[gNext]) || [];
            const pA = playersG.length > 0 && !usedInPairing.has(playersG[0]) ? playersG[0] : null;
            const pB = playersGNext.length > 1 && !usedInPairing.has(playersGNext[1]) ? playersGNext[1] : null;
            if (pA && pB) {
              ro16Pairs.push([pA, pB]);
              usedInPairing.add(pA);
              usedInPairing.add(pB);
            }
          }

          const remaining: string[] = [];
          sortedGroupNames.forEach(gName => {
            (qualifiedByGroup.get(gName) || []).slice(2).forEach(p => {
              if (!usedInPairing.has(p)) { remaining.push(p); usedInPairing.add(p); }
            });
          });
          qualifiedPlayers.forEach(p => {
            if (!usedInPairing.has(p)) { remaining.push(p); usedInPairing.add(p); }
          });
          for (let r = 0; r + 1 < remaining.length; r += 2) {
            ro16Pairs.push([remaining[r], remaining[r + 1]]);
          }

          const unpopulatedRo16 = ro16Matches.filter(m =>
            !m.player1_individual_id && !m.player3_individual_id
          );
          for (let i = 0; i < unpopulatedRo16.length && (i * 2 + 1) < ro16Pairs.length; i++) {
            const p1 = ro16Pairs[i * 2];
            const p2 = ro16Pairs[i * 2 + 1];
            if (!p1?.[0] || !p1?.[1] || !p2?.[0] || !p2?.[1]) break;
            const { error } = await supabase.from('matches').update({
              player1_individual_id: p1[0],
              player2_individual_id: p1[1],
              player3_individual_id: p2[0],
              player4_individual_id: p2[1],
            }).eq('id', unpopulatedRo16[i].id);
            if (error) throw error;
          }

          await fetchTournamentData();
          alert(`Oitavos gerados (${qualifiedPerGroup}/grupo + ${extraBestNeeded} melhor ${extraFromPosition}°).`);
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

    if (categories.length !== 2) {
      alert(`Playoffs Mistos requer exatamente 2 categorias. Encontradas: ${categories.length}`);
      return;
    }

    // Ordenar categorias por nome para consistência (A=primeira, B=segunda)
    const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));
    const [catA, catB] = sortedCategories;


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
          court: courtName(i % (currentTournament.number_of_courts || 1)),
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
          court: courtName(i % (currentTournament.number_of_courts || 1)),
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

    if (categories.length !== 3) {
      alert(`Playoffs Cruzados entre categorias requer exatamente 3 categorias. Encontradas: ${categories.length}`);
      return;
    }

    // Ordenar categorias por nome para consistência (A=primeira, B=segunda, C=terceira)
    const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));
    const [catA, catB, catC] = sortedCategories;


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
            court: courtName(i % (currentTournament.number_of_courts || 1)),
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
            court: courtName(i % (currentTournament.number_of_courts || 1)),
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
            court: courtName(i % (currentTournament.number_of_courts || 1)),
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

  // Função para gerar Playoffs Cruzados ENTRE CATEGORIAS COM EQUIPAS (ex: M3, M4, M5 = grupos A, B, C)
  // Estrutura completa: R1 (3 jogos) + R2 Meias-Finais (3 jogos) + R3 Finais (2 jogos) = 8 jogos total
  const handleGenerateCrossedPlayoffsTeamsBetweenCategories = async () => {

    if (categories.length < 2 || categories.length > 3) {
      alert(`Playoffs Cruzados entre categorias requer 2 ou 3 categorias. Encontradas: ${categories.length}`);
      return;
    }

    // Ordenar categorias por nome para consistência (A=primeira, B=segunda, C=terceira)
    const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));
    const [catA, catB, catC] = sortedCategories;


    // Função para calcular ranking de equipas de uma categoria
    const getCategoryTeamRankings = (categoryId: string) => {
      const categoryTeams = teams.filter(t => t.category_id === categoryId);
      const categoryMatches = matches.filter(m => 
        m.category_id === categoryId && 
        m.round.startsWith('group_') && 
        m.status === 'completed' &&
        m.team1_id && 
        m.team2_id
      );

      const teamStats = new Map<string, { id: string; name: string; wins: number; gamesWon: number; gamesLost: number }>();
      
      categoryTeams.forEach(team => {
        teamStats.set(team.id, { 
          id: team.id, 
          name: team.name, 
          wins: 0, 
          gamesWon: 0, 
          gamesLost: 0 
        });
      });

      categoryMatches.forEach(match => {
        const team1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
        const team2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
        const team1Won = team1Games > team2Games;

        if (match.team1_id) {
          const stats = teamStats.get(match.team1_id);
          if (stats) {
            stats.gamesWon += team1Games;
            stats.gamesLost += team2Games;
            if (team1Won) stats.wins++;
          }
        }

        if (match.team2_id) {
          const stats = teamStats.get(match.team2_id);
          if (stats) {
            stats.gamesWon += team2Games;
            stats.gamesLost += team1Games;
            if (!team1Won) stats.wins++;
          }
        }
      });

      return Array.from(teamStats.values())
        .sort((a, b) => {
          if (a.wins !== b.wins) return b.wins - a.wins;
          const diffA = a.gamesWon - a.gamesLost;
          const diffB = b.gamesWon - b.gamesLost;
          return diffB - diffA;
        });
    };

    // Obter rankings de cada categoria
    const rankA = getCategoryTeamRankings(catA.id);
    const rankB = getCategoryTeamRankings(catB.id);
    const rankC = catC ? getCategoryTeamRankings(catC.id) : [];

    if (catC) console.log(`  ${catC.name}:`, rankC.map(t => t.name));

    // Verificar se cada categoria tem pelo menos 4 equipas
    if (rankA.length < 4 || rankB.length < 4 || (catC && rankC.length < 4)) {
      alert(`Aguarde a finalização das partidas. Necessário pelo menos 4 equipas classificadas por categoria.\n${catA.name}: ${rankA.length}, ${catB.name}: ${rankB.length}${catC ? `, ${catC.name}: ${rankC.length}` : ''}`);
      return;
    }

    let confirmMessage = '';
    let r1Matches: Array<{ round: string; team1: string; team2: string }> = [];

    if (catC) {
      // 3 categorias
      confirmMessage = `PLAYOFFS CRUZADOS ENTRE CATEGORIAS (EQUIPAS)\n` +
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
        `Continuar?`;

      r1Matches = [
        { round: 'crossed_r1_j1', team1: rankA[0].id, team2: rankC[3].id }, // (1°A + 4°C) vs (2°A + 3°C)
        { round: 'crossed_r1_j1', team1: rankA[1].id, team2: rankC[2].id },
        { round: 'crossed_r1_j2', team1: rankA[2].id, team2: rankB[1].id }, // (3°A + 2°B) vs (4°A + 1°B)
        { round: 'crossed_r1_j2', team1: rankA[3].id, team2: rankB[0].id },
        { round: 'crossed_r1_j3', team1: rankB[2].id, team2: rankC[1].id }, // (3°B + 2°C) vs (4°B + 1°C)
        { round: 'crossed_r1_j3', team1: rankB[3].id, team2: rankC[0].id },
      ];
    } else {
      // 2 categorias
      confirmMessage = `PLAYOFFS CRUZADOS ENTRE CATEGORIAS (EQUIPAS)\n` +
        `(${catA.name} = A, ${catB.name} = B)\n\n` +
        `RONDA 1 - Playoffs Cruzados:\n` +
        `  J1: (1°A + 4°B) vs (1°B + 4°A) → (${rankA[0].name} + ${rankB[3].name}) vs (${rankB[0].name} + ${rankA[3].name})\n` +
        `  J2: (2°A + 3°B) vs (2°B + 3°A) → (${rankA[1].name} + ${rankB[2].name}) vs (${rankB[1].name} + ${rankA[2].name})\n` +
        `  J3: (1°A + 2°B) vs (1°B + 2°A) → (${rankA[0].name} + ${rankB[1].name}) vs (${rankB[0].name} + ${rankA[1].name})\n\n` +
        `RONDA 2:\n` +
        `  J4: Vencedor J1 vs Vencedor J2\n` +
        `  J5: Vencedor J3 vs Melhor Perdedor (J1 ou J2, baseado em games)\n` +
        `  J6: Perdedor J3 vs Pior Perdedor → 5º/6º\n\n` +
        `RONDA 3 - Finais:\n` +
        `  J7: Final (Vencedor J4 vs Vencedor J5)\n` +
        `  J8: 3º/4º (Perdedor J4 vs Perdedor J5)\n\n` +
        `Continuar?`;

      r1Matches = [
        { round: 'crossed_r1_j1', team1: rankA[0].id, team2: rankB[3].id }, // (1°A + 4°B) vs (1°B + 4°A)
        { round: 'crossed_r1_j1', team1: rankB[0].id, team2: rankA[3].id },
        { round: 'crossed_r1_j2', team1: rankA[1].id, team2: rankB[2].id }, // (2°A + 3°B) vs (2°B + 3°A)
        { round: 'crossed_r1_j2', team1: rankB[1].id, team2: rankA[2].id },
        { round: 'crossed_r1_j3', team1: rankA[0].id, team2: rankB[1].id }, // (1°A + 2°B) vs (1°B + 2°A)
        { round: 'crossed_r1_j3', team1: rankB[0].id, team2: rankA[1].id },
      ];
    }

    const confirmed = confirm(confirmMessage);
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
      // Para equipas combinadas, precisamos criar equipas temporárias combinando jogadores de diferentes equipas
      // Função auxiliar para criar equipa combinada
      const createCombinedTeam = async (team1Id: string, team2Id: string, name: string): Promise<string> => {
        const team1 = teams.find(t => t.id === team1Id);
        const team2 = teams.find(t => t.id === team2Id);
        
        if (!team1 || !team2) throw new Error(`Equipas não encontradas: ${team1Id}, ${team2Id}`);
        
        // Buscar os jogadores das equipas
        const { data: team1Data } = await supabase
          .from('teams')
          .select('player1_id, player2_id')
          .eq('id', team1Id)
          .single();
        
        const { data: team2Data } = await supabase
          .from('teams')
          .select('player1_id, player2_id')
          .eq('id', team2Id)
          .single();
        
        if (!team1Data || !team2Data) throw new Error('Dados das equipas não encontrados');
        
        // Criar equipa combinada: player1 da equipa1 + player1 da equipa2
        const { data: newTeam, error } = await supabase
          .from('teams')
          .insert({
            tournament_id: tournament.id,
            name: name,
            player1_id: team1Data.player1_id,
            player2_id: team2Data.player1_id,
            category_id: null, // Equipa combinada não pertence a uma categoria específica
            group_name: null,
            status: 'active'
          })
          .select('id')
          .single();
        
        if (error || !newTeam) throw error || new Error('Erro ao criar equipa combinada');
        return newTeam.id;
      };

      // Criar matches da R1 com equipas combinadas
      const r1MatchesData = catC ? [
        // J1: (1°A + 4°C) vs (2°A + 3°C)
        {
          round: 'crossed_r1_j1',
          team1Name: `${rankA[0].name} + ${rankC[3].name}`,
          team2Name: `${rankA[1].name} + ${rankC[2].name}`,
          team1Pair: [rankA[0].id, rankC[3].id],
          team2Pair: [rankA[1].id, rankC[2].id]
        },
        // J2: (3°A + 2°B) vs (4°A + 1°B)
        {
          round: 'crossed_r1_j2',
          team1Name: `${rankA[2].name} + ${rankB[1].name}`,
          team2Name: `${rankA[3].name} + ${rankB[0].name}`,
          team1Pair: [rankA[2].id, rankB[1].id],
          team2Pair: [rankA[3].id, rankB[0].id]
        },
        // J3: (3°B + 2°C) vs (4°B + 1°C)
        {
          round: 'crossed_r1_j3',
          team1Name: `${rankB[2].name} + ${rankC[1].name}`,
          team2Name: `${rankB[3].name} + ${rankC[0].name}`,
          team1Pair: [rankB[2].id, rankC[1].id],
          team2Pair: [rankB[3].id, rankC[0].id]
        }
      ] : [
        // 2 categorias
        // J1: (1°A + 4°B) vs (1°B + 4°A)
        {
          round: 'crossed_r1_j1',
          team1Name: `${rankA[0].name} + ${rankB[3].name}`,
          team2Name: `${rankB[0].name} + ${rankA[3].name}`,
          team1Pair: [rankA[0].id, rankB[3].id],
          team2Pair: [rankB[0].id, rankA[3].id]
        },
        // J2: (2°A + 3°B) vs (2°B + 3°A)
        {
          round: 'crossed_r1_j2',
          team1Name: `${rankA[1].name} + ${rankB[2].name}`,
          team2Name: `${rankB[1].name} + ${rankA[2].name}`,
          team1Pair: [rankA[1].id, rankB[2].id],
          team2Pair: [rankB[1].id, rankA[2].id]
        },
        // J3: (1°A + 2°B) vs (1°B + 2°A)
        {
          round: 'crossed_r1_j3',
          team1Name: `${rankA[0].name} + ${rankB[1].name}`,
          team2Name: `${rankB[0].name} + ${rankA[1].name}`,
          team1Pair: [rankA[0].id, rankB[1].id],
          team2Pair: [rankB[0].id, rankA[1].id]
        }
      ];

      for (let i = 0; i < r1MatchesData.length; i++) {
        const m = r1MatchesData[i];
        
        // Criar equipas combinadas
        const combinedTeam1Id = await createCombinedTeam(m.team1Pair[0], m.team1Pair[1], m.team1Name);
        const combinedTeam2Id = await createCombinedTeam(m.team2Pair[0], m.team2Pair[1], m.team2Name);
        
        // Criar match
        const { error } = await supabase
          .from('matches')
          .insert({
            tournament_id: tournament.id,
            category_id: null,
            round: m.round,
            match_number: matchNumber++,
            team1_id: combinedTeam1Id,
            team2_id: combinedTeam2Id,
            scheduled_time: currentTime.toISOString(),
            court: courtName(i % (currentTournament.number_of_courts || 1)),
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

      // RONDA 2 - Meias-Finais (3 jogos) - equipas TBD por agora
      const r2Matches = [
        { round: 'crossed_r2_j4' }, // Vencedor J1 vs Vencedor J2
        { round: 'crossed_r2_j5' }, // Vencedor J3 vs Melhor Perdedor
        { round: 'crossed_r2_j6' }   // Perdedor J3 vs Pior Perdedor → 5º/6º
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
            team1_id: null,
            team2_id: null,
            scheduled_time: currentTime.toISOString(),
            court: courtName(i % (currentTournament.number_of_courts || 1)),
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
        { round: 'crossed_r3_j7' },     // Final
        { round: 'crossed_r3_j8' }      // 3º/4º lugar
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
            team1_id: null,
            team2_id: null,
            scheduled_time: currentTime.toISOString(),
            court: courtName(i % (currentTournament.number_of_courts || 1)),
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
      alert('Playoffs Cruzados (Equipas) gerados com sucesso!\n\n8 jogos criados:\n- R1: 3 jogos (Playoffs Cruzados)\n- R2: 3 jogos (Meias-finais + 5º/6º)\n- R3: 2 jogos (Final + 3º/4º)');
    } catch (error) {
      console.error('Error generating crossed playoffs teams between categories:', error);
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
    
    const sfMatches = currentMatches
      .filter(m => m.round === 'semifinal')
      .sort((a, b) => a.match_number - b.match_number);
    const finalMatch = currentMatches.find(m => m.round === 'final');
    // O jogo de 3º/4º lugar pode NÃO existir (deixou de ser gerado por defeito).
    // Se não existir, apenas avançamos a Final e ignoramos o 3º lugar.
    const thirdPlaceMatch = currentMatches.find(m => m.round === '3rd_place');
    
    if (sfMatches.length < 2 || !finalMatch) {
      return;
    }
    
    // Verificar se ambas as meias-finais estão completas
    if (sfMatches[0].status !== 'completed' || sfMatches[1].status !== 'completed') {
      return;
    }
    
    // Se a final já tem jogadores, não preencher novamente
    if (finalMatch.player1_individual_id) {
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
      
      // 3°/4° lugar: preencher apenas se o match existir (é opcional agora).
      if (thirdPlaceMatch) {
        await supabase.from('matches').update({
          player1_individual_id: sf1Result.loser.p1,
          player2_individual_id: sf1Result.loser.p2,
          player3_individual_id: sf2Result.loser.p1,
          player4_individual_id: sf2Result.loser.p2,
        }).eq('id', thirdPlaceMatch.id);
      } else {
      }
      await fetchTournamentData();
    } catch (err) {
      console.error('[AUTO_ADVANCE_SF] Error:', err);
    }
  };

  // Função para avançar automaticamente os playoffs cruzados
  const autoAdvanceCrossedPlayoffs = async (currentMatches: MatchWithTeams[]) => {
    const currentFormat = resolvedFormat || currentTournament?.format || tournament.format;
    const hasTeamBasedCrossedMatches = currentMatches.some(
      m => m.round?.startsWith('crossed_') && (!!m.team1_id || !!m.team2_id),
    );

    // crossed_playoffs_teams usa team1_id/team2_id (não player*_individual_id)
    // e rounds novos (crossed_r2_j1/j2 + crossed_r3_final/3rd_place).
    if (currentFormat === 'crossed_playoffs_teams' || hasTeamBasedCrossedMatches) {
      const extractIndex = (round?: string) => {
        const parsed = Number(round?.match(/j(\d+)/)?.[1] || 0);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const isCompleted = (m?: MatchWithTeams) => {
        if (!m) return false;
        if (m.status === 'completed') return true;
        const hasAnySet =
          (m.team1_score_set1 != null && m.team2_score_set1 != null) ||
          (m.team1_score_set2 != null && m.team2_score_set2 != null) ||
          (m.team1_score_set3 != null && m.team2_score_set3 != null);
        return hasAnySet;
      };
      const getWinnerLoserTeams = (m: MatchWithTeams) => {
        const t1Games = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
        const t2Games = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);
        const team1Won = t1Games > t2Games;
        return {
          winnerId: team1Won ? m.team1_id : m.team2_id,
          loserId: team1Won ? m.team2_id : m.team1_id,
        };
      };

      const r1Matches = currentMatches
        .filter(m => m.round?.startsWith('crossed_r1_j'))
        .sort((a, b) => extractIndex(a.round) - extractIndex(b.round));
      const r2Matches = currentMatches
        .filter(m => m.round?.startsWith('crossed_r2_j'))
        .sort((a, b) => extractIndex(a.round) - extractIndex(b.round));
      const finalMatch = currentMatches.find(m => m.round === 'crossed_r3_final' || m.round === 'crossed_r3_j7');
      const thirdMatch = currentMatches.find(m => m.round === 'crossed_r3_3rd_place' || m.round === 'crossed_r3_j8');
      const placementSemiA = currentMatches.find(m => m.round === 'crossed_r4_5th');
      const placementSemiB = currentMatches.find(m => m.round === 'crossed_r5_7th');
      const placementFinalA = currentMatches.find(m => m.round === 'crossed_r6_5th_final');
      const placementFinalB = currentMatches.find(m => m.round === 'crossed_r6_7th_final');

      try {
        // Caso "meias diretas": R1 já são as meias (2 jogos)
        if (r2Matches.length === 0 && r1Matches.length >= 2 && finalMatch && thirdMatch) {
          const sf1 = r1Matches[0];
          const sf2 = r1Matches[1];
          if (isCompleted(sf1) && isCompleted(sf2)) {
            const sf1Res = getWinnerLoserTeams(sf1);
            const sf2Res = getWinnerLoserTeams(sf2);

            if (!finalMatch.team1_id) {
              await supabase.from('matches').update({
                team1_id: sf1Res.winnerId,
                team2_id: sf2Res.winnerId,
              }).eq('id', finalMatch.id);
            }

            if (!thirdMatch.team1_id) {
              await supabase.from('matches').update({
                team1_id: sf1Res.loserId,
                team2_id: sf2Res.loserId,
              }).eq('id', thirdMatch.id);
            }
          }

          // Se existirem jogos de classificação intermédios (5º/6º e 7º/8º),
          // criar a ronda final de classificação: vencedores entre si e perdedores entre si.
          if (placementSemiA && placementSemiB && isCompleted(placementSemiA) && isCompleted(placementSemiB)) {
            const pA = getWinnerLoserTeams(placementSemiA);
            const pB = getWinnerLoserTeams(placementSemiB);

            if (placementFinalA && !placementFinalA.team1_id) {
              await supabase.from('matches').update({
                team1_id: pA.winnerId,
                team2_id: pB.winnerId,
              }).eq('id', placementFinalA.id);
            }
            if (placementFinalB && !placementFinalB.team1_id) {
              await supabase.from('matches').update({
                team1_id: pA.loserId,
                team2_id: pB.loserId,
              }).eq('id', placementFinalB.id);
            }
          }

          await fetchTournamentData();
          return;
        }

        // Caso com quartos + meias: preencher R2 a partir dos vencedores dos jogos R1
        if (r2Matches.length > 0 && r1Matches.length >= (r2Matches.length * 2)) {
          for (let i = 0; i < r2Matches.length; i++) {
            const targetR2 = r2Matches[i];
            if (targetR2.team1_id) continue;
            const left = r1Matches[i * 2];
            const right = r1Matches[i * 2 + 1];
            if (!isCompleted(left) || !isCompleted(right)) continue;
            const leftRes = getWinnerLoserTeams(left);
            const rightRes = getWinnerLoserTeams(right);
            await supabase.from('matches').update({
              team1_id: leftRes.winnerId,
              team2_id: rightRes.winnerId,
            }).eq('id', targetR2.id);
          }
        }

        // Final e 3º/4º a partir das meias (R2)
        if (finalMatch && thirdMatch && r2Matches.length >= 2) {
          const sf1 = r2Matches[0];
          const sf2 = r2Matches[1];
          if (isCompleted(sf1) && isCompleted(sf2)) {
            const sf1Res = getWinnerLoserTeams(sf1);
            const sf2Res = getWinnerLoserTeams(sf2);

            if (!finalMatch.team1_id) {
              await supabase.from('matches').update({
                team1_id: sf1Res.winnerId,
                team2_id: sf2Res.winnerId,
              }).eq('id', finalMatch.id);
            }

            if (!thirdMatch.team1_id) {
              await supabase.from('matches').update({
                team1_id: sf1Res.loserId,
                team2_id: sf2Res.loserId,
              }).eq('id', thirdMatch.id);
            }
          }
        }

        await fetchTournamentData();
        return;
      } catch (error) {
        console.error('[AUTO_ADVANCE] Error advancing crossed_playoffs_teams:', error);
        return;
      }
    }
  };




  // Função para gerar Playoffs Cruzados (3 grupos: A, B, C) - dentro de uma categoria
  const handleGenerateCrossedPlayoffs = async (categoryId: string) => {

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
              court: courtName(i % (currentTournament.number_of_courts || 1)),
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

  const handleResendTournamentAlert = async () => {
    if (notifySending) return;
    const isActive =
      currentTournament.status === 'active' || currentTournament.status === 'in_progress';
    if (!isActive) {
      alert('O torneio tem de estar Ativo para enviar alertas. Altere o estado em Editar.');
      return;
    }
    if ((currentTournament as any).visibility === 'invite_only') {
      alert('Torneios por convite não enviam alertas públicas.');
      return;
    }
    if ((currentTournament as any).allow_public_registration === false) {
      alert('Active a inscrição pública antes de enviar a alerta.');
      return;
    }
    const ok = confirm(
      'Reenviar alerta push aos jogadores com nível compatível com as categorias deste torneio?\n\nUse isto quando mudar data, categorias ou quiser lembrar as vagas.',
    );
    if (!ok) return;

    setNotifySending(true);
    try {
      const result = await notifyTournamentPlayers({
        tournamentId: currentTournament.id,
        forceResend: true,
      });
      if (!result.ok) {
        alert(result.error || result.message || 'Não foi possível enviar a alerta.');
        return;
      }
      const skipped = result.details?.[0]?.skipped;
      if (skipped === 'no_targets' || skipped === 'no_targets_after_filter') {
        alert('Nenhum jogador elegível encontrado (nível/género/clube).');
        return;
      }
      alert(`Alerta enviada. Push entregues: ${result.notified ?? 0}`);
    } catch (err) {
      console.error('[Push] resend error:', err);
      alert('Erro ao enviar a alerta. Tente novamente.');
    } finally {
      setNotifySending(false);
    }
  };

  const handleConfirmPartnerTeamReview = async (teamId: string) => {
    setReviewSavingId(teamId);
    const { data, error } = await supabase
      .from('teams')
      .update({ organizer_review_status: 'confirmed' })
      .eq('id', teamId)
      .eq('tournament_id', currentTournament.id)
      .eq('registration_source', 'partner_invite')
      .select('id')
      .maybeSingle();
    setReviewSavingId(null);

    if (error || !data) {
      alert(`Não foi possível verificar a equipa: ${error?.message || 'sem permissão'}`);
      return;
    }
    setTeams(prev => prev.map(team =>
      team.id === teamId ? { ...team, organizer_review_status: 'confirmed' } : team
    ));
  };

  const PartnerTeamReviewBadges = ({ team }: { team: TeamWithPlayers }) => {
    if (team.registration_source !== 'partner_invite') return null;
    const verified = team.organizer_review_status === 'confirmed';
    return (
      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
        <span className="px-2 py-0.5 text-xs bg-cyan-100 text-cyan-800 rounded-full font-medium">
          Automática via parceiro
        </span>
        <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
          verified ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
        }`}>
          {verified ? 'Verificada' : 'Por verificar'}
        </span>
        {!verified && (
          <button
            type="button"
            disabled={reviewSavingId === team.id}
            onClick={() => void handleConfirmPartnerTeamReview(team.id)}
            className="px-2 py-0.5 text-xs border border-green-300 text-green-700 rounded-full hover:bg-green-50 disabled:opacity-50"
          >
            {reviewSavingId === team.id ? 'A verificar…' : 'Marcar verificada'}
          </button>
        )}
      </div>
    );
  };

  const handleDeleteTeam = async (teamId: string) => {
    if (!confirm(t.tournament.confirmDeleteTeam)) return;
    
    try {
      await deleteTeamAndPlayers(teamId);
      await fetchTournamentData();
    } catch (error) {
      console.error('Error deleting team:', error);
      alert('Erro ao eliminar equipa');
    }
  };

  const handleDeletePlayer = async (playerId: string) => {
    if (!confirm(t.tournament.confirmDeletePlayer || 'Tem certeza que deseja eliminar este jogador? As equipas e jogos associados também serão eliminados.')) return;
    
    if (!currentTournament) {
      alert('Torneio não encontrado');
      return;
    }

    try {

      // 1) Verificar se o jogador existe e pertence a este torneio
      const { data: playerCheck, error: playerCheckError } = await supabase
        .from('players')
        .select('id, name, tournament_id')
        .eq('id', playerId)
        .eq('tournament_id', currentTournament.id)
        .maybeSingle();

      if (playerCheckError) {
        console.error('[DELETE-PLAYER] Erro ao verificar jogador:', playerCheckError);
        throw playerCheckError;
      }

      if (!playerCheck) {
        alert('Jogador não encontrado neste torneio.');
        await fetchTournamentData();
        return;
      }


      // 2) Encontrar e remover matches individuais que referenciam este jogador
      const [match1, match2, match3, match4] = await Promise.all([
        supabase.from('matches').select('id').eq('tournament_id', currentTournament.id).eq('player1_individual_id', playerId),
        supabase.from('matches').select('id').eq('tournament_id', currentTournament.id).eq('player2_individual_id', playerId),
        supabase.from('matches').select('id').eq('tournament_id', currentTournament.id).eq('player3_individual_id', playerId),
        supabase.from('matches').select('id').eq('tournament_id', currentTournament.id).eq('player4_individual_id', playerId),
      ]);

      const individualMatchIds = [
        ...(match1.data || []).map(m => m.id),
        ...(match2.data || []).map(m => m.id),
        ...(match3.data || []).map(m => m.id),
        ...(match4.data || []).map(m => m.id),
      ];
      const uniqueIndividualMatchIds = [...new Set(individualMatchIds)];

      if (uniqueIndividualMatchIds.length > 0) {
        for (const matchId of uniqueIndividualMatchIds) {
          await supabase.from('matches').delete().eq('id', matchId);
        }
      }

      // 3) Encontrar equipas que referenciam este jogador
      const [teamsAsP1, teamsAsP2] = await Promise.all([
        supabase.from('teams').select('id, name').eq('tournament_id', currentTournament.id).eq('player1_id', playerId),
        supabase.from('teams').select('id, name').eq('tournament_id', currentTournament.id).eq('player2_id', playerId),
      ]);

      const teamsWithPlayer = [
        ...(teamsAsP1.data || []),
        ...(teamsAsP2.data || [])
      ];

      if (teamsWithPlayer.length > 0) {
        const teamIds = teamsWithPlayer.map(t => t.id);

        // 3a) Remover matches que referenciam essas equipas (matches.team1_id/team2_id tem ON DELETE CASCADE,
        //     mas removemos explicitamente para garantir)
        const [mTeam1, mTeam2] = await Promise.all([
          supabase.from('matches').select('id').eq('tournament_id', currentTournament.id).in('team1_id', teamIds),
          supabase.from('matches').select('id').eq('tournament_id', currentTournament.id).in('team2_id', teamIds),
        ]);

        const teamMatchIds = [...new Set([
          ...(mTeam1.data || []).map(m => m.id),
          ...(mTeam2.data || []).map(m => m.id),
        ])];

        if (teamMatchIds.length > 0) {
          for (const matchId of teamMatchIds) {
            await supabase.from('matches').delete().eq('id', matchId);
          }
        }

        // 3b) Remover as equipas
        for (const team of teamsWithPlayer) {
          const { error: teamErr } = await supabase.from('teams').delete().eq('id', team.id);
          if (teamErr) {
            console.error(`[DELETE-PLAYER] Erro ao remover equipa ${team.id}:`, teamErr);
          } else {
          }
        }
      }

      // 4) Remover o jogador (com a migração CASCADE, equipas/matches restantes serão eliminados automaticamente)

      const { error } = await supabase
        .from('players')
        .delete()
        .eq('id', playerId)
        .eq('tournament_id', currentTournament.id);

      if (error) {
        console.error('[DELETE-PLAYER] ❌ Erro ao remover jogador:', JSON.stringify(error, null, 2));
        
        let errorMessage = 'Erro ao eliminar jogador';
        if (error.code === '23503' || error.message?.includes('foreign key') || error.message?.includes('constraint')) {
          errorMessage = 'Não é possível eliminar este jogador porque ainda está referenciado noutras tabelas. Por favor, elimine todas as referências primeiro.';
        } else if (error.code === '42501' || error.message?.includes('permission') || error.message?.includes('policy')) {
          errorMessage = 'Não tem permissão para eliminar este jogador.';
        } else if (error.message) {
          errorMessage = `Erro: ${error.message}`;
        }
        
        alert(errorMessage);
        throw error;
      }

      await fetchTournamentData();
    } catch (error: unknown) {
      console.error('Error deleting player:', error);
    }
  };

  const handleGenerateSwissRound = async () => {
    if (!currentTournament || currentTournament.format !== 'swiss_teams') return;

    const tournamentMaxRounds = clampSwissRounds((currentTournament as any).swiss_rounds);
    const numberOfCourts = currentTournament.number_of_courts || 2;
    const courtNames: string[] = (currentTournament as any).court_names || [];
    const matchDuration = currentTournament.match_duration_minutes || 30;
    const startDate = currentTournament.start_date || new Date().toISOString().split('T')[0];
    const startTime = currentTournament.daily_start_time || currentTournament.start_time || '09:00';

    setLoading(true);
    try {
      const { data: existingMatches, error: matchesError } = await supabase
        .from('matches')
        .select('id, round, team1_id, team2_id, status, winner_id, match_number, scheduled_time, category_id, team1_score_set1, team2_score_set1, team1_score_set2, team2_score_set2, team1_score_set3, team2_score_set3')
        .eq('tournament_id', currentTournament.id);
      if (matchesError) throw matchesError;

      const allMatches = existingMatches || [];

      const categoryBuckets: Array<{
        categoryId: string | null;
        teamList: typeof teams;
        maxRounds: number;
      }> =
        categories.length > 0 && teams.some(t => t.category_id)
          ? categories.map(c => ({
              categoryId: c.id,
              teamList: teams.filter(t => t.category_id === c.id),
              maxRounds: clampSwissRounds((c as any).swiss_rounds ?? tournamentMaxRounds),
            })).filter(b => b.teamList.length >= 2)
          : [{
              categoryId: categories.length === 1 ? categories[0].id : null,
              teamList: teams,
              maxRounds: clampSwissRounds(
                (categories[0] as any)?.swiss_rounds ?? tournamentMaxRounds
              ),
            }];

      if (categoryBuckets.length === 0 || categoryBuckets.every(b => b.teamList.length < 2)) {
        alert('É necessário pelo menos 2 equipas para gerar uma ronda suíça.');
        return;
      }

      // Schedule time: after previous swiss round wall-clock (+ match duration), else tournament start.
      // Use digit arithmetic (not Date#getHours) to avoid UTC↔local drift of ~1h per round.
      const addMinutesPreservingWallClock = (scheduled: string, minutes: number): string => {
        const m = scheduled.trim().match(
          /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/
        );
        if (!m) {
          const d = new Date(scheduled);
          return new Date(d.getTime() + minutes * 60000).toISOString();
        }
        const next = new Date(
          Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) + minutes * 60000
        );
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}T${pad(next.getUTCHours())}:${pad(next.getUTCMinutes())}:${pad(next.getUTCSeconds())}`;
      };

      let scheduledTime = `${startDate}T${startTime.length === 5 ? `${startTime}:00` : startTime}`;
      const swissTimed = allMatches.filter(m => m.scheduled_time && isSwissRound(m.round));
      if (swissTimed.length > 0) {
        // Prefer the start of the latest swiss round (all games of a round share one slot)
        const byRound = new Map<number, string[]>();
        for (const m of swissTimed) {
          const n = parseSwissRoundNumber(m.round);
          if (n == null || !m.scheduled_time) continue;
          if (!byRound.has(n)) byRound.set(n, []);
          byRound.get(n)!.push(m.scheduled_time);
        }
        const latestRound = Math.max(...byRound.keys());
        const roundTimes = byRound.get(latestRound) || [];
        // Lexicographic max works for ISO-like timestamps with same format
        const latestWall = roundTimes.reduce((a, b) => (a > b ? a : b));
        scheduledTime = addMinutesPreservingWallClock(latestWall, matchDuration);
      }

      const maxMatchNumber = allMatches.reduce((max, m) => Math.max(max, m.match_number || 0), 0);
      let matchNumberOffset = maxMatchNumber;
      const rowsToInsert: any[] = [];
      const generatedRounds: number[] = [];
      const blockers: string[] = [];

      for (const bucket of categoryBuckets) {
        const catMatches = bucket.categoryId
          ? allMatches.filter(m => m.category_id === bucket.categoryId)
          : allMatches;
        const highest = getHighestSwissRound(catMatches);
        const nextRound = highest + 1;

        if (nextRound > bucket.maxRounds) {
          blockers.push('max');
          continue;
        }
        if (highest > 0 && !isSwissRoundComplete(catMatches, highest)) {
          blockers.push('incomplete');
          continue;
        }

        const swissTeams = bucket.teamList.map(t => ({
          id: t.id,
          name: t.name,
          seed: (t as any).seed ?? null,
          category_id: bucket.categoryId,
        }));

        let pairings;
        if (nextRound === 1) {
          const ordered = orderTeamsForRound1(swissTeams, `${currentTournament.id}:${bucket.categoryId || 'all'}`);
          pairings = pairRound1(ordered);
        } else {
          const standings = computeSwissStandings(swissTeams, catMatches);
          const opponents = buildOpponentMap(catMatches);
          pairings = pairSwissRound(standings, opponents);
        }

        const built = buildSwissRoundMatches({
          pairings,
          roundNumber: nextRound,
          matchNumberOffset,
          numberOfCourts,
          courtNames,
          scheduledTime,
        });
        matchNumberOffset += built.length;
        generatedRounds.push(nextRound);

        for (const m of built) {
          const isBye = !m.team2_id;
          rowsToInsert.push({
            tournament_id: currentTournament.id,
            category_id: bucket.categoryId,
            round: m.round,
            match_number: m.match_number,
            team1_id: m.team1_id,
            team2_id: m.team2_id,
            scheduled_time: m.scheduled_time,
            court: m.court,
            status: isBye ? 'completed' : 'scheduled',
            winner_id: isBye ? m.team1_id : null,
          });
        }
      }

      if (rowsToInsert.length === 0) {
        if (blockers.includes('incomplete')) {
          alert(t.tournament.swissRoundCompleteHint);
        } else if (blockers.includes('max')) {
          alert(t.tournament.swissMaxRoundsReached);
        } else {
          alert('Não foi possível gerar confrontos para esta ronda.');
        }
        return;
      }

      const { data: inserted, error: insertError } = await supabase
        .from('matches')
        .insert(rowsToInsert)
        .select('id, scheduled_time, court');
      if (insertError) throw insertError;

      if (inserted && inserted.length > 0) {
        await createCourtBookingsForMatches(
          inserted.filter((m: any) => m.court && m.court !== 'BYE' && m.scheduled_time),
          currentTournament
        );
      }

      await fetchTournamentData(true);
      const roundLabel = [...new Set(generatedRounds)].join(', ');
      alert(`Ronda ${roundLabel} gerada (${rowsToInsert.filter(r => r.team2_id).length} jogos).`);
    } catch (error: any) {
      console.error('[SWISS] Error generating round:', error);
      alert(error?.message || 'Erro ao gerar ronda suíça');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateSchedule = async () => {
    if (!confirm(t.tournament.confirmGenerateSchedule)) return;
    
    setLoading(true);
    try {
      // Carregar jogos existentes para preservar os completed
      const { data: existingMatchesRaw } = await supabase
        .from('matches')
        .select('id, team1_id, team2_id, round, status, category_id, scheduled_time, court, match_number, player1_individual_id, player2_individual_id, player3_individual_id, player4_individual_id')
        .eq('tournament_id', currentTournament.id);

      const completedMatches = (existingMatchesRaw || []).filter(m => m.status === 'completed');
      const nonCompletedIds = (existingMatchesRaw || []).filter(m => m.status !== 'completed').map(m => m.id);

      // Apagar apenas jogos nao terminados
      if (nonCompletedIds.length > 0) {
        const batchSize = 100;
        for (let i = 0; i < nonCompletedIds.length; i += batchSize) {
          const batch = nonCompletedIds.slice(i, i + batchSize);
          await supabase.from('matches').delete().in('id', batch);
        }
      }

      // Set de pares ja jogados (completed) para nao duplicar
      const completedPairs = new Set(
        completedMatches
          .filter(m => m.team1_id && m.team2_id)
          .map(m => [m.team1_id, m.team2_id].sort().join('|'))
      );
      const maxCompletedMatchNumber = completedMatches.length > 0
        ? Math.max(...completedMatches.map(m => m.match_number || 0))
        : 0;


      const numberOfCourts = currentTournament.number_of_courts || 2;
      const startDate = currentTournament.start_date || new Date().toISOString().split('T')[0];
      const startTime = currentTournament.daily_start_time || '09:00';
      const endTime = currentTournament.daily_end_time || '21:00';
      const matchDuration = currentTournament.match_duration_minutes || 30;
      const dailySchedules = currentTournament.daily_schedules || [];
      
      // Tournament format is the single source of truth
      const schedFormat = currentTournament.format;
      const schedRoundRobinType = currentTournament.round_robin_type;

      
      // Identify outdoor courts from club_courts data
      const outdoorCourtIndices = new Set<number>();
      const courtNames: string[] = (currentTournament as any).court_names || [];
      if (currentTournament.club_id && courtNames.length > 0) {
        const { data: clubData } = await supabase.from('clubs').select('owner_id').eq('id', currentTournament.club_id).single();
        if (clubData) {
          const { data: courtData } = await supabase.from('club_courts').select('name, type').eq('user_id', clubData.owner_id).eq('is_active', true);
          if (courtData) {
            const courtTypeMap = new Map<string, string>();
            courtData.forEach(c => courtTypeMap.set(c.name, c.type || 'indoor'));
            courtNames.forEach((name, idx) => {
              const type = courtTypeMap.get(name) || 'unknown';
              if (type === 'outdoor') {
                outdoorCourtIndices.add(idx + 1);
              }
            });
          }
        }
      }
      
      // Helper: convert 0-based court index to court name
      const courtName = (idx: number) => courtNames[idx] || (idx + 1).toString();
      
      let matchesToInsert: any[] = [];
      
      // Helper to convert "TBD" to null for UUID fields
      const toUuidOrNull = (id: string | undefined | null): string | null => {
        if (!id || id === 'TBD' || id === 'tbd') return null;
        return id;
      };

      // Calculate effective start time after completed matches
      let effectiveStartDate = startDate;
      let effectiveStartTime = startTime;
      const completedWithTimes = completedMatches.filter((m: any) => m.scheduled_time);
      if (completedWithTimes.length > 0) {
        const latestCompletedMs = Math.max(...completedWithTimes.map((m: any) => new Date(m.scheduled_time).getTime()));
        const nextSlot = new Date(latestCompletedMs + matchDuration * 60000);
        effectiveStartDate = `${nextSlot.getFullYear()}-${String(nextSlot.getMonth() + 1).padStart(2, '0')}-${String(nextSlot.getDate()).padStart(2, '0')}`;
        effectiveStartTime = `${String(nextSlot.getHours()).padStart(2, '0')}:${String(nextSlot.getMinutes()).padStart(2, '0')}`;
      }
      
      if (schedFormat === 'round_robin' && schedRoundRobinType === 'individual') {
        // Individual Round Robin (Americano SEM grupos) - todos jogam contra todos com parceiros rotativos
        
        const playersForSchedule = individualPlayers.map(p => ({
          id: p.id,
          name: p.name || 'Player'
        }));
        
        const matchesPerPlayer = playersForSchedule.length - 1;

        // Build completed matches for this category to seed the scheduler
        const completedForAmericano = completedMatches
          .filter((m: any) => m.player1_individual_id && (!categories.length || !m.category_id || categories.some(c => c.id === m.category_id)))
          .map((m: any) => ({
            player1_id: m.player1_individual_id,
            player2_id: m.player2_individual_id,
            player3_id: m.player3_individual_id,
            player4_id: m.player4_individual_id,
          }));

        const americanMatches = generateAmericanSchedule(
          playersForSchedule,
          numberOfCourts,
          effectiveStartDate,
          effectiveStartTime,
          endTime,
          matchDuration,
          matchesPerPlayer,
          outdoorCourtIndices,
          completedForAmericano
        );
        
        matchesToInsert = americanMatches.map(m => {
          const cNum = parseInt(m.court);
          const cLabel = (!isNaN(cNum) && courtNames[cNum - 1]) ? courtNames[cNum - 1] : m.court;
          return {
            tournament_id: currentTournament.id,
            category_id: categories.length === 1 ? categories[0].id : null,
            round: m.round,
            match_number: m.match_number,
            player1_individual_id: toUuidOrNull(m.player1_id),
            player2_individual_id: toUuidOrNull(m.player2_id),
            player3_individual_id: toUuidOrNull(m.player3_id),
            player4_individual_id: toUuidOrNull(m.player4_id),
            scheduled_time: m.scheduled_time,
            court: cLabel,
            status: 'scheduled'
          };
        });
        
      } else if (schedFormat === 'mixed_american') {
        // ================================================================
        // AMERICANO MISTO 1H+1M vs 1H+1M
        // Todos os jogadores juntos, cada jogo tem 1 Homem + 1 Mulher por equipa
        // Usa gender de player_accounts para separar jogadores
        // ================================================================

        // Fetch gender from player_accounts for all enrolled players
        const phones = individualPlayers
          .map(p => (p.phone_number || '').replace(/[\s\-\(\)\.]/g, ''))
          .filter(Boolean);
        const { data: accountsData } = await supabase
          .from('player_accounts')
          .select('phone_number, gender')
          .in('phone_number', phones);

        const genderByPhone = new Map<string, string>();
        (accountsData || []).forEach(a => {
          if (a.phone_number && a.gender) {
            genderByPhone.set(a.phone_number.replace(/[\s\-\(\)\.]/g, ''), a.gender);
          }
        });

        const menPlayers: MixedPlayer[] = [];
        const womenPlayers: MixedPlayer[] = [];

        for (const p of individualPlayers) {
          const phone = (p.phone_number || '').replace(/[\s\-\(\)\.]/g, '');
          const gender = genderByPhone.get(phone);
          if (gender === 'female') {
            womenPlayers.push({ id: p.id, name: p.name, gender: 'F' });
          } else {
            menPlayers.push({ id: p.id, name: p.name, gender: 'M' });
          }
        }


        if (menPlayers.length < 2 || womenPlayers.length < 2) {
          alert(`O torneio Americano Misto precisa de pelo menos 2 homens e 2 mulheres. Tem ${menPlayers.length} homens e ${womenPlayers.length} mulheres.`);
          setLoading(false);
          return;
        }

        const matchesPerPlayer = categories.length > 0
          ? ((categories[0] as any).rounds || 7)
          : 7;

        // Build completed matches for mixed american
        const completedForMixed = completedMatches
          .filter((m: any) => m.player1_individual_id && m.round?.startsWith('round_'))
          .map((m: any) => ({
            player1_id: m.player1_individual_id,
            player2_id: m.player2_individual_id,
            player3_id: m.player3_individual_id,
            player4_id: m.player4_individual_id,
          }));

        const mixedMatches = generateMixedAmericanSchedule(
          menPlayers,
          womenPlayers,
          matchesPerPlayer,
          numberOfCourts,
          effectiveStartDate,
          effectiveStartTime,
          endTime,
          matchDuration,
          completedForMixed
        );

        matchesToInsert = mixedMatches.map(m => {
          const cNum = parseInt(m.court);
          const cLabel = (!isNaN(cNum) && courtNames[cNum - 1]) ? courtNames[cNum - 1] : m.court;
          return {
            tournament_id: currentTournament.id,
            category_id: categories.length === 1 ? categories[0].id : null,
            round: m.round,
            match_number: m.match_number,
            player1_individual_id: m.player1_id,
            player2_individual_id: m.player2_id,
            player3_individual_id: m.player3_id,
            player4_individual_id: m.player4_id,
            scheduled_time: m.scheduled_time,
            court: cLabel,
            status: 'scheduled'
          };
        });

        // Add knockout matches (empty, filled when group stage finishes)
        const lastTime = mixedMatches.length > 0
          ? new Date(mixedMatches[mixedMatches.length - 1].scheduled_time)
          : new Date(`${startDate}T${startTime}:00`);
        let knockoutTime = new Date(lastTime.getTime() + matchDuration * 60000);
        const endOfDay = new Date(`${startDate}T${endTime}:00`);
        if (knockoutTime >= endOfDay) {
          knockoutTime.setDate(knockoutTime.getDate() + 1);
          knockoutTime.setHours(parseInt(startTime.split(':')[0]), parseInt(startTime.split(':')[1] || '0'), 0, 0);
        }

        let koMatchNum = matchesToInsert.length + 1;

        // SF1 + SF2 (simultaneous, mixed pairs: 1H+1M vs 1H+1M)
        matchesToInsert.push({
          tournament_id: currentTournament.id, category_id: null,
          round: 'semifinal', match_number: koMatchNum++,
          player1_individual_id: null, player2_individual_id: null,
          player3_individual_id: null, player4_individual_id: null,
          scheduled_time: knockoutTime.toISOString(), court: courtName(0), status: 'scheduled'
        });
        matchesToInsert.push({
          tournament_id: currentTournament.id, category_id: null,
          round: 'semifinal', match_number: koMatchNum++,
          player1_individual_id: null, player2_individual_id: null,
          player3_individual_id: null, player4_individual_id: null,
          scheduled_time: knockoutTime.toISOString(), court: courtName(1), status: 'scheduled'
        });

        // Final
        knockoutTime = new Date(knockoutTime.getTime() + matchDuration * 60000);
        if (knockoutTime >= endOfDay) {
          knockoutTime.setDate(knockoutTime.getDate() + 1);
          knockoutTime.setHours(parseInt(startTime.split(':')[0]), parseInt(startTime.split(':')[1] || '0'), 0, 0);
        }
        matchesToInsert.push({
          tournament_id: currentTournament.id, category_id: null,
          round: 'final', match_number: koMatchNum++,
          player1_individual_id: null, player2_individual_id: null,
          player3_individual_id: null, player4_individual_id: null,
          scheduled_time: knockoutTime.toISOString(), court: courtName(0), status: 'scheduled'
        });


      } else if (schedFormat === 'individual_groups_knockout') {
        // Americano COM grupos + eliminatórias
        
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
          

          // Build list of completed individual matches for this category to pass to scheduler
          const catId = categories.length > 0 ? categories[0].id : null;
          const completedIndividualForScheduler = completedMatches
            .filter((m: any) => m.player1_individual_id && (!catId || m.category_id === catId))
            .map((m: any) => ({
              player1_id: m.player1_individual_id,
              player2_id: m.player2_individual_id,
              player3_id: m.player3_individual_id,
              player4_id: m.player4_individual_id,
            }));

          const individualMatches = generateIndividualGroupsKnockoutSchedule(
            individualPlayers,
            numberOfGroups,
            numberOfCourts,
            effectiveStartDate,
            effectiveStartTime,
            endTime,
            matchDuration,
            qualifiedPerGroup,
            categoryKnockoutStage as 'semifinals' | 'quarterfinals' | 'round_of_16' | 'final',
            completedIndividualForScheduler
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
            }
          }

          const playerCategoryMap = new Map<string, string>();
          individualPlayers.forEach(p => { if (p.category_id) playerCategoryMap.set(p.id, p.category_id); });

          matchesToInsert = groupOnlyMatches.map(m => {
            const cNum = parseInt(m.court);
            const cLabel = (!isNaN(cNum) && courtNames[cNum - 1]) ? courtNames[cNum - 1] : m.court;
            const matchCategoryId = categories.length === 1
              ? categories[0].id
              : (m.player1_id ? playerCategoryMap.get(m.player1_id) : null) || null;
            return {
              tournament_id: currentTournament.id,
              category_id: matchCategoryId,
              round: m.round,
              match_number: m.match_number,
              player1_individual_id: toUuidOrNull(m.player1_id),
              player2_individual_id: toUuidOrNull(m.player2_id),
              player3_individual_id: toUuidOrNull(m.player3_id),
              player4_individual_id: toUuidOrNull(m.player4_id),
              scheduled_time: m.scheduled_time,
              court: cLabel,
              status: 'scheduled'
            };
          });

          const lastTime = groupOnlyMatches.length > 0
            ? new Date(groupOnlyMatches[groupOnlyMatches.length - 1].scheduled_time)
            : new Date(`${startDate}T${startTime}:00`);

          let koTime = new Date(lastTime.getTime() + matchDuration * 60000);
          const [endH, endM] = endTime.split(':').map(Number);
          const [stH, stM] = startTime.split(':').map(Number);
          const getKoEndOfDay = (ref: Date) => {
            const eod = new Date(ref);
            eod.setHours(endH, endM || 0, 0, 0);
            return eod;
          };
          let koEndOfDay = getKoEndOfDay(koTime);

          const advanceKoTime = () => {
            koTime = new Date(koTime.getTime() + matchDuration * 60000);
            if (koTime >= koEndOfDay) {
              const nextDay = new Date(koTime);
              nextDay.setDate(nextDay.getDate() + 1);
              nextDay.setHours(stH, stM || 0, 0, 0);
              koTime = nextDay;
              koEndOfDay = getKoEndOfDay(koTime);
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
          

          // Calculate knockout structure dynamically
          // Each match has 4 players (2v2), so we need totalQualifiedPlayers / 4 matches in first round
          const numFirstRoundMatches = Math.ceil(totalQualifiedPlayers / 4);
          

          if (categoryKnockoutStage === 'round_of_16') {
            // 16 jogadores → 4 oitavos → 2 meias → 3° + final (sem quartos)
            const numRo16 = numFirstRoundMatches;
            
            for (let i = 0; i < numRo16; i++) {
              addKoMatch('round_of_16', courtName(i % numberOfCourts));
            }
            advanceKoTime();

            const numSemis = Math.max(2, Math.ceil(numRo16 / 2));
            
            for (let i = 0; i < numSemis; i++) {
              addKoMatch('semifinal', courtName(i % numberOfCourts));
            }
            advanceKoTime();
          } else if (categoryKnockoutStage === 'quarterfinals') {
            // Quarterfinals → Semifinals → 3rd place + Final
            const numQuarters = numFirstRoundMatches;
            
            for (let i = 0; i < numQuarters; i++) {
              addKoMatch('quarterfinal', courtName(i % numberOfCourts));
            }
            advanceKoTime();

            const numSemis = Math.max(1, Math.ceil(numQuarters / 2));
            
            for (let i = 0; i < numSemis; i++) {
              addKoMatch('semifinal', courtName(i % numberOfCourts));
            }
            advanceKoTime();
            // Sem consolação no americano individual: 4 QFs = 4 pares perdedores ≠ 1 jogo
          } else if (categoryKnockoutStage === 'semifinals') {
            // Direct to semifinals (no quarters)
            const numSemis = numFirstRoundMatches;
            
            for (let i = 0; i < numSemis; i++) {
              addKoMatch('semifinal', courtName(i % numberOfCourts));
            }
            advanceKoTime();
          } else if (categoryKnockoutStage === 'final') {
            // Direct to final (no quarters, no semis)
          }

          const hasThirdPlace = categories.length > 0 ? ((categories[0] as any).has_third_place_match ?? true) : true;

          addKoMatch('final', courtName(0));

          if (hasThirdPlace && categoryKnockoutStage !== 'final') {
            addKoMatch('3rd_place', courtName(1 % numberOfCourts));
          }

        
      } else if (schedFormat === 'round_robin' && schedRoundRobinType === 'teams') {
        // Equipas Round Robin - por categoria se existirem categorias
        
        // Verificar se há categorias com equipas
        const teamsWithCategory = teams.filter(t => t.category_id);
        const hasCategories = categories.length > 0 && teamsWithCategory.length > 0;
        
        if (hasCategories) {
          // Round Robin POR CATEGORIA - usando método do círculo para rondas perfeitas
          let globalMatchNumber = 1;
          
          const [startHour, startMinute] = startTime.split(':').map(Number);
          const [endHour, endMinute] = endTime.split(':').map(Number);
          const startTotalMinutes = startHour * 60 + startMinute;
          const endTotalMinutes = endHour * 60 + (endMinute || 0);
          let availableMinutesPerDay = endTotalMinutes - startTotalMinutes;
          if (availableMinutesPerDay <= 0) {
            availableMinutesPerDay = (24 * 60 - startTotalMinutes) + endTotalMinutes;
          }
          const slotsPerDay = Math.floor(availableMinutesPerDay / matchDuration);
          
          type CatMatch = { team1_id: string; team2_id: string; category_id: string; category_name: string };
          const allCategoryRounds: CatMatch[][][] = [];
          
          for (const category of categories) {
            const categoryTeams = teams.filter(t => t.category_id === category.id);
            
            if (categoryTeams.length < 2) {
              console.warn(`[SCHEDULE] Category "${category.name}" has fewer than 2 teams, skipping`);
              continue;
            }
            
            const n = categoryTeams.length;
            const isOdd = n % 2 !== 0;
            const rotation: Array<{ id: string }> = categoryTeams.map(t => ({ id: t.id }));
            if (isOdd) rotation.push({ id: 'BYE' });
            const total = rotation.length;
            const numRounds = total - 1;
            const matchesPerRound = total / 2;
            
            const catRounds: CatMatch[][] = [];
            for (let r = 0; r < numRounds; r++) {
              const roundMatches: CatMatch[] = [];
              for (let i = 0; i < matchesPerRound; i++) {
                const t1 = rotation[i];
                const t2 = rotation[total - 1 - i];
                if (t1.id !== 'BYE' && t2.id !== 'BYE') {
                  roundMatches.push({
                    team1_id: t1.id,
                    team2_id: t2.id,
                    category_id: category.id,
                    category_name: category.name
                  });
                }
              }
              catRounds.push(roundMatches);
              
              if (r < numRounds - 1) {
                const fixed = rotation[0];
                const rest = rotation.slice(1);
                rest.unshift(rest.pop()!);
                rotation.splice(0, rotation.length, fixed, ...rest);
              }
            }
            allCategoryRounds.push(catRounds);
          }
          
          // Merge rounds from different categories into same time slots
          const maxRounds = Math.max(...allCategoryRounds.map(cr => cr.length), 0);
          let totalMatchCount = 0;
          let timeSlotIndex = 0;
          
          // Track per-team outdoor game count + per-court usage
          const teamOutdoorCount = new Map<string, number>();
          const getOutdoor = (tid: string) => teamOutdoorCount.get(tid) || 0;
          const addOutdoor = (tid: string) => teamOutdoorCount.set(tid, (teamOutdoorCount.get(tid) || 0) + 1);
          
          const teamCourtUsage = new Map<string, number[]>();
          const getUsage = (tid: string, c: number) => {
            const u = teamCourtUsage.get(tid);
            return u ? (u[c - 1] || 0) : 0;
          };
          const addUsage = (tid: string, c: number) => {
            if (!teamCourtUsage.has(tid)) teamCourtUsage.set(tid, new Array(numberOfCourts).fill(0));
            teamCourtUsage.get(tid)![c - 1]++;
          };
          
          const hasOutdoorCourts = outdoorCourtIndices.size > 0;
          
          for (let r = 0; r < maxRounds; r++) {
            const mergedRound: CatMatch[] = [];
            for (const catRounds of allCategoryRounds) {
              if (r < catRounds.length) {
                mergedRound.push(...catRounds[r]);
              }
            }
            if (mergedRound.length === 0) continue;
            totalMatchCount += mergedRound.length;
            
            for (let matchIdx = 0; matchIdx < mergedRound.length; matchIdx += numberOfCourts) {
              const slotMatches = mergedRound.slice(matchIdx, matchIdx + numberOfCourts);
              
              const totalMinutesFromStart = (timeSlotIndex % slotsPerDay) * matchDuration;
              const hourOffset = Math.floor(totalMinutesFromStart / 60);
              const minuteOffset = totalMinutesFromStart % 60;
              const daysFromStart = Math.floor(timeSlotIndex / slotsPerDay);
              const [year, month, day] = startDate.split('-').map(Number);
              const scheduledTime = new Date(year, month - 1, day + daysFromStart, startHour + hourOffset, startMinute + minuteOffset, 0, 0);
              
              // Find the court permutation that minimizes outdoor games per team,
              // then equalizes indoor court usage as tiebreaker
              const n = slotMatches.length;
              const courtOptions = Array.from({length: n}, (_, i) => i + 1);
              let bestAssignment = [...courtOptions];
              let bestScore = Infinity;
              
              const tryPermutations = (arr: number[], start: number) => {
                if (start === arr.length) {
                  let outdoorSum = 0;
                  let indoorSum = 0;
                  for (let i = 0; i < n; i++) {
                    const c = arr[i];
                    const t1 = slotMatches[i].team1_id;
                    const t2 = slotMatches[i].team2_id;
                    if (hasOutdoorCourts && outdoorCourtIndices.has(c)) {
                      outdoorSum += getOutdoor(t1) + getOutdoor(t2);
                    }
                    indoorSum += getUsage(t1, c) + getUsage(t2, c);
                  }
                  const score = outdoorSum * 10000 + indoorSum;
                  if (score < bestScore) {
                    bestScore = score;
                    bestAssignment = [...arr];
                  }
                  return;
                }
                for (let i = start; i < arr.length; i++) {
                  [arr[start], arr[i]] = [arr[i], arr[start]];
                  tryPermutations(arr, start + 1);
                  [arr[start], arr[i]] = [arr[i], arr[start]];
                }
              };
              tryPermutations(courtOptions, 0);
              
              for (let i = 0; i < n; i++) {
                const court = bestAssignment[i];
                addUsage(slotMatches[i].team1_id, court);
                addUsage(slotMatches[i].team2_id, court);
                if (hasOutdoorCourts && outdoorCourtIndices.has(court)) {
                  addOutdoor(slotMatches[i].team1_id);
                  addOutdoor(slotMatches[i].team2_id);
                }
                const courtLabel = courtNames[court - 1] || court.toString();
                matchesToInsert.push({
                  tournament_id: currentTournament.id,
                  round: 'round_robin',
                  match_number: globalMatchNumber++,
                  team1_id: slotMatches[i].team1_id,
                  team2_id: slotMatches[i].team2_id,
                  category_id: slotMatches[i].category_id,
                  scheduled_time: scheduledTime.toISOString(),
                  court: courtLabel,
                  status: 'scheduled'
                });
              }
              
              timeSlotIndex++;
            }
          }
          
          // Log outdoor distribution
          if (hasOutdoorCourts) {
            teamOutdoorCount.forEach((count, teamId) => {
            });
          }
          
          
        } else {
          // Sem categorias - round robin normal (todas vs todas)
          const teamMatches = generateTournamentSchedule(
            teams,
            numberOfCourts,
            startDate,
            'round_robin',
            startTime,
            endTime,
            matchDuration,
            false,
            dailySchedules
          );
          
          matchesToInsert = teamMatches.map(m => {
            const courtNum = parseInt(m.court);
            const courtLabel = (!isNaN(courtNum) && courtNames[courtNum - 1]) ? courtNames[courtNum - 1] : m.court;
            return {
              tournament_id: currentTournament.id,
              round: m.round,
              match_number: m.match_number,
              team1_id: m.team1_id,
              team2_id: m.team2_id,
              scheduled_time: m.scheduled_time,
              court: courtLabel,
              status: 'scheduled'
            };
          });
        }
        
      } else if (schedFormat === 'crossed_playoffs_teams') {
        // PLAYOFFS CRUZADOS PARA EQUIPAS: Gerar jogos de grupo para cada categoria + 8 matches knockout (R1+R2+R3)
        
        const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));
        
        // 1. Atribuir campos FIXOS a cada categoria/grupo
        const categoryCourtAssignments = new Map<string, string[]>();
        const courtsPerCategory = Math.floor(numberOfCourts / sortedCategories.length);
        
        for (let catIdx = 0; catIdx < sortedCategories.length; catIdx++) {
          const category = sortedCategories[catIdx];
          const catCourtNames = (category as any).court_names as string[] | null | undefined;
          
          if (catCourtNames && catCourtNames.length > 0) {
            // Usar campos específicos definidos na categoria
            categoryCourtAssignments.set(category.id, catCourtNames);
          } else {
            // Dividir os campos do torneio igualmente entre os grupos
            const startCourt = catIdx * courtsPerCategory + 1;
            const endCourt = catIdx === sortedCategories.length - 1
              ? numberOfCourts  // Última categoria recebe os campos restantes
              : (catIdx + 1) * courtsPerCategory;
            const courts: string[] = [];
            for (let c = startCourt; c <= endCourt; c++) {
              courts.push(courtName(c - 1));
            }
            categoryCourtAssignments.set(category.id, courts);
          }
          
        }
        
        // 2. Gerar pares round-robin para cada categoria
        const categoryGroupMatches = new Map<string, Array<{
          team1_id: string;
          team2_id: string;
          round: string;
          category_id: string;
        }>>();
        
        let totalGroupMatchCount = 0;
        
        for (let catIdx = 0; catIdx < sortedCategories.length; catIdx++) {
          const category = sortedCategories[catIdx];
          const categoryTeams = teams.filter(t => t.category_id === category.id);
          const groupName = String.fromCharCode(65 + catIdx); // A, B, C
          
          
          if (categoryTeams.length < 2) {
            console.warn(`[SCHEDULE] Category ${category.name} has fewer than 2 teams, skipping`);
            categoryGroupMatches.set(category.id, []);
            continue;
          }
          
          const catMatches: Array<{team1_id: string; team2_id: string; round: string; category_id: string}> = [];
          for (let i = 0; i < categoryTeams.length; i++) {
            for (let j = i + 1; j < categoryTeams.length; j++) {
              catMatches.push({
                team1_id: categoryTeams[i].id,
                team2_id: categoryTeams[j].id,
                round: `group_${groupName}`,
                category_id: category.id,
              });
            }
          }
          
          categoryGroupMatches.set(category.id, catMatches);
          totalGroupMatchCount += catMatches.length;
        }
        
        
        // 3. Agendar jogos de grupo em paralelo - cada categoria nos seus campos FIXOS
        matchesToInsert = [];
        let matchNumber = 1;
        
        // Rastrear progresso por categoria
        const categoryMatchIndexes = new Map<string, number>();
        sortedCategories.forEach(cat => categoryMatchIndexes.set(cat.id, 0));
        
        // Função para obter o horário de um dia específico
        const getDaySchedule = (dateStr: string) => {
          if (dailySchedules && dailySchedules.length > 0) {
            const schedule = dailySchedules.find((s: { date: string; start_time: string; end_time: string }) => s.date === dateStr);
            if (schedule) {
              return { start: schedule.start_time, end: schedule.end_time };
            }
          }
          return { start: startTime, end: endTime };
        };
        
        // Começar com o horário do primeiro dia
        let currentDateStr = startDate;
        let daySchedule = getDaySchedule(currentDateStr);
        
        // Criar data corretamente (sem problemas de timezone)
        const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
        const [startHr, startMin] = daySchedule.start.split(':').map(Number);
        let currentTime = new Date(startYear, startMonth - 1, startDay, startHr, startMin, 0, 0);
        
        
        let slotNumber = 0;
        const MAX_SLOTS = 100; // Segurança contra loops infinitos
        
        while (slotNumber < MAX_SLOTS) {
          // Verificar se todas as categorias terminaram
          let allCategoriesDone = true;
          for (const cat of sortedCategories) {
            const catMatches = categoryGroupMatches.get(cat.id) || [];
            const catIdx = categoryMatchIndexes.get(cat.id) || 0;
            if (catIdx < catMatches.length) {
              allCategoriesDone = false;
              break;
            }
          }
          if (allCategoriesDone) break;
          
          slotNumber++;
          
          // Criar string de data/hora no formato ISO LOCAL
          const year = currentTime.getFullYear();
          const month = String(currentTime.getMonth() + 1).padStart(2, '0');
          const day = String(currentTime.getDate()).padStart(2, '0');
          const hours = String(currentTime.getHours()).padStart(2, '0');
          const minutes = String(currentTime.getMinutes()).padStart(2, '0');
          const scheduledTimeStr = currentTime.toISOString();
          
          
          // Para CADA categoria, preencher os seus campos FIXOS
          for (const cat of sortedCategories) {
            const catMatches = categoryGroupMatches.get(cat.id) || [];
            let catIdx = categoryMatchIndexes.get(cat.id) || 0;
            const catCourts = categoryCourtAssignments.get(cat.id) || [];
            
            if (catIdx >= catMatches.length) continue; // Esta categoria já terminou
            
            const teamsPlayingThisSlot = new Set<string>();
            let courtIdx = 0;
            
            while (courtIdx < catCourts.length && catIdx < catMatches.length) {
              // Procurar um jogo onde nenhuma equipa está a jogar neste slot
              let foundMatch = false;
              for (let i = catIdx; i < catMatches.length; i++) {
                const m = catMatches[i];
                if (!teamsPlayingThisSlot.has(m.team1_id) && !teamsPlayingThisSlot.has(m.team2_id)) {
                  teamsPlayingThisSlot.add(m.team1_id);
                  teamsPlayingThisSlot.add(m.team2_id);
                  
                  const courtName = catCourts[courtIdx];
                  
                  matchesToInsert.push({
                    tournament_id: currentTournament.id,
                    category_id: m.category_id,
                    round: m.round,
                    match_number: matchNumber++,
                    team1_id: m.team1_id,
                    team2_id: m.team2_id,
                    scheduled_time: scheduledTimeStr,
                    court: courtName,
                    status: 'scheduled'
                  });
                  
                  // Trocar com posição atual e avançar
                  if (i !== catIdx) {
                    [catMatches[catIdx], catMatches[i]] = [catMatches[i], catMatches[catIdx]];
                  }
                  catIdx++;
                  courtIdx++;
                  foundMatch = true;
                  break;
                }
              }
              
              if (!foundMatch) break; // Sem jogos disponíveis para este slot nesta categoria
            }
            
            categoryMatchIndexes.set(cat.id, catIdx);
          }
          
          // Avançar para o próximo slot de tempo
          const endOfDayHour = parseInt(daySchedule.end.split(':')[0]);
          const endOfDayMinute = parseInt(daySchedule.end.split(':')[1] || '0');
          const endOfDayInMinutes = endOfDayHour * 60 + endOfDayMinute;
          
          const currentHour = currentTime.getHours();
          const currentMinute = currentTime.getMinutes();
          const currentInMinutes = currentHour * 60 + currentMinute;
          const nextSlotInMinutes = currentInMinutes + matchDuration;
          
          // Só avançar para o próximo slot no mesmo dia se ainda houver tempo
          // para um jogo completo (evita agendar jogos na hora exata de fecho).
          if (nextSlotInMinutes + matchDuration > endOfDayInMinutes) {
            currentTime.setDate(currentTime.getDate() + 1);
            const nextYear = currentTime.getFullYear();
            const nextMonth = String(currentTime.getMonth() + 1).padStart(2, '0');
            const nextDay = String(currentTime.getDate()).padStart(2, '0');
            currentDateStr = `${nextYear}-${nextMonth}-${nextDay}`;
            daySchedule = getDaySchedule(currentDateStr);
            currentTime.setHours(parseInt(daySchedule.start.split(':')[0]), parseInt(daySchedule.start.split(':')[1] || '0'), 0, 0);
          } else {
            currentTime = new Date(currentTime.getTime() + matchDuration * 60000);
          }
        }
        
        
        // 3. AGORA GERAR AUTOMATICAMENTE OS PLAYOFFS CRUZADOS COM TBD
        // Ler configurações das categorias para determinar número de jogos
        
        // Calcular número total de equipas qualificadas baseado nas configurações das categorias
        // Fallback: categoria → torneio → auto-cálculo baseado em número de equipas
        let totalQualifiedTeams = 0;
        const numberOfGroups = categories.length; // Cada categoria é um grupo
        
        // Ler qualified_per_group e knockout_stage com fallback robusto
        let qualifiedPerGroup = 2; // default
        let knockoutStage = 'semifinals'; // default
        let totalTeamsInCategories = 0;
        let nonQualifiedTeams = 0;
        
        if (categories.length > 0) {
          const catQPG = (categories[0] as any).qualified_per_group;
          const catKS = (categories[0] as any).knockout_stage;
          const tournamentKS = (currentTournament as any).knockout_stage;
          
          // Fallback chain: categoria → torneio → auto-cálculo
          if (catQPG != null && catQPG > 0) {
            qualifiedPerGroup = catQPG;
          } else {
            const ksGuess = catKS || tournamentKS || 'semifinals';
            qualifiedPerGroup = calculateTeamQualificationConfig(categories.length, ksGuess).qualifiedPerGroup;
          }
          
          if (catKS && catKS !== 'null') {
            knockoutStage = catKS;
          } else if (tournamentKS && tournamentKS !== 'null') {
            knockoutStage = tournamentKS;
          } else {
            // Auto-determinar baseado no total de equipas qualificadas
            const totalQ = categories.length * qualifiedPerGroup;
            if (totalQ >= 8) knockoutStage = 'quarterfinals';
            else if (totalQ >= 4) knockoutStage = 'semifinals';
            else knockoutStage = 'final';
          }
          
          totalQualifiedTeams = categories.length * qualifiedPerGroup;
          totalTeamsInCategories = categories.reduce((sum, c) => sum + teams.filter(t => t.category_id === c.id).length, 0);
          nonQualifiedTeams = Math.max(totalTeamsInCategories - totalQualifiedTeams, 0);
        }
        
        // Calcular número de jogos na primeira ronda baseado no knockout_stage
        let numR1Matches = 0; // Quartos de final
        let numR2Matches = 0; // Meias-finais
        let numR3Matches = 2; // Final e 3º/4º
        let numR4Matches = 0; // Classificação 5-6
        let numR5Matches = 0; // Classificação 7-8
        
        if (knockoutStage === 'quarterfinals') {
          // Quartos de final: totalQualifiedTeams / 2 = número de jogos
          numR1Matches = totalQualifiedTeams / 2;
          // Meias-finais: número de vencedores dos quartos / 2
          numR2Matches = numR1Matches / 2;
          // Se temos 8 equipas (4 quartos), temos 2 meias, então precisamos de classificação 5-6 e 7-8
          if (totalQualifiedTeams === 8) {
            numR4Matches = 1; // Classificação 5-6 (perdedores das meias que não vão à final)
            numR5Matches = 1; // Classificação 7-8 (perdedores dos quartos que não vão às meias)
          }
        } else if (knockoutStage === 'semifinals') {
          // Direto para meias-finais: totalQualifiedTeams / 2
          numR1Matches = totalQualifiedTeams / 2;
          numR2Matches = 0; // Não há R2, R1 já são as meias-finais
          // Se existirem 4 não qualificadas (ex: 3º/4º de M3 e M4), criar 2 jogos de classificação.
          if (nonQualifiedTeams >= 4) {
            numR4Matches = 1; // Classificação 5-6
            numR5Matches = 1; // Classificação 7-8
          }
        } else {
          // Final direto (não comum, mas possível)
          numR1Matches = totalQualifiedTeams / 2;
          numR2Matches = 0;
        }
        
        
        // Calcular o tempo para começar os playoffs (depois do último jogo de grupo)
        let playoffsTime = currentTime;
        // Se já passou do fim do dia, mover para o dia seguinte
        const endOfDayHour = parseInt(daySchedule.end.split(':')[0]);
        const endOfDayMinute = parseInt(daySchedule.end.split(':')[1] || '0');
        const endOfDayInMinutes = endOfDayHour * 60 + endOfDayMinute;
        const currentHour = playoffsTime.getHours();
        const currentMinute = playoffsTime.getMinutes();
        const currentInMinutes = currentHour * 60 + currentMinute;
        
        if (currentInMinutes + matchDuration > endOfDayInMinutes) {
          playoffsTime.setDate(playoffsTime.getDate() + 1);
          const nextYear = playoffsTime.getFullYear();
          const nextMonth = String(playoffsTime.getMonth() + 1).padStart(2, '0');
          const nextDay = String(playoffsTime.getDate()).padStart(2, '0');
          const nextDateStr = `${nextYear}-${nextMonth}-${nextDay}`;
          const nextDaySchedule = getDaySchedule(nextDateStr);
          playoffsTime.setHours(parseInt(nextDaySchedule.start.split(':')[0]), parseInt(nextDaySchedule.start.split(':')[1] || '0'), 0, 0);
        }
        
        // RONDA 1 - Playoffs Cruzados (quartos de final ou meias-finais)
        const r1TimeStr = playoffsTime.toISOString();
        
        for (let i = 0; i < numR1Matches; i++) {
          matchesToInsert.push({
            tournament_id: currentTournament.id,
            category_id: null,
            round: `crossed_r1_j${i + 1}`,
            match_number: matchNumber++,
            team1_id: null,
            team2_id: null,
            scheduled_time: r1TimeStr,
            court: courtName(i % numberOfCourts),
            status: 'scheduled'
          });
        }
        
        // RONDA 2 - Meias-finais (se houver quartos de final)
        if (numR2Matches > 0) {
          playoffsTime = new Date(playoffsTime.getTime() + matchDuration * 60000);
          const currentDateStr2 = `${playoffsTime.getFullYear()}-${String(playoffsTime.getMonth() + 1).padStart(2, '0')}-${String(playoffsTime.getDate()).padStart(2, '0')}`;
          const daySchedule2 = getDaySchedule(currentDateStr2);
          const endOfDayInMinutes2 = parseInt(daySchedule2.end.split(':')[0]) * 60 + parseInt(daySchedule2.end.split(':')[1] || '0');
          const currentInMinutes2 = playoffsTime.getHours() * 60 + playoffsTime.getMinutes();
          
          if (currentInMinutes2 + matchDuration > endOfDayInMinutes2) {
            playoffsTime.setDate(playoffsTime.getDate() + 1);
            const nextYear = playoffsTime.getFullYear();
            const nextMonth = String(playoffsTime.getMonth() + 1).padStart(2, '0');
            const nextDay = String(playoffsTime.getDate()).padStart(2, '0');
            const nextDateStr = `${nextYear}-${nextMonth}-${nextDay}`;
            const nextDaySchedule = getDaySchedule(nextDateStr);
            playoffsTime.setHours(parseInt(nextDaySchedule.start.split(':')[0]), parseInt(nextDaySchedule.start.split(':')[1] || '0'), 0, 0);
          }
          
          const r2TimeStr = playoffsTime.toISOString();
          
          for (let i = 0; i < numR2Matches; i++) {
            matchesToInsert.push({
              tournament_id: currentTournament.id,
              category_id: null,
              round: `crossed_r2_j${i + 1}`,
              match_number: matchNumber++,
              team1_id: null,
              team2_id: null,
              scheduled_time: r2TimeStr,
              court: courtName(i % numberOfCourts),
              status: 'scheduled'
            });
          }
        }
        
        // RONDA 3 - Finais (2 jogos: final e 3º/4º)
        playoffsTime = new Date(playoffsTime.getTime() + matchDuration * 60000);
        const currentDateStr3 = `${playoffsTime.getFullYear()}-${String(playoffsTime.getMonth() + 1).padStart(2, '0')}-${String(playoffsTime.getDate()).padStart(2, '0')}`;
        const daySchedule3 = getDaySchedule(currentDateStr3);
        const endOfDayInMinutes3 = parseInt(daySchedule3.end.split(':')[0]) * 60 + parseInt(daySchedule3.end.split(':')[1] || '0');
        const currentInMinutes3 = playoffsTime.getHours() * 60 + playoffsTime.getMinutes();
        
        if (currentInMinutes3 + matchDuration > endOfDayInMinutes3) {
          playoffsTime.setDate(playoffsTime.getDate() + 1);
          const nextYear = playoffsTime.getFullYear();
          const nextMonth = String(playoffsTime.getMonth() + 1).padStart(2, '0');
          const nextDay = String(playoffsTime.getDate()).padStart(2, '0');
          const nextDateStr = `${nextYear}-${nextMonth}-${nextDay}`;
          const nextDaySchedule = getDaySchedule(nextDateStr);
          playoffsTime.setHours(parseInt(nextDaySchedule.start.split(':')[0]), parseInt(nextDaySchedule.start.split(':')[1] || '0'), 0, 0);
        }
        
        const r3TimeStr = playoffsTime.toISOString();
        
        matchesToInsert.push({
          tournament_id: currentTournament.id,
          category_id: null,
          round: 'crossed_r3_final',
          match_number: matchNumber++,
          team1_id: null,
          team2_id: null,
          scheduled_time: r3TimeStr,
          court: courtName(0),
          status: 'scheduled'
        });
        
        matchesToInsert.push({
          tournament_id: currentTournament.id,
          category_id: null,
          round: 'crossed_r3_3rd_place',
          match_number: matchNumber++,
          team1_id: null,
          team2_id: null,
          scheduled_time: r3TimeStr,
          court: courtName(1),
          status: 'scheduled'
        });

        // Para meias diretas com 4 não qualificadas:
        // - crossed_r4_5th e crossed_r5_7th jogam no mesmo slot das meias (R1),
        // - crossed_r6_* decide 5º/6º e 7º/8º no mesmo slot da final/3º.
        const useTwoPhasePlacement = knockoutStage === 'semifinals' && numR2Matches === 0 && numR4Matches > 0 && numR5Matches > 0;

        if (useTwoPhasePlacement && numR4Matches > 0) {
          matchesToInsert.push({
            tournament_id: currentTournament.id,
            category_id: null,
            round: 'crossed_r4_5th',
            match_number: matchNumber++,
            team1_id: null,
            team2_id: null,
            scheduled_time: r1TimeStr,
            court: courtName(2),
            status: 'scheduled'
          });
        }

        if (useTwoPhasePlacement && numR5Matches > 0) {
          matchesToInsert.push({
            tournament_id: currentTournament.id,
            category_id: null,
            round: 'crossed_r5_7th',
            match_number: matchNumber++,
            team1_id: null,
            team2_id: null,
            scheduled_time: r1TimeStr,
            court: courtName(3),
            status: 'scheduled'
          });
        }

        if (useTwoPhasePlacement) {
          matchesToInsert.push({
            tournament_id: currentTournament.id,
            category_id: null,
            round: 'crossed_r6_5th_final',
            match_number: matchNumber++,
            team1_id: null,
            team2_id: null,
            scheduled_time: r3TimeStr,
            court: courtName(2),
            status: 'scheduled'
          });
          matchesToInsert.push({
            tournament_id: currentTournament.id,
            category_id: null,
            round: 'crossed_r6_7th_final',
            match_number: matchNumber++,
            team1_id: null,
            team2_id: null,
            scheduled_time: r3TimeStr,
            court: courtName(3),
            status: 'scheduled'
          });
        }
        
        // Com estrutura antiga (sem two-phase), manter classificação no slot final.
        if (!useTwoPhasePlacement && numR4Matches > 0) {
          matchesToInsert.push({
            tournament_id: currentTournament.id,
            category_id: null,
            round: 'crossed_r4_5th',
            match_number: matchNumber++,
            team1_id: null,
            team2_id: null,
            scheduled_time: r3TimeStr,
            court: courtName(2),
            status: 'scheduled'
          });
        }
        if (!useTwoPhasePlacement && numR5Matches > 0) {
          matchesToInsert.push({
            tournament_id: currentTournament.id,
            category_id: null,
            round: 'crossed_r5_7th',
            match_number: matchNumber++,
            team1_id: null,
            team2_id: null,
            scheduled_time: r3TimeStr,
            court: courtName(3),
            status: 'scheduled'
          });
        }
        
        const totalPlayoffMatches = numR1Matches + numR2Matches + numR3Matches + numR4Matches + numR5Matches;
        
      } else {
        // Torneios de equipas standard (round_robin, single_elimination, groups_knockout)
        
        // Se há categorias e não é round_robin puro, gerar quadros separados por categoria
        const hasCategories = categories.length > 0 && teams.some(t => t.category_id);
        const isRoundRobin = schedFormat === 'round_robin' && !schedRoundRobinType;
        
        if (hasCategories && !isRoundRobin) {
          
          // Construir os court names do torneio
          const tournamentCourtNames: string[] = (currentTournament as any).court_names || [];
          const allCourtNames = tournamentCourtNames.length > 0
            ? tournamentCourtNames
            : Array.from({ length: numberOfCourts }, (_, i) => (i + 1).toString());
          
          // Construir o pedido por categoria
          const categoryRequests = categories
            .filter(category => {
              const categoryTeams = teams.filter(t => t.category_id === category.id);
              if (categoryTeams.length === 0) {
                return false;
              }
              return true;
            })
            .map(category => {
              const categoryTeams = teams.filter(t => t.category_id === category.id);
              const catKnockoutStage = (category as any).knockout_stage || 'semifinals';
              const catCourtNames = (category as any).court_names as string[] | null | undefined;
              const catSchedule = (category as any).category_schedule || null;
              const catMatchDuration = (category as any).match_duration_minutes || null;
              const catFormat = schedFormat || 'single_elimination';
              
              // Para groups_knockout, criar knockoutTeams TBD baseados no knockoutStage
              // Estes são placeholders que serão preenchidos depois da fase de grupos
              // NÃO criar para single_elimination (já gera eliminação direta em generateCategoryMatches)
              let knockoutTeams: Array<{ id: string; name: string }> | undefined;
              if (catFormat === 'groups_knockout' && catKnockoutStage !== 'none') {
                const knockoutTeamCounts: Record<string, number> = {
                  'final': 2,
                  'semifinals': 4,
                  'quarterfinals': 8,
                  'round_of_16': 16
                };
                const numKnockoutTeams = knockoutTeamCounts[catKnockoutStage] || 4;
                knockoutTeams = Array.from({ length: numKnockoutTeams }, (_, i) => ({
                  id: `TBD_${category.id}_${i}`,
                  name: `TBD ${i + 1}`
                }));
              }
              
              
              return {
                categoryId: category.id,
                teams: categoryTeams,
                format: catFormat,
                knockoutStage: catKnockoutStage,
                knockoutTeams: knockoutTeams,
                courtNames: catCourtNames || undefined,
                categorySchedule: catSchedule,
                matchDurationMinutes: catMatchDuration,
                hasThirdPlace: (category as any).has_third_place_match ?? true,
              };
            });
          
          // Chamar o scheduler multi-categoria
          const scheduledResult = scheduleMultipleCategories(
            categoryRequests,
            numberOfCourts,
            startDate,
            startTime,
            endTime,
            matchDuration,
            [],
            dailySchedules,
            allCourtNames
          );
          
          // Converter o resultado (Map<categoryId, ScheduledMatch[]>) em matchesToInsert
          // IDs que começam com "TBD_" são placeholders e devem ser null
          const cleanTeamId = (id: string | null | undefined): string | null => {
            if (!id || id.startsWith('TBD_') || id === 'TBD') return null;
            return id;
          };
          
          matchesToInsert = [];
          let matchNumber = 1;
          
          scheduledResult.forEach((catMatches, categoryId) => {
            catMatches.forEach(m => {
              matchesToInsert.push({
                tournament_id: currentTournament.id,
                category_id: categoryId,
                round: m.round,
                match_number: matchNumber++,
                team1_id: cleanTeamId(m.team1_id),
                team2_id: cleanTeamId(m.team2_id),
                scheduled_time: m.scheduled_time,
                court: m.court,
                status: 'scheduled'
              });
            });
          });
          
        } else {
          const tournamentKnockoutStage = (currentTournament as any).knockout_stage || 'semifinals';
          const teamMatches = generateTournamentSchedule(
            teams,
            numberOfCourts,
            startDate,
            schedFormat || 'round_robin',
            startTime,
            endTime,
            matchDuration,
            false,
            dailySchedules,
            tournamentKnockoutStage
          );
          
          matchesToInsert = teamMatches.map(m => {
            const matchTeam1 = teams.find(t => t.id === m.team1_id);
            const matchTeam2 = teams.find(t => t.id === m.team2_id);
            const categoryId = matchTeam1?.category_id || matchTeam2?.category_id || null;
            const cNum = parseInt(m.court);
            const cLabel = (!isNaN(cNum) && courtNames[cNum - 1]) ? courtNames[cNum - 1] : m.court;
            
            return {
              tournament_id: currentTournament.id,
              category_id: categoryId,
              round: m.round,
              match_number: m.match_number,
              team1_id: m.team1_id,
              team2_id: m.team2_id,
              scheduled_time: m.scheduled_time,
              court: cLabel,
              status: 'scheduled'
            };
          });
        }
      }
      
      // Filtrar pares/combinações que ja tem jogo completed (nao duplicar)
      // For individual matches: build set of completed 4-player combinations
      const completedIndividualCombos = new Set(
        completedMatches
          .filter(m => (m as any).player1_individual_id)
          .map(m => [
            (m as any).player1_individual_id,
            (m as any).player2_individual_id,
            (m as any).player3_individual_id,
            (m as any).player4_individual_id
          ].filter(Boolean).sort().join('|'))
      );
      if (completedIndividualCombos.size > 0) {
      }
      
      const beforeFilter = matchesToInsert.length;
      matchesToInsert = matchesToInsert.filter(m => {
        // Dedup individual matches (player*_individual_id)
        if (m.player1_individual_id) {
          const key = [
            m.player1_individual_id, m.player2_individual_id,
            m.player3_individual_id, m.player4_individual_id
          ].filter(Boolean).sort().join('|');
          if (completedIndividualCombos.has(key)) return false;
        }
        // Dedup team matches (team1_id/team2_id)
        if (!m.team1_id || !m.team2_id) return true;
        const key = [m.team1_id, m.team2_id].sort().join('|');
        return !completedPairs.has(key);
      });
      if (matchesToInsert.length < beforeFilter) {
      }

      // Ajustar match_number para nao colidir com completed
      if (maxCompletedMatchNumber > 0) {
        matchesToInsert.forEach((m, i) => {
          m.match_number = maxCompletedMatchNumber + 1 + i;
        });
      }

      
      if (matchesToInsert.length > 0) {
        // Pre-insert validation: block inserts that violate structural rules
        // (overbooking, KO before groups, same team twice in a slot, matches outside category windows).
        const validation = validateGeneratedSchedule(
          matchesToInsert as any,
          numberOfCourts,
          categories.map(c => ({
            id: c.id,
            name: c.name,
            category_schedule: (c as any).category_schedule || null,
            match_duration_minutes: (c as any).match_duration_minutes || null,
          })),
          matchDuration
        );

        if (validation.errors.length > 0) {
          console.error('[SCHEDULE] Validation FAILED:', validation.errors);
          const preview = validation.errors.slice(0, 15).join('\n');
          const more = validation.errors.length > 15
            ? `\n\n... e mais ${validation.errors.length - 15} violações.`
            : '';
          alert(
            'Não foi possível guardar o calendário. Foram detectadas as seguintes violações:\n\n' +
            preview + more +
            '\n\nVerifique os horários por categoria, o número de campos e tente gerar de novo.'
          );
          setLoading(false);
          return;
        }

        if (validation.warnings.length > 0) {
          console.warn('[SCHEDULE] Validation warnings:', validation.warnings);
          const preview = validation.warnings.slice(0, 10).join('\n');
          const more = validation.warnings.length > 10
            ? `\n\n... e mais ${validation.warnings.length - 10} avisos.`
            : '';
          if (!confirm('Calendário gerado com avisos:\n\n' + preview + more + '\n\nContinuar a guardar?')) {
            setLoading(false);
            return;
          }
        }

        const { error } = await supabase.from('matches').insert(matchesToInsert);
        if (error) throw error;
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
    // Verificar se ha jogos completed
    const { data: completedCheck } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournament.id)
      .eq('status', 'completed');
    const completedCount = completedCheck?.length || 0;

    const msg = completedCount > 0
      ? `Isto vai eliminar todos os jogos NÃO terminados. Os ${completedCount} jogos já completados serão preservados. Continuar?`
      : t.tournament.confirmDeleteMatches;
    if (!confirm(msg)) return;
    
    setLoading(true);
    try {
      await deleteCourtBookingsForTournament(tournament.id);
      const { error } = await supabase
        .from('matches')
        .delete()
        .eq('tournament_id', tournament.id)
        .neq('status', 'completed');
      if (error) throw error;

      // Re-trigger tournament bookings creation via DB trigger
      await supabase.from('tournaments')
        .update({ name: currentTournament.name })
        .eq('id', tournament.id);

      await fetchTournamentData();
      alert(t.nav.matchesDeleted);
    } catch (error) {
      console.error('Error deleting matches:', error);
      alert('Erro ao eliminar jogos');
    } finally {
      setLoading(false);
    }
  };

  const handleClearAllResults = async () => {
    if (!confirm('Isto vai limpar todos os resultados de todos os jogos. Os jogos serão mantidos mas os scores serão apagados. Continuar?')) return;

    setLoading(true);
    try {
      const { data: allMatches, error: fetchError } = await supabase
        .from('matches')
        .select('id, round')
        .eq('tournament_id', tournament.id)
        .or('status.eq.completed,team1_score_set1.gt.0,team2_score_set1.gt.0');

      if (fetchError) throw fetchError;
      if (!allMatches || allMatches.length === 0) {
        alert('Não há resultados para limpar.');
        return;
      }

      const knockoutRounds = [
        'semifinal', 'semi_final', 'final', '3rd_place', 'quarterfinal', 'quarter_final',
        'consolation', 'round_of_16'
      ];
      const isKnockoutRound = (round: string | null) => {
        if (!round) return false;
        const r = round.toLowerCase();
        return knockoutRounds.some(kr => r === kr || r.endsWith('_' + kr));
      };

      const knockoutMatchIds = allMatches.filter(m => isKnockoutRound(m.round)).map(m => m.id);
      const nonKnockoutMatchIds = allMatches.filter(m => !isKnockoutRound(m.round)).map(m => m.id);

      if (nonKnockoutMatchIds.length > 0) {
        const { error } = await supabase
          .from('matches')
          .update({
            status: 'scheduled',
            winner_id: null,
            team1_score_set1: 0, team1_score_set2: 0, team1_score_set3: 0,
            team2_score_set1: 0, team2_score_set2: 0, team2_score_set3: 0,
          })
          .in('id', nonKnockoutMatchIds);
        if (error) throw error;
      }

      if (knockoutMatchIds.length > 0) {
        const { error } = await supabase
          .from('matches')
          .update({
            status: 'scheduled',
            winner_id: null,
            team1_score_set1: 0, team1_score_set2: 0, team1_score_set3: 0,
            team2_score_set1: 0, team2_score_set2: 0, team2_score_set3: 0,
            player1_individual_id: null, player2_individual_id: null,
            player3_individual_id: null, player4_individual_id: null,
            team1_id: null, team2_id: null,
          })
          .in('id', knockoutMatchIds);
        if (error) throw error;
      }

      await fetchTournamentData();
      alert('Todos os resultados foram limpos com sucesso!');
    } catch (error) {
      console.error('Error clearing results:', error);
      alert('Erro ao limpar resultados');
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
        // Se o torneio tem categorias, calcular posições para TODAS as categorias
        if (categories.length > 0) {
          for (const cat of categories) {
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
            await calculateIndividualFinalPositions(tournament.id, 'no-category');
          }
        } else {
          // Sem categorias - calcular para todos
          await calculateIndividualFinalPositions(tournament.id, selectedCategory);
        }
      } else if (currentTournament.format === 'crossed_playoffs_teams') {
        // Crossed Playoffs Teams: positions determined by bracket results

        const { data: allCompletedMatches } = await supabase
          .from('matches')
          .select('*')
          .eq('tournament_id', tournament.id)
          .eq('status', 'completed');

        if (allCompletedMatches) {
          const getMatchWinnerLoser = (match: any): { winner: string | null; loser: string | null } => {
            const t1g = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
            const t2g = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
            if (t1g > t2g) return { winner: match.team1_id, loser: match.team2_id };
            if (t2g > t1g) return { winner: match.team2_id, loser: match.team1_id };
            return { winner: null, loser: null };
          };

          const positionMap: Array<{ round: string; winnerPos: number; loserPos: number }> = [
            { round: 'crossed_r3_final', winnerPos: 1, loserPos: 2 },
            { round: 'crossed_r3_3rd_place', winnerPos: 3, loserPos: 4 },
            { round: 'crossed_r4_5th', winnerPos: 5, loserPos: 6 },
            { round: 'crossed_r5_7th', winnerPos: 7, loserPos: 8 },
          ];

          const teamPositions = new Map<string, number>();
          for (const pm of positionMap) {
            const match = allCompletedMatches.find(m => m.round === pm.round);
            if (match && match.team1_id && match.team2_id) {
              const { winner, loser } = getMatchWinnerLoser(match);
              if (winner) teamPositions.set(winner, pm.winnerPos);
              if (loser) teamPositions.set(loser, pm.loserPos);
            }
          }

          // Update team positions
          for (const [teamId, position] of teamPositions) {
            await supabase.from('teams').update({ final_position: position }).eq('id', teamId);
          }

          // Also update player positions (each player inherits team position)
          const { data: tournamentTeams } = await supabase
            .from('teams')
            .select('id, player1_id, player2_id, final_position')
            .eq('tournament_id', tournament.id);

          if (tournamentTeams) {
            for (const team of tournamentTeams) {
              if (team.final_position) {
                if (team.player1_id) {
                  await supabase.from('players').update({ final_position: team.final_position }).eq('id', team.player1_id);
                }
                if (team.player2_id) {
                  await supabase.from('players').update({ final_position: team.final_position }).eq('id', team.player2_id);
                }
              }
            }
          }

        }
      } else if (currentTournament.format === 'groups_knockout') {

        const { data: allCompletedMatches } = await supabase
          .from('matches')
          .select('*')
          .eq('tournament_id', tournament.id)
          .eq('status', 'completed');

        const { data: tournamentTeams } = await supabase
          .from('teams')
          .select('id, player1_id, player2_id, name, group_name, category_id')
          .eq('tournament_id', tournament.id);

        if (allCompletedMatches && tournamentTeams) {
          const getMatchWL = (match: any): { winner: string | null; loser: string | null } => {
            const t1g = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
            const t2g = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
            if (t1g > t2g) return { winner: match.team1_id, loser: match.team2_id };
            if (t2g > t1g) return { winner: match.team2_id, loser: match.team1_id };
            return { winner: match.winner_id || null, loser: null };
          };

          const positionMap: Array<{ round: string; winnerPos: number; loserPos: number }> = [
            { round: 'final', winnerPos: 1, loserPos: 2 },
            { round: '3rd_place', winnerPos: 3, loserPos: 4 },
            { round: '5th_place', winnerPos: 5, loserPos: 6 },
            { round: '7th_place', winnerPos: 7, loserPos: 8 },
          ];

          const teamPositions = new Map<string, number>();
          for (const pm of positionMap) {
            const match = allCompletedMatches.find(m => m.round === pm.round);
            if (match && match.team1_id && match.team2_id) {
              const { winner, loser } = getMatchWL(match);
              if (winner && !teamPositions.has(winner)) teamPositions.set(winner, pm.winnerPos);
              if (loser && !teamPositions.has(loser)) teamPositions.set(loser, pm.loserPos);
            }
          }

          // QF losers that didn't go to classification matches
          const qfMatches = allCompletedMatches.filter(m =>
            m.round === 'quarter_final' || m.round === 'quarterfinal'
          );
          let nextPos = teamPositions.size + 1;
          for (const qfM of qfMatches) {
            const { loser } = getMatchWL(qfM);
            if (loser && !teamPositions.has(loser)) {
              teamPositions.set(loser, nextPos);
              nextPos++;
            }
          }

          // Semi-final losers not yet placed
          const semiMatches = allCompletedMatches.filter(m =>
            m.round === 'semi_final' || m.round === 'semifinal'
          );
          for (const sm of semiMatches) {
            const { loser } = getMatchWL(sm);
            if (loser && !teamPositions.has(loser)) {
              teamPositions.set(loser, nextPos);
              nextPos++;
            }
          }

          // Remaining teams not in knockout
          const groupMatches = allCompletedMatches.filter(m =>
            m.round === 'round_robin' || m.round?.startsWith('group_')
          );
          const remainingTeams = tournamentTeams.filter(t => !teamPositions.has(t.id));
          if (remainingTeams.length > 0 && groupMatches.length > 0) {
            const remainingStats = remainingTeams.map(team => {
              let wins = 0, gw = 0, gl = 0;
              groupMatches.forEach(m => {
                const isT1 = m.team1_id === team.id;
                const isT2 = m.team2_id === team.id;
                if (!isT1 && !isT2) return;
                const t1 = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
                const t2 = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);
                if (isT1) { gw += t1; gl += t2; if (t1 > t2) wins++; }
                else { gw += t2; gl += t1; if (t2 > t1) wins++; }
              });
              return { id: team.id, wins, diff: gw - gl, gw };
            });
            remainingStats.sort((a, b) => b.wins - a.wins || (b.diff - a.diff) || (b.gw - a.gw));
            for (const rs of remainingStats) {
              teamPositions.set(rs.id, nextPos);
              nextPos++;
            }
          }

          // Update team positions
          for (const [teamId, position] of teamPositions) {
            await supabase.from('teams').update({ final_position: position }).eq('id', teamId);
          }

          // Propagate to players
          for (const team of tournamentTeams) {
            const pos = teamPositions.get(team.id);
            if (pos) {
              if (team.player1_id) {
                await supabase.from('players').update({ final_position: pos }).eq('id', team.player1_id);
              }
              if (team.player2_id) {
                await supabase.from('players').update({ final_position: pos }).eq('id', team.player2_id);
              }
            }
          }

        }
      } else {
        // For other team tournaments, calculate team positions from match results
        
        // Get completed group/round_robin matches
        const { data: completedMatches } = await supabase
          .from('matches')
          .select('*')
          .eq('tournament_id', tournament.id)
          .eq('status', 'completed');

        const groupMatches = completedMatches?.filter(m => 
          m.round === 'round_robin' || m.round?.startsWith('group_')
        ) || [];


        // Get all teams
        const { data: tournamentTeams } = await supabase
          .from('teams')
          .select('*')
          .eq('tournament_id', tournament.id);

        if (groupMatches.length > 0 && tournamentTeams && tournamentTeams.length > 0) {
          const teamStats = tournamentTeams.map(team => {
            let wins = 0;
            let draws = 0;
            let losses = 0;
            let gamesWon = 0;
            let gamesLost = 0;

            groupMatches.forEach(match => {
              const isTeam1 = match.team1_id === team.id;
              const isTeam2 = match.team2_id === team.id;
              
              if (!isTeam1 && !isTeam2) return;
              
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
          const matchDataForSort: MatchData[] = groupMatches.map(m => ({
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


          for (let i = 0; i < sortedStats.length; i++) {
            const position = i + 1;
            await supabase
              .from('teams')
              .update({ final_position: position })
              .eq('id', sortedStats[i].id);
          }


          // Propagate final_position to players (each player inherits team position)
          for (const team of tournamentTeams) {
            const teamPosition = sortedStats.findIndex(s => s.id === team.id) + 1;
            if (teamPosition > 0) {
              if (team.player1_id) {
                await supabase.from('players').update({ final_position: teamPosition }).eq('id', team.player1_id);
              }
              if (team.player2_id) {
                await supabase.from('players').update({ final_position: teamPosition }).eq('id', team.player2_id);
              }
            }
          }
        } else {
        }
      }

      // 2. Update tournament status to completed FIRST
      const { error } = await supabase
        .from('tournaments')
        .update({ status: 'completed' })
        .eq('id', tournament.id);

      if (error) throw error;

      // 3. Now update league standings (after status is 'completed')
      await updateLeagueStandings(tournament.id);

      // 4. Process ratings ONLY for matches in THIS tournament (not all tournaments!)
      let ratingInfo = '';
      try {
        const ratingResult = await processAllUnratedMatches(undefined, undefined, tournament.id);
        ratingInfo = `\n\n📊 Ratings: ${ratingResult.processed} processados, ${ratingResult.skipped} saltados, ${ratingResult.errors} erros de ${ratingResult.total} jogos`;
      } catch (ratingErr) {
        console.error('[FINALIZE] Error processing ratings:', ratingErr);
        ratingInfo = '\n\n⚠️ Erro ao processar ratings dos jogadores';
      }

      // 5. Award reward points to all tournament participants
      let rewardInfo = '';
      try {
        const rewardResult = await awardTournamentRewardPoints(tournament.id);
        if (rewardResult.awarded > 0 || rewardResult.skipped > 0 || rewardResult.errors > 0) {
          rewardInfo = `\n\n🏆 Rewards: ${rewardResult.awarded} atribuídos, ${rewardResult.skipped} saltados, ${rewardResult.errors} erros`;
          if (rewardResult.details.length > 0) {
          }
        } else if (rewardResult.details.length > 0) {
          rewardInfo = `\n\nℹ️ Rewards: ${rewardResult.details[0]}`;
        }
      } catch (rewardErr) {
        console.error('[FINALIZE] Error awarding rewards:', rewardErr);
        rewardInfo = '\n\n⚠️ Erro ao atribuir rewards';
      }

      // 6. Refresh data
      await fetchTournamentData();
      setCurrentTournament({ ...currentTournament, status: 'completed' });
      
      alert(`Torneio finalizado com sucesso!${ratingInfo}${rewardInfo}`);
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
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold text-gray-900">{currentTournament.name}</h2>
                {(currentTournament as any).visibility === 'invite_only' && (
                  <span className="px-2.5 py-1 text-xs font-semibold bg-amber-100 text-amber-700 rounded-full">
                    🔒 {t.tournament?.visibilityInviteOnly || 'Por Convite'}
                  </span>
                )}
              </div>
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
            {(currentTournament.status === 'active' || currentTournament.status === 'in_progress') &&
              (currentTournament as any).visibility !== 'invite_only' &&
              (currentTournament as any).allow_public_registration !== false && (
              <button
                onClick={handleResendTournamentAlert}
                disabled={notifySending}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition disabled:opacity-60"
                title="Reenviar alerta push (filtra por nível das categorias)"
              >
                <Bell className="w-4 h-4" />
                {notifySending ? 'A enviar...' : 'Reenviar Alerta'}
              </button>
            )}
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
            {(currentTournament as any).visibility === 'invite_only' && (
              <button
                onClick={() => setShowManageInvites(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 transition"
              >
                <Mail className="w-4 h-4" />
                {t.tournament?.manageInvites || 'Gerir Convites'}
              </button>
            )}
            {currentTournament.status !== 'completed' && (
              <button
                onClick={handleFinalizeTournament}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
              >
                <Trophy className="w-4 h-4" />
                Finalizar Torneio
              </button>
            )}
            {currentTournament.status === 'completed' && (
              <button
                onClick={async () => {
                  if (!confirm('Reprocessar ratings e rewards para todos os jogos deste torneio?')) return;
                  setLoading(true);
                  try {
                    // Reverte com segurança o delta de cada jogo (via histórico)
                    // antes de o reaplicar — evita duplicar/corromper nível,
                    // jogos e V/D a cada clique em "Reprocessar".
                    const ratingResult = await reprocessTournamentRatings(tournament.id);
                    const rewardResult = await awardTournamentRewardPoints(tournament.id);

                    let msg = `📊 Ratings: ${ratingResult.processed} processados, ${ratingResult.skipped} saltados, ${ratingResult.blocked} bloqueados (sem histórico p/ reverter em segurança), ${ratingResult.errors} erros`;
                    msg += `\n🏆 Rewards: ${rewardResult.awarded} atribuídos, ${rewardResult.skipped} saltados, ${rewardResult.errors} erros`;
                    if (rewardResult.details.length > 0) {
                      msg += '\n\nDetalhes:\n' + rewardResult.details.join('\n');
                    }
                    alert(msg);
                  } catch (err) {
                    console.error('[REPROCESS] Error:', err);
                    alert('Erro ao reprocessar. Ver consola para detalhes.');
                  } finally {
                    setLoading(false);
                  }
                }}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition"
              >
                <Award className="w-4 h-4" />
                Reprocessar Ratings & Rewards
              </button>
            )}
          </div>
        </div>
      </div>

      {currentTournament.format === 'ladder' && (
        <div className="bg-white rounded-xl shadow-lg p-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowManageCategories(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition"
          >
            <FolderTree className="w-4 h-4" />
            {categories.length > 0 ? t.nav.manageCategories : t.category.add}
          </button>
        </div>
      )}

      {currentTournament.format === 'ladder' ? (
        <LadderTournamentView
          key={categories.map((c) => c.id).sort().join(',')}
          tournament={currentTournament}
          onBack={onBack}
          embedded
        />
      ) : (
      <>
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
                      onClick={() => setShowAddSuperTeam(true)}
                      className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                    >
                      <Plus className="w-4 h-4" />
                      Adicionar Equipa
                    </button>
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
                {/* Equipas sem categoria */}
                {(() => {
                  const uncategorized = filteredSuperTeams.filter(st => !st.category_id);
                  if (uncategorized.length === 0) return null;
                  const byGroup = uncategorized.reduce<Record<string, SuperTeamRow[]>>((acc, st) => {
                    const g = st.group_name || 'Sem grupo';
                    if (!acc[g]) acc[g] = [];
                    acc[g].push(st);
                    return acc;
                  }, {});
                  return (
                    <div className="rounded-xl overflow-hidden border border-gray-200">
                      <div className="px-4 py-2 bg-gray-500 text-white font-semibold text-center">
                        Sem categoria ({uncategorized.length} equipas)
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
                })()}
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

              {/* Resumo de Jantares */}
              {(currentTournament as any).has_dinner_option && (() => {
                const allPlayers = isIndividualFormat() 
                  ? filteredIndividualPlayers 
                  : filteredTeams.flatMap(t => [t.player1, t.player2].filter(Boolean));
                const dinnerCount = allPlayers.filter((p: any) => p?.wants_dinner).length;
                const totalCount = allPlayers.length;
                return dinnerCount > 0 || totalCount > 0 ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center gap-3">
                    <span className="text-2xl">🍽️</span>
                    <div>
                      <p className="font-semibold text-amber-900">
                        Jantares: {dinnerCount} de {totalCount} jogadores
                      </p>
                      <p className="text-sm text-amber-700">
                        {dinnerCount === 0 ? 'Nenhum jogador quer jantar' : `${dinnerCount} jogador${dinnerCount > 1 ? 'es' : ''} confirmado${dinnerCount > 1 ? 's' : ''} para jantar`}
                      </p>
                    </div>
                  </div>
                ) : null;
              })()}

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
                                {(player as any).seed ? (player as any).seed : player.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 truncate">
                                  {(player as any).seed ? <span className="text-xs text-blue-500 mr-1">CS{(player as any).seed}</span> : null}
                                  {player.name}
                                  {(player as any).wants_dinner && ' 🍽️'}
                                </p>
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
                              {(() => {
                                const phone = (player.phone_number || '').replace(/[\s\-\(\)\.]/g, '');
                                const lvl = phone ? playerLevelByPhone.get(phone) : undefined;
                                return lvl != null ? (
                                  <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full font-medium">
                                    Nv {lvl.toFixed(2)}
                                  </span>
                                ) : null;
                              })()}
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
                              {(player as any).wants_dinner && (
                                <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full">
                                  🍽️ Jantar
                                </span>
                              )}
                            </div>
                            {player.email && (
                              <p className="text-sm text-gray-500">{player.email}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <PlayerPriceBadge player={player} />
                          <PaymentToggleButton player={player} />
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
                              <div key={team.id} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg gap-2">
                                <div className="min-w-0">
                                  <p className="font-semibold text-gray-900">
                                    {team.seed != null && Number(team.seed) > 0 && (
                                      <span className="text-xs text-blue-500 mr-1.5 font-semibold">CS{team.seed}</span>
                                    )}
                                    {team.name}
                                    {(team as any).registration_source === 'partner_match' && (
                                      <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-violet-100 text-violet-700 rounded-full font-medium align-middle">Via parceiro</span>
                                    )}
                                  </p>
                                  <p className="text-sm text-gray-600">
                                    {team.player1?.name}
                                    {(() => { const ph = ((team.player1 as any)?.phone_number || '').replace(/[\s\-\(\)\.]/g, ''); const l = ph ? playerLevelByPhone.get(ph) : undefined; return l != null ? <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded-full font-medium">Nv {l.toFixed(2)}</span> : null; })()}
                                    {' / '}
                                    {team.player2?.name}
                                    {(() => { const ph = ((team.player2 as any)?.phone_number || '').replace(/[\s\-\(\)\.]/g, ''); const l = ph ? playerLevelByPhone.get(ph) : undefined; return l != null ? <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded-full font-medium">Nv {l.toFixed(2)}</span> : null; })()}
                                  </p>
                                  <PartnerTeamReviewBadges team={team} />
                                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                    <div className="flex items-center gap-1">
                                      <PlayerPriceBadge player={team.player1} />
                                      <PaymentToggleButton player={team.player1} />
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <PlayerPriceBadge player={team.player2} />
                                      <PaymentToggleButton player={team.player2} />
                                    </div>
                                  </div>
                                </div>
                                <button
                                  onClick={() => {
                                    setSelectedTeam(team);
                                    setShowEditTeam(true);
                                  }}
                                  className="p-1 hover:bg-gray-100 rounded transition flex-shrink-0"
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
                            <p className="font-semibold text-gray-900">
                              {team.seed != null && Number(team.seed) > 0 && (
                                <span className="text-xs text-blue-500 mr-1.5 font-semibold">CS{team.seed}</span>
                              )}
                              {team.name}
                              {(team as any).registration_source === 'partner_match' && (
                                <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-violet-100 text-violet-700 rounded-full font-medium align-middle">Via parceiro</span>
                              )}
                            </p>
                            <p className="text-sm text-gray-600">
                              {team.player1?.name}
                              {(() => { const ph = ((team.player1 as any)?.phone_number || '').replace(/[\s\-\(\)\.]/g, ''); const l = ph ? playerLevelByPhone.get(ph) : undefined; return l != null ? <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded-full font-medium">Nv {l.toFixed(2)}</span> : null; })()}
                              {(team.player1 as any)?.wants_dinner ? ' 🍽️' : ''}
                              {' / '}
                              {team.player2?.name}
                              {(() => { const ph = ((team.player2 as any)?.phone_number || '').replace(/[\s\-\(\)\.]/g, ''); const l = ph ? playerLevelByPhone.get(ph) : undefined; return l != null ? <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded-full font-medium">Nv {l.toFixed(2)}</span> : null; })()}
                              {(team.player2 as any)?.wants_dinner ? ' 🍽️' : ''}
                            </p>
                            <PartnerTeamReviewBadges team={team} />
                            <div className="flex items-center gap-2 flex-wrap mt-1">
                              {team.group_name && (
                                <span className="text-xs text-blue-600">Grupo {team.group_name}</span>
                              )}
                              {((team.player1 as any)?.wants_dinner || (team.player2 as any)?.wants_dinner) && (
                                <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full">
                                  🍽️ {[(team.player1 as any)?.wants_dinner && team.player1?.name, (team.player2 as any)?.wants_dinner && team.player2?.name].filter(Boolean).join(', ')}
                                </span>
                              )}
                              <div className="flex items-center gap-1">
                                <PlayerPriceBadge player={team.player1} />
                                <PaymentToggleButton player={team.player1} />
                              </div>
                              <div className="flex items-center gap-1">
                                <PlayerPriceBadge player={team.player2} />
                                <PaymentToggleButton player={team.player2} />
                              </div>
                            </div>
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
                        '5th_semi': 'Semi 5º/8º',
                        'semi_final': 'Meia-Final',
                        '3rd_place': '3º Lugar',
                        '5th_place': '5º Lugar',
                        '7th_place': '7º Lugar',
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
                <div className="flex items-center gap-4">
                  <h3 className="text-lg font-semibold">Jogos</h3>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-gray-500" />
                    <select
                      value={currentTournament.match_duration_minutes || 30}
                      onChange={async (e) => {
                        const val = parseInt(e.target.value);
                        const updated = { ...currentTournament, match_duration_minutes: val };
                        setCurrentTournament(updated);
                        await supabase.from('tournaments').update({ match_duration_minutes: val }).eq('id', currentTournament.id);
                      }}
                      className="text-sm border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      {Array.from({ length: 13 }, (_, i) => i + 8).map((min) => (
                        <option key={min} value={min}>{min} min</option>
                      ))}
                      {Array.from({ length: 20 }, (_, i) => 25 + i * 5).map((min) => (
                        <option key={min} value={min}>{min} min</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {isSwissTeams ? (
                    (() => {
                      const maxRounds = clampSwissRounds(
                        (categories[0] as any)?.swiss_rounds ?? (currentTournament as any).swiss_rounds
                      );
                      const highest = getHighestSwissRound(matches);
                      const canGenerate =
                        highest < maxRounds &&
                        (highest === 0 || isSwissRoundComplete(matches, highest));
                      const label =
                        highest === 0
                          ? t.tournament.generateSwissRound1
                          : t.tournament.generateSwissNextRound;
                      return (
                        <button
                          onClick={handleGenerateSwissRound}
                          disabled={loading || !canGenerate}
                          title={
                            highest >= maxRounds
                              ? t.tournament.swissMaxRoundsReached
                              : highest > 0 && !isSwissRoundComplete(matches, highest)
                                ? t.tournament.swissRoundCompleteHint
                                : undefined
                          }
                          className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                        >
                          <Calendar className="w-4 h-4" />
                          {label}
                          {highest > 0 && (
                            <span className="text-xs opacity-80">
                              ({highest}/{maxRounds})
                            </span>
                          )}
                        </button>
                      );
                    })()
                  ) : (
                    <button
                      onClick={handleGenerateSchedule}
                      className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                    >
                      <Calendar className="w-4 h-4" />
                      Gerar Calendário
                    </button>
                  )}
                  
                  {filteredMatches.length > 0 && (
                    <>
                      <button
                        onClick={handleClearAllResults}
                        className="flex items-center gap-2 px-3 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Limpar Resultados
                      </button>
                      <button
                        onClick={handleDeleteAllMatches}
                        className="flex items-center gap-2 px-3 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                        Eliminar Todos
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Lista de jogos */}
              {filteredMatches.length > 0 ? (
                <MatchScheduleView
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
                  onScheduleUpdate={() => fetchTournamentData(true)}
                  onViewModeChange={setIsMatchGridView}
                  controlledSortBy={matchViewSortBy}
                  onSortByChange={setMatchViewSortBy}
                  matchDurationMinutes={currentTournament.match_duration_minutes || 30}
                  dayStartTime={currentTournament.start_time || '09:00'}
                  outdoorCourtKeys={outdoorCourtKeys}
                  outdoorCountMatches={matches as MatchWithTeams[]}
                />
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <CalendarClock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Ainda não há jogos agendados</p>
                  <p className="text-sm mt-2">
                    {isSwissTeams
                      ? 'Clique em "Gerar ronda 1" para criar os primeiros confrontos'
                      : 'Clique em "Gerar Calendário" para criar os jogos automaticamente'}
                  </p>
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
              format={resolvedFormat}
              categoryId={selectedCategory}
              roundRobinType={resolvedRoundRobinType}
              refreshKey={refreshKey}
              {...(() => {
                const actualGroups = new Set(
                  filteredIndividualPlayers.map(p => p.group_name).filter(Boolean)
                ).size || currentTournament.number_of_groups || 2;
                const koStage = (currentTournament as any).knockout_stage || 'semifinals';
                const cfg = calculateQualificationConfig(actualGroups, koStage, isIndividualFormat());
                return {
                  qualifiedPerGroup: cfg.qualifiedPerGroup,
                  extraBestNeeded: cfg.extraBestNeeded,
                };
              })()}
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
                                    // Quartos: A1-B4, A3-B2, A2-B3, A4-B1
                                    // (se favoritos ganharem → SF: A1 vs B2 e A2 vs B1)
                                    const A = byGroup[groupNames[0]] || [];
                                    const B = byGroup[groupNames[1]] || [];
                                    
                                    if (A.length >= 4 && B.length >= 4) {
                                      await supabase.from('super_team_confrontations').update({
                                        super_team_1_id: A[0].super_team_id,
                                        super_team_2_id: B[3].super_team_id,
                                      }).eq('id', quarterFinals[0].id);
                                      
                                      await supabase.from('super_team_confrontations').update({
                                        super_team_1_id: A[2].super_team_id,
                                        super_team_2_id: B[1].super_team_id,
                                      }).eq('id', quarterFinals[1].id);
                                      
                                      await supabase.from('super_team_confrontations').update({
                                        super_team_1_id: A[1].super_team_id,
                                        super_team_2_id: B[2].super_team_id,
                                      }).eq('id', quarterFinals[2].id);
                                      
                                      await supabase.from('super_team_confrontations').update({
                                        super_team_1_id: A[3].super_team_id,
                                        super_team_2_id: B[0].super_team_id,
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
                              {['quarter_final', '5th_semi', 'semi_final', '3rd_place', 'third_place', '5th_place', '7th_place', 'final'].map(roundType => {
                                const roundConfronts = catConfrontations.filter(c => c.round === roundType);
                                if (roundConfronts.length === 0) return null;
                                const roundLabels: Record<string, string> = {
                                  'quarter_final': 'Quartos de Final',
                                  '5th_semi': 'Semi 5º/8º',
                                  'semi_final': 'Meias-Finais',
                                  '3rd_place': '3º Lugar',
                                  'third_place': '3º Lugar',
                                  '5th_place': '5º Lugar',
                                  '7th_place': '7º Lugar',
                                  'final': 'Final'
                                };
                                const roundColors: Record<string, string> = {
                                  'quarter_final': 'bg-purple-100 border-purple-300',
                                  '5th_semi': 'bg-indigo-100 border-indigo-300',
                                  'semi_final': 'bg-orange-100 border-orange-300',
                                  '3rd_place': 'bg-amber-100 border-amber-300',
                                  'third_place': 'bg-amber-100 border-amber-300',
                                  '5th_place': 'bg-teal-100 border-teal-300',
                                  '7th_place': 'bg-slate-100 border-slate-300',
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
              tournamentFormat={resolvedFormat}
            />
            )
          )}
        </div>
      </div>

      </>
      )}

      {/* Modals */}
      {showAddTeam && (
        <AddTeamModal
          tournamentId={tournament.id}
          lockedCategoryId={
            selectedCategory && selectedCategory !== 'no-category'
              ? selectedCategory
              : undefined
          }
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
          tournament={currentTournament}
          matchId={selectedMatchId}
          onClose={() => {
            setShowMatchModal(false);
            setSelectedMatchId(undefined);
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
          isIndependentOrganizer={!(currentTournament as any).club_id}
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

      {isSuperTeams && showAddSuperTeam && (
        <AddSuperTeamModal
          tournamentId={currentTournament.id}
          categories={categories}
          selectedCategory={selectedCategory}
          onClose={() => setShowAddSuperTeam(false)}
          onSuccess={() => {
            setShowAddSuperTeam(false);
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
          teams={teams}
          players={individualPlayers}
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

      {showManageInvites && (
        <ManageInvitesModal
          tournamentId={currentTournament.id}
          tournamentName={currentTournament.name}
          onClose={() => setShowManageInvites(false)}
        />
      )}
    </div>
  );
}
