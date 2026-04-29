import { useState, useEffect, useRef } from 'react';
import { supabase, Team, Player, IndividualPlayer } from '../lib/supabase';
import { X, RotateCcw, Pencil, Check } from 'lucide-react';
import { rescheduleRemainingMatches } from '../lib/reschedule';
import { calculateIndividualFinalPositions, clearIndividualFinalPositions } from '../lib/leagueStandings';
import { advanceKnockoutWinner, populatePlacementMatches, populateTeamPlacementMatches } from '../lib/groups';
import { processMatchRating } from '../lib/ratingEngine';
import { useI18n } from '../lib/i18nContext';

async function advanceWinnerToNextRound(
  tournamentId: string,
  currentRound: string,
  currentMatchNumber: number,
  winnerId: string,
  categoryId: string | null
) {
  const roundOrder = ['round_of_16', 'quarter_final', 'semi_final', 'final'];
  const currentRoundIndex = roundOrder.indexOf(currentRound);

  if (currentRoundIndex === -1 || currentRoundIndex === roundOrder.length - 1) {
    return;
  }

  const nextRound = roundOrder[currentRoundIndex + 1];

  let currentRoundQuery = supabase
    .from('matches')
    .select('id, match_number')
    .eq('tournament_id', tournamentId)
    .eq('round', currentRound)
    .order('match_number', { ascending: true });

  if (categoryId) {
    currentRoundQuery = currentRoundQuery.eq('category_id', categoryId);
  } else {
    currentRoundQuery = currentRoundQuery.is('category_id', null);
  }

  const { data: currentRoundMatches } = await currentRoundQuery;

  if (!currentRoundMatches || currentRoundMatches.length === 0) {
    return;
  }

  const matchPosition = currentRoundMatches.findIndex(m => m.match_number === currentMatchNumber);
  if (matchPosition === -1) {
    return;
  }

  const nextMatchPosition = Math.floor(matchPosition / 2);

  let nextRoundQuery = supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('round', nextRound)
    .order('match_number', { ascending: true });

  if (categoryId) {
    nextRoundQuery = nextRoundQuery.eq('category_id', categoryId);
  } else {
    nextRoundQuery = nextRoundQuery.is('category_id', null);
  }

  const { data: nextRoundMatches } = await nextRoundQuery;

  if (!nextRoundMatches || nextRoundMatches.length === 0 || nextMatchPosition >= nextRoundMatches.length) {
    return;
  }

  const nextMatch = nextRoundMatches[nextMatchPosition];
  const isFirstSlot = matchPosition % 2 === 0;
  const updateField = isFirstSlot ? 'team1_id' : 'team2_id';

  console.log(`[ADVANCE] Match ${currentMatchNumber} (position ${matchPosition}) -> next match position ${nextMatchPosition}, slot: ${updateField}`);

  await supabase
    .from('matches')
    .update({ [updateField]: winnerId })
    .eq('id', nextMatch.id);
}

async function advanceLoserToClassificationRound(
  tournamentId: string,
  currentRound: string,
  currentMatchNumber: number,
  loserId: string,
  categoryId: string | null
) {
  const classificationMapping: Record<string, string> = {
    'semi_final': '3rd_place',
    'quarter_final': '5th_semi',
    '5th_semi': '7th_place',
  };

  const classificationRound = classificationMapping[currentRound];
  if (!classificationRound) {
    return;
  }

  let currentRoundQuery = supabase
    .from('matches')
    .select('id, match_number')
    .eq('tournament_id', tournamentId)
    .eq('round', currentRound)
    .order('match_number', { ascending: true });

  if (categoryId) {
    currentRoundQuery = currentRoundQuery.eq('category_id', categoryId);
  } else {
    currentRoundQuery = currentRoundQuery.is('category_id', null);
  }

  const { data: currentRoundMatches } = await currentRoundQuery;

  if (!currentRoundMatches || currentRoundMatches.length === 0) {
    return;
  }

  const matchPosition = currentRoundMatches.findIndex(m => m.match_number === currentMatchNumber);
  if (matchPosition === -1) {
    return;
  }

  let classificationQuery = supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('round', classificationRound)
    .order('match_number', { ascending: true });

  if (categoryId) {
    classificationQuery = classificationQuery.eq('category_id', categoryId);
  } else {
    classificationQuery = classificationQuery.is('category_id', null);
  }

  const { data: classificationMatches } = await classificationQuery;

  if (!classificationMatches || classificationMatches.length === 0) {
    return;
  }

  if (classificationRound === '3rd_place') {
    const match = classificationMatches[0];
    const updateField = !match.team1_id ? 'team1_id' : 'team2_id';
    console.log(`[CLASSIFICATION] Loser from ${currentRound} match ${currentMatchNumber} -> ${classificationRound}, slot: ${updateField}`);
    await supabase
      .from('matches')
      .update({ [updateField]: loserId })
      .eq('id', match.id);
  } else if (classificationRound === '5th_semi') {
    // QF losers: pair QF1 loser vs QF2 loser -> 5th_semi #1, QF3 loser vs QF4 loser -> 5th_semi #2
    const nextMatchPosition = Math.floor(matchPosition / 2);
    if (nextMatchPosition >= classificationMatches.length) return;
    const classificationMatch = classificationMatches[nextMatchPosition];
    const isFirstSlot = matchPosition % 2 === 0;
    const updateField = isFirstSlot ? 'team1_id' : 'team2_id';
    console.log(`[CLASSIFICATION] QF loser from match ${currentMatchNumber} (pos ${matchPosition}) -> 5th_semi[${nextMatchPosition}], slot: ${updateField}`);
    await supabase
      .from('matches')
      .update({ [updateField]: loserId })
      .eq('id', classificationMatch.id);
  } else {
    const nextMatchPosition = Math.floor(matchPosition / 2);
    if (nextMatchPosition >= classificationMatches.length) {
      return;
    }
    const classificationMatch = classificationMatches[nextMatchPosition];
    const isFirstSlot = matchPosition % 2 === 0;
    const updateField = isFirstSlot ? 'team1_id' : 'team2_id';
    console.log(`[CLASSIFICATION] Loser from ${currentRound} match ${currentMatchNumber} (position ${matchPosition}) -> ${classificationRound} position ${nextMatchPosition}, slot: ${updateField}`);
    await supabase
      .from('matches')
      .update({ [updateField]: loserId })
      .eq('id', classificationMatch.id);
  }
}

async function advanceClassificationWinner(
  tournamentId: string,
  currentRound: string,
  currentMatchNumber: number,
  winnerId: string,
  categoryId: string | null
) {
  const winnerMapping: Record<string, string> = {
    '5th_semi': '5th_place',
  };

  const nextRound = winnerMapping[currentRound];
  if (!nextRound) {
    return;
  }

  let nextRoundQuery = supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('round', nextRound)
    .order('match_number', { ascending: true });

  if (categoryId) {
    nextRoundQuery = nextRoundQuery.eq('category_id', categoryId);
  } else {
    nextRoundQuery = nextRoundQuery.is('category_id', null);
  }

  const { data: nextMatches } = await nextRoundQuery;

  if (!nextMatches || nextMatches.length === 0) {
    return;
  }

  const match = nextMatches[0];
  const updateField = !match.team1_id ? 'team1_id' : 'team2_id';
  console.log(`[CLASSIFICATION] Winner from ${currentRound} match ${currentMatchNumber} -> ${nextRound}, slot: ${updateField}`);
  await supabase
    .from('matches')
    .update({ [updateField]: winnerId })
    .eq('id', match.id);

}

// ================================================================
// CROSSED PLAYOFFS TEAMS - Progression Logic
// Handles advancing winners/losers through: QF → SF → Final/3rd/5th/7th
// ================================================================
async function advanceCrossedPlayoffTeam(
  tournamentId: string,
  completedRound: string,
  winnerId: string,
  loserId: string
) {
  // Determine round type: crossed_r1_jN (QF), crossed_r2_jN (SF)
  const r1Match = completedRound.match(/^crossed_r1_j(\d+)$/);
  const r2Match = completedRound.match(/^crossed_r2_j(\d+)$/);

  if (r1Match) {
    // QUARTERFINAL completed - advance winner to semifinal, loser to classification
    const qfNumber = parseInt(r1Match[1]); // 1, 2, 3, or 4
    
    // QF1 winner → SF1 team1, QF2 winner → SF1 team2
    // QF3 winner → SF2 team1, QF4 winner → SF2 team2
    const sfNumber = qfNumber <= 2 ? 1 : 2;
    const sfSlot = qfNumber % 2 === 1 ? 'team1_id' : 'team2_id';
    const sfRound = `crossed_r2_j${sfNumber}`;
    
    console.log(`[CROSSED-ADVANCE] QF${qfNumber} winner → ${sfRound} ${sfSlot}`);
    
    // Find and update the semifinal match
    const { data: sfMatch } = await supabase
      .from('matches')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('round', sfRound)
      .is('category_id', null)
      .maybeSingle();
    
    if (sfMatch) {
      await supabase
        .from('matches')
        .update({ [sfSlot]: winnerId })
        .eq('id', sfMatch.id);
      console.log(`[CROSSED-ADVANCE] Updated ${sfRound} ${sfSlot} with winner`);
    }
    
    // Losers of QF go to classification:
    // L(QF1) → 5-6 team1, L(QF2) → 5-6 team2
    // L(QF3) → 7-8 team1, L(QF4) → 7-8 team2
    const classRound = qfNumber <= 2 ? 'crossed_r4_5th' : 'crossed_r5_7th';
    const classSlot = qfNumber % 2 === 1 ? 'team1_id' : 'team2_id';
    
    console.log(`[CROSSED-ADVANCE] QF${qfNumber} loser → ${classRound} ${classSlot}`);
    
    const { data: classMatch } = await supabase
      .from('matches')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('round', classRound)
      .is('category_id', null)
      .maybeSingle();
    
    if (classMatch) {
      await supabase
        .from('matches')
        .update({ [classSlot]: loserId })
        .eq('id', classMatch.id);
      console.log(`[CROSSED-ADVANCE] Updated ${classRound} ${classSlot} with loser`);
    }
    
  } else if (r2Match) {
    // SEMIFINAL completed - advance winner to final, loser to 3rd place
    const sfNumber = parseInt(r2Match[1]); // 1 or 2
    
    // SF1 winner → Final team1, SF2 winner → Final team2
    const finalSlot = sfNumber === 1 ? 'team1_id' : 'team2_id';
    
    console.log(`[CROSSED-ADVANCE] SF${sfNumber} winner → crossed_r3_final ${finalSlot}`);
    
    const { data: finalMatch } = await supabase
      .from('matches')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('round', 'crossed_r3_final')
      .is('category_id', null)
      .maybeSingle();
    
    if (finalMatch) {
      await supabase
        .from('matches')
        .update({ [finalSlot]: winnerId })
        .eq('id', finalMatch.id);
      console.log(`[CROSSED-ADVANCE] Updated final ${finalSlot} with winner`);
    }
    
    // SF loser → 3rd place
    const thirdSlot = sfNumber === 1 ? 'team1_id' : 'team2_id';
    
    console.log(`[CROSSED-ADVANCE] SF${sfNumber} loser → crossed_r3_3rd_place ${thirdSlot}`);
    
    const { data: thirdMatch } = await supabase
      .from('matches')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('round', 'crossed_r3_3rd_place')
      .is('category_id', null)
      .maybeSingle();
    
    if (thirdMatch) {
      await supabase
        .from('matches')
        .update({ [thirdSlot]: loserId })
        .eq('id', thirdMatch.id);
      console.log(`[CROSSED-ADVANCE] Updated 3rd place ${thirdSlot} with loser`);
    }
  }
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const PLACEMENT_TIER_CONFIG: Array<{
  semifinalRound: string;
  finalRound: string;
  thirdPlaceRound: string;
}> = [
  { semifinalRound: '1st_semifinal', finalRound: 'final', thirdPlaceRound: '3rd_place' },
  { semifinalRound: '13th_semifinal', finalRound: '13th_place', thirdPlaceRound: '15th_place' },
  { semifinalRound: '17th_semifinal', finalRound: '17th_place', thirdPlaceRound: '19th_place' },
  { semifinalRound: '21st_semifinal', finalRound: '21st_place', thirdPlaceRound: '23rd_place' },
];

function getMatchWinnerPlayers(match: any): string[] {
  const team1Score = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
  const team2Score = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);

  if (team1Score === 0 && team2Score === 0) return [];

  if (team1Score > team2Score) {
    return [match.player1_individual_id, match.player2_individual_id].filter(Boolean);
  } else {
    return [match.player3_individual_id, match.player4_individual_id].filter(Boolean);
  }
}

function getMatchLoserPlayers(match: any): string[] {
  const team1Score = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
  const team2Score = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);

  if (team1Score === 0 && team2Score === 0) return [];

  if (team1Score < team2Score) {
    return [match.player1_individual_id, match.player2_individual_id].filter(Boolean);
  } else {
    return [match.player3_individual_id, match.player4_individual_id].filter(Boolean);
  }
}

async function populateTierFinals(
  tournamentId: string,
  categoryId: string | null,
  semifinalRound: string,
  finalRound: string,
  thirdPlaceRound: string
) {
  let semifinalQuery = supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('round', semifinalRound)
    .eq('status', 'completed');

  if (categoryId) {
    semifinalQuery = semifinalQuery.eq('category_id', categoryId);
  } else {
    semifinalQuery = semifinalQuery.is('category_id', null);
  }

  const { data: semifinalMatches } = await semifinalQuery;

  if (!semifinalMatches || semifinalMatches.length !== 2) {
    console.log(`[MATCH_MODAL] Not enough ${semifinalRound} matches completed (${semifinalMatches?.length || 0}/2)`);
    return;
  }

  const winners1 = getMatchWinnerPlayers(semifinalMatches[0]);
  const winners2 = getMatchWinnerPlayers(semifinalMatches[1]);
  const losers1 = getMatchLoserPlayers(semifinalMatches[0]);
  const losers2 = getMatchLoserPlayers(semifinalMatches[1]);

  console.log(`[MATCH_MODAL] ${semifinalRound} results:`, { winners1, winners2, losers1, losers2 });

  if (winners1.length > 0 && winners2.length > 0) {
    const allWinners = [...winners1, ...winners2];
    const shuffledWinners = shuffleArray(allWinners);
    console.log(`[MATCH_MODAL] Shuffled winners for ${finalRound}:`, shuffledWinners);

    let finalQuery = supabase
      .from('matches')
      .select('*')
      .eq('tournament_id', tournamentId)
      .eq('round', finalRound);

    if (categoryId) {
      finalQuery = finalQuery.eq('category_id', categoryId);
    } else {
      finalQuery = finalQuery.is('category_id', null);
    }

    const { data: finalMatch } = await finalQuery.maybeSingle();

    if (finalMatch && !finalMatch.player1_individual_id) {
      await supabase
        .from('matches')
        .update({
          player1_individual_id: shuffledWinners[0] || null,
          player2_individual_id: shuffledWinners[1] || null,
          player3_individual_id: shuffledWinners[2] || null,
          player4_individual_id: shuffledWinners[3] || null
        })
        .eq('id', finalMatch.id);

      console.log(`[MATCH_MODAL] Populated ${finalRound} match with shuffled winners`);
    }
  }

  if (losers1.length > 0 && losers2.length > 0) {
    const allLosers = [...losers1, ...losers2];
    const shuffledLosers = shuffleArray(allLosers);
    console.log(`[MATCH_MODAL] Shuffled losers for ${thirdPlaceRound}:`, shuffledLosers);

    let thirdPlaceQuery = supabase
      .from('matches')
      .select('*')
      .eq('tournament_id', tournamentId)
      .eq('round', thirdPlaceRound);

    if (categoryId) {
      thirdPlaceQuery = thirdPlaceQuery.eq('category_id', categoryId);
    } else {
      thirdPlaceQuery = thirdPlaceQuery.is('category_id', null);
    }

    const { data: thirdPlaceMatch } = await thirdPlaceQuery.maybeSingle();

    if (thirdPlaceMatch && !thirdPlaceMatch.player1_individual_id) {
      await supabase
        .from('matches')
        .update({
          player1_individual_id: shuffledLosers[0] || null,
          player2_individual_id: shuffledLosers[1] || null,
          player3_individual_id: shuffledLosers[2] || null,
          player4_individual_id: shuffledLosers[3] || null
        })
        .eq('id', thirdPlaceMatch.id);

      console.log(`[MATCH_MODAL] Populated ${thirdPlaceRound} match with shuffled losers`);
    }
  }
}

async function populateSemifinalAndPlacementMatches(
  tournamentId: string,
  categoryId: string | null,
  completedRound?: string
) {
  if (completedRound) {
    const tierConfig = PLACEMENT_TIER_CONFIG.find(t => t.semifinalRound === completedRound);
    if (tierConfig) {
      await populateTierFinals(
        tournamentId,
        categoryId,
        tierConfig.semifinalRound,
        tierConfig.finalRound,
        tierConfig.thirdPlaceRound
      );
      return;
    }
  }

  for (const tier of PLACEMENT_TIER_CONFIG) {
    await populateTierFinals(
      tournamentId,
      categoryId,
      tier.semifinalRound,
      tier.finalRound,
      tier.thirdPlaceRound
    );
  }
}

async function checkAndScheduleNextRound(
  tournamentId: string,
  currentRound: string,
  categoryId: string | null,
  tournament: any
) {
  if (currentRound !== 'quarter_final' && currentRound !== 'semi_final' && currentRound !== 'semifinal' && currentRound !== 'round_of_16') {
    return;
  }

  let query = supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('round', currentRound);

  if (categoryId) {
    query = query.eq('category_id', categoryId);
  } else {
    query = query.is('category_id', null);
  }

  const { data: currentRoundMatches } = await query;

  const allComplete = currentRoundMatches?.every(m => m.status === 'completed');

  if (!allComplete) {
    return;
  }

  const nextRound = currentRound === 'round_of_16' ? 'quarter_final' : currentRound === 'quarter_final' ? 'semi_final' : 'final';

  let existingQuery = supabase
    .from('matches')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('round', nextRound)
    .limit(1);

  if (categoryId) {
    existingQuery = existingQuery.eq('category_id', categoryId);
  } else {
    existingQuery = existingQuery.is('category_id', null);
  }

  const { data: existingNextRound } = await existingQuery;

  if (existingNextRound && existingNextRound.length > 0) {
    return;
  }

  const lastMatch = currentRoundMatches
    ?.sort((a, b) => new Date(b.scheduled_time).getTime() - new Date(a.scheduled_time).getTime())[0];

  if (!lastMatch) return;

  const matchDuration = tournament.match_duration_minutes || 15;
  const numberOfCourts = tournament.number_of_courts || 1;
  const numberOfMatches = nextRound === 'final' ? 1 : nextRound === 'semi_final' ? 2 : 4;

  const lastMatchDate = new Date(lastMatch.scheduled_time);
  lastMatchDate.setMinutes(lastMatchDate.getMinutes() + matchDuration);

  const { data: allMatches } = await supabase
    .from('matches')
    .select('scheduled_time, court')
    .eq('tournament_id', tournamentId)
    .gte('scheduled_time', lastMatchDate.toISOString())
    .order('scheduled_time', { ascending: true });

  const matchesToCreate = [];
  let matchesScheduled = 0;

  while (matchesScheduled < numberOfMatches) {
    const occupiedCourts = new Set(
      (allMatches || [])
        .concat(matchesToCreate)
        .filter(m => {
          const mTime = new Date(m.scheduled_time);
          const targetTime = lastMatchDate;
          return Math.abs(mTime.getTime() - targetTime.getTime()) < 60000;
        })
        .map(m => m.court)
    );

    const availableCourts = [];
    for (let c = 1; c <= numberOfCourts; c++) {
      if (!occupiedCourts.has(c.toString())) {
        availableCourts.push(c);
      }
    }

    if (availableCourts.length === 0) {
      lastMatchDate.setMinutes(lastMatchDate.getMinutes() + matchDuration);
      continue;
    }

    const courtsToUse = Math.min(availableCourts.length, numberOfMatches - matchesScheduled);

    for (let i = 0; i < courtsToUse; i++) {
      matchesToCreate.push({
        tournament_id: tournamentId,
        category_id: categoryId,
        round: nextRound,
        match_number: matchesScheduled + 1,
        team1_id: null,
        team2_id: null,
        scheduled_time: lastMatchDate.toISOString(),
        court: availableCourts[i].toString(),
        status: 'scheduled',
        team1_score_set1: 0,
        team2_score_set1: 0,
        team1_score_set2: 0,
        team2_score_set2: 0,
        team1_score_set3: 0,
        team2_score_set3: 0,
      });
      matchesScheduled++;
    }

    if (matchesScheduled < numberOfMatches) {
      lastMatchDate.setMinutes(lastMatchDate.getMinutes() + matchDuration);
    }
  }

  await supabase.from('matches').insert(matchesToCreate);

  for (const match of currentRoundMatches || []) {
    if (match.winner_id) {
      await advanceWinnerToNextRound(
        tournamentId,
        currentRound,
        match.match_number,
        match.winner_id,
        match.category_id
      );
    }
  }
}

type MatchModalProps = {
  tournamentId: string;
  tournament?: any;
  matchId?: string;
  onClose: () => void;
  onSuccess: () => void;
  isIndividualRoundRobin?: boolean;
  individualPlayers?: IndividualPlayer[];
};

type TeamWithPlayers = Team & {
  player1: Player;
  player2: Player;
};

export default function MatchModal({ tournamentId, tournament, matchId, onClose, onSuccess, isIndividualRoundRobin = false, individualPlayers = [] }: MatchModalProps) {
  const { t } = useI18n();
  const [teams, setTeams] = useState<TeamWithPlayers[]>([]);
  const [matchData, setMatchData] = useState<any>(null);
  const [formData, setFormData] = useState({
    team1_id: '',
    team2_id: '',
    round: 'group_stage',
    match_number: 1,
    scheduled_time: '',
    court: '',
    team1_score_set1: 0,
    team2_score_set1: 0,
    team1_score_set2: 0,
    team2_score_set2: 0,
    team1_score_set3: 0,
    team2_score_set3: 0,
    status: 'scheduled' as const,
  });
  const [editingPlayers, setEditingPlayers] = useState<{
    player1_individual_id: string;
    player2_individual_id: string;
    player3_individual_id: string;
    player4_individual_id: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Snapshot of the schedule fields as they were when the modal opened.
  // Used to avoid re-writing scheduled_time / court when the user only changed
  // the score: re-writing them turns the timezone-less datetime-local string
  // back into ISO and was shifting matches across time slots / courts.
  const matchData_initial = useRef<{ scheduled_time: string; court: string }>({
    scheduled_time: '',
    court: '',
  });

  useEffect(() => {
    const loadData = async () => {
      await fetchTeams();
      if (matchId) {
        await fetchMatch();
      }
    };
    loadData();
  }, [tournamentId, matchId]);

  const fetchTeams = async () => {
    console.log('[MatchModal] Fetching teams for tournament:', tournamentId);
    const { data, error } = await supabase
      .from('teams')
      .select('*, player1:players!teams_player1_id_fkey(*), player2:players!teams_player2_id_fkey(*)')
      .eq('tournament_id', tournamentId);

    console.log('[MatchModal] Teams fetch result:', { data, error, count: data?.length });
    if (error) {
      console.error('[MatchModal] Teams fetch error:', error);
    }
    if (data) {
      setTeams(data as unknown as TeamWithPlayers[]);
    }
  };

  const fetchMatch = async () => {
    if (!matchId) return;

    console.log('[MatchModal] Fetching match:', matchId);
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    console.log('[MatchModal] Match fetch result:', { data, error, team1_id: data?.team1_id, team2_id: data?.team2_id });
    if (error) {
      console.error('[MatchModal] Match fetch error:', error);
    }
    if (data) {
      setMatchData(data);
      // CRITICAL: <input type="datetime-local"> uses LOCAL timezone.
      // Using toISOString().slice(0,16) keeps the value in UTC, which then
      // gets re-interpreted as local on submit and shifts the match by the
      // local UTC offset (-1h or -2h depending on DST) every save.
      const toLocalInput = (iso: string): string => {
        const d = new Date(iso);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      const initialScheduled = data.scheduled_time ? toLocalInput(data.scheduled_time) : '';
      const initialCourt = data.court || '';
      matchData_initial.current = {
        scheduled_time: initialScheduled,
        court: initialCourt,
      };
      setFormData({
        team1_id: data.team1_id || '',
        team2_id: data.team2_id || '',
        round: data.round,
        match_number: data.match_number,
        scheduled_time: initialScheduled,
        court: initialCourt,
        team1_score_set1: data.team1_score_set1,
        team2_score_set1: data.team2_score_set1,
        team1_score_set2: data.team1_score_set2,
        team2_score_set2: data.team2_score_set2,
        team1_score_set3: data.team1_score_set3,
        team2_score_set3: data.team2_score_set3,
        status: data.status,
      });
    }
  };

  const getPlayerName = (playerId: string | null): string => {
    if (!playerId) return 'TBD';
    const player = individualPlayers.find(p => p.id === playerId);
    return player?.name || 'TBD';
  };

  const calculateWinner = () => {
    const team1Total = (formData.team1_score_set1 || 0) + (formData.team1_score_set2 || 0) + (formData.team1_score_set3 || 0);
    const team2Total = (formData.team2_score_set1 || 0) + (formData.team2_score_set2 || 0) + (formData.team2_score_set3 || 0);

    if (team1Total > team2Total) return formData.team1_id;
    if (team2Total > team1Total) return formData.team2_id;
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!isIndividualRoundRobin && formData.team1_id === formData.team2_id) {
      setError('Please select different teams');
      setLoading(false);
      return;
    }

    const hasScores = formData.team1_score_set1 > 0 || formData.team2_score_set1 > 0 ||
                      formData.team1_score_set2 > 0 || formData.team2_score_set2 > 0 ||
                      formData.team1_score_set3 > 0 || formData.team2_score_set3 > 0;

    const finalStatus = formData.status === 'cancelled'
      ? 'cancelled'
      : (hasScores ? 'completed' : formData.status);
    const winner = (hasScores && formData.status !== 'cancelled') ? calculateWinner() : null;

    const matchData: any = {
      tournament_id: tournamentId,
      round: formData.round,
      match_number: formData.match_number,
      status: finalStatus,
      team1_score_set1: formData.team1_score_set1,
      team2_score_set1: formData.team2_score_set1,
      team1_score_set2: formData.team1_score_set2,
      team2_score_set2: formData.team2_score_set2,
      team1_score_set3: formData.team1_score_set3,
      team2_score_set3: formData.team2_score_set3,
      winner_id: winner || null,
    };

    if (!isIndividualRoundRobin) {
      matchData.team1_id = formData.team1_id || null;
      matchData.team2_id = formData.team2_id || null;
    }

    // CRITICAL FIX: Only persist scheduled_time/court when the user explicitly
    // changed them in the form. Re-writing them blindly (the form's
    // datetime-local string has no timezone) was shifting matches across
    // timezone boundaries and reshuffling the grid every time a result was saved.
    // Normalise to first 16 chars (YYYY-MM-DDTHH:mm) so any browser-added
    // seconds / milliseconds don't make the comparison falsely "different".
    const norm = (s: string) => (s || '').slice(0, 16);
    const initialScheduled = norm(matchData_initial.current.scheduled_time);
    const initialCourt = matchData_initial.current.court;
    const currentScheduled = norm(formData.scheduled_time);
    const scheduledChanged = currentScheduled !== initialScheduled;
    const courtChanged = (formData.court || '') !== (initialCourt || '');
    console.log('[MATCH_MODAL] schedule diff check:', {
      initialScheduled, currentScheduled, scheduledChanged,
      initialCourt, currentCourt: formData.court, courtChanged,
    });
    if (scheduledChanged) {
      matchData.scheduled_time = formData.scheduled_time
        ? new Date(formData.scheduled_time).toISOString()
        : null;
    }
    if (courtChanged) {
      matchData.court = formData.court || null;
    }

    // For inserts (no matchId yet) we still need to push schedule info even if
    // the user didn't touch the inputs, otherwise the new row would be created
    // with NULL court/time.
    if (!matchId) {
      if (matchData.scheduled_time === undefined) {
        matchData.scheduled_time = formData.scheduled_time
          ? new Date(formData.scheduled_time).toISOString()
          : null;
      }
      if (matchData.court === undefined) {
        matchData.court = formData.court || null;
      }
    }

    let result;
    if (matchId) {
      result = await supabase
        .from('matches')
        .update(matchData)
        .eq('id', matchId);
    } else {
      result = await supabase
        .from('matches')
        .insert([matchData]);
    }

    if (result.error) {
      setError(result.error.message);
      setLoading(false);
      return;
    }

    if (finalStatus === 'completed') {
      const { data: tournament } = await supabase
        .from('tournaments')
        .select('format, number_of_courts, start_time, end_time, match_duration_minutes')
        .eq('id', tournamentId)
        .single();

      const { data: currentMatch } = await supabase
        .from('matches')
        .select('round, match_number, category_id')
        .eq('id', matchId || result.data?.[0]?.id)
        .single();

      if (winner && (tournament?.format === 'single_elimination' || tournament?.format === 'groups_knockout')) {
        const loserId = winner === formData.team1_id ? formData.team2_id : formData.team1_id;

        await supabase
          .from('teams')
          .update({ status: 'eliminated' })
          .eq('id', loserId);

        if (currentMatch) {
          await advanceWinnerToNextRound(
            tournamentId,
            currentMatch.round,
            currentMatch.match_number,
            winner,
            currentMatch.category_id
          );

          await advanceLoserToClassificationRound(
            tournamentId,
            currentMatch.round,
            currentMatch.match_number,
            loserId,
            currentMatch.category_id
          );

          await advanceClassificationWinner(
            tournamentId,
            currentMatch.round,
            currentMatch.match_number,
            winner,
            currentMatch.category_id
          );

          await checkAndScheduleNextRound(
            tournamentId,
            currentMatch.round,
            currentMatch.category_id,
            tournament
          );

          if (
            typeof currentMatch.round === 'string' &&
            currentMatch.round.startsWith('group_')
          ) {
            try {
              console.log('[MATCH_MODAL] Group match done, populating SF/QF/RO16 from rankings (defensive)');
              await populateTeamPlacementMatches(tournamentId, currentMatch.category_id || null);
            } catch (err) {
              console.error('[MATCH_MODAL] populateTeamPlacementMatches failed:', err);
            }
          }
        }

        // Disabled: do not auto-reschedule remaining matches when a result is entered
        // The grid view supports manual drag-and-drop instead, and the function had a runtime bug.
        // if (currentMatch?.round !== 'group_stage' && !currentMatch?.category_id) {
        //   await rescheduleRemainingMatches(tournamentId);
        // }
      }

      // CROSSED PLAYOFFS TEAMS - Handle progression for crossed playoff rounds
      if (winner && tournament?.format === 'crossed_playoffs_teams' && currentMatch) {
        const isCrossedKnockout = currentMatch.round?.startsWith('crossed_r1_') || currentMatch.round?.startsWith('crossed_r2_');
        
        if (isCrossedKnockout) {
          const loserId = winner === formData.team1_id ? formData.team2_id : formData.team1_id;
          console.log(`[MATCH_MODAL] Crossed playoffs teams match completed: ${currentMatch.round}, winner: ${winner}, loser: ${loserId}`);
          
          await advanceCrossedPlayoffTeam(
            tournamentId,
            currentMatch.round,
            winner,
            loserId
          );
        }
        
        // Handle final/3rd/classification rounds for position calculation
        const crossedFinalRounds = ['crossed_r3_final', 'crossed_r3_3rd_place', 'crossed_r4_5th', 'crossed_r5_7th'];
        if (crossedFinalRounds.includes(currentMatch.round)) {
          console.log('[MATCH_MODAL] Crossed playoff final/classification match completed, calculating positions');
          await calculateIndividualFinalPositions(tournamentId, null);
        }
      }

      if ((tournament?.format === 'individual_groups_knockout' || tournament?.format === 'mixed_american' || tournament?.format === 'mixed_gender') && currentMatch) {
        const isGroupMatch = currentMatch.round.startsWith('group_');

        if (isGroupMatch) {
          const { data: tournamentMatches } = await supabase
            .from('matches')
            .select('id, round, status')
            .eq('tournament_id', tournamentId);

          if (tournamentMatches) {
            const groupMatchesAll = tournamentMatches.filter(m => m.round.startsWith('group_'));
            const allGroupsDone = groupMatchesAll.every(m => m.status === 'completed');

            if (allGroupsDone) {
              // Para mixed_american/mixed_gender, NÃO usar populatePlacementMatches genérica
              // O auto-fill correto (com cruzamento F+M) é feito no fetchTournamentData / handleMatchRealtime
              if (tournament?.format === 'mixed_american' || tournament?.format === 'mixed_gender') {
                console.log('[MATCH_MODAL] All group matches completed (mixed format) - knockout will be populated by fetchTournamentData');
              } else {
                console.log('[MATCH_MODAL] All group matches completed, populating knockout brackets');
                await populatePlacementMatches(tournamentId);
              }
            }
          }
        }

        const knockoutRoundsForIndividual = [
          'semifinal', 'semi_final', 'quarterfinal', 'quarter_final', 'round_of_16',
          'final', '3rd_place', 'consolation',
          '13th_place', '15th_place', '17th_place', '19th_place', '21st_place', '23rd_place',
          '1st_semifinal', '13th_semifinal', '17th_semifinal', '21st_semifinal'
        ];

        if (knockoutRoundsForIndividual.includes(currentMatch.round)) {
          console.log('[MATCH_MODAL] Individual Groups+Knockout match completed, advancing winner/loser');
          await advanceKnockoutWinner(
            tournamentId,
            matchId || result.data?.[0]?.id,
            currentMatch.category_id
          );
        }

        const allSemifinalRounds = [
          'semifinal', '1st_semifinal',
          '13th_semifinal', '17th_semifinal', '21st_semifinal'
        ];

        if (allSemifinalRounds.includes(currentMatch.round)) {
          const roundToUse = currentMatch.round === 'semifinal' ? '1st_semifinal' : currentMatch.round;
          console.log(`[MATCH_MODAL] ${currentMatch.round} completed, checking if we can populate finals`);
          await populateSemifinalAndPlacementMatches(tournamentId, currentMatch.category_id, roundToUse);
        }

        const allFinalRounds = [
          'final', 'mixed_final', '3rd_place', 'mixed_3rd_place', 'consolation',
          '5th_place', '7th_place',
          '13th_place', '15th_place', '17th_place', '19th_place', '21st_place', '23rd_place',
          'crossed_r3_final', 'crossed_r3_3rd_place', 'crossed_r2_5th_place',
          'crossed_r4_5th', 'crossed_r5_7th'
        ];

        if (allFinalRounds.includes(currentMatch.round)) {
          console.log('[MATCH_MODAL] Knockout match completed, calculating positions');
          await calculateIndividualFinalPositions(tournamentId, currentMatch.category_id);
        }

        if (currentMatch.round?.startsWith('crossed_r3_')) {
          console.log('[MATCH_MODAL] Crossed playoff R3 match completed, calculating all positions');
          await calculateIndividualFinalPositions(tournamentId, null);
        }
      }
    }

    // Processar rating dos jogadores após jogo completado
    if (finalStatus === 'completed') {
      const theMatchId = matchId || result.data?.[0]?.id;
      if (theMatchId) {
        try {
          console.log('[MATCH_MODAL] Processing rating for match:', theMatchId);
          await processMatchRating(theMatchId);
        } catch (err) {
          console.error('[MATCH_MODAL] Error processing match rating:', err);
          // Não bloquear o fluxo se o rating falhar
        }
      }
    }

    onSuccess();
    onClose();
  };

  const handleRevert = async () => {
    if (!matchId || !matchData) return;

    if (!confirm(t.match.revertMatchConfirm)) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const allKnockoutRounds = [
        'semifinal', 'semi_final', 'final', 'quarter_final', 'quarterfinal', 'round_of_16',
        '1st_semifinal', '13th_semifinal', '17th_semifinal', '21st_semifinal',
        '3rd_place', 'consolation', '5th_semi', '5th_place', '7th_place',
        '13th_place', '15th_place', '17th_place', '19th_place', '21st_place', '23rd_place'
      ];
      const isKnockoutRound = allKnockoutRounds.includes(matchData.round);

      const updateData: any = {
        status: 'scheduled',
        team1_score_set1: 0,
        team2_score_set1: 0,
        team1_score_set2: 0,
        team2_score_set2: 0,
        team1_score_set3: 0,
        team2_score_set3: 0,
        winner_id: null
      };

      const { error: updateError } = await supabase
        .from('matches')
        .update(updateData)
        .eq('id', matchId);

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }

      const semifinalToFinalMap: Record<string, { final: string; third: string }> = {
        'semifinal': { final: 'final', third: '3rd_place' },
        '1st_semifinal': { final: 'final', third: '3rd_place' },
        '13th_semifinal': { final: '13th_place', third: '15th_place' },
        '17th_semifinal': { final: '17th_place', third: '19th_place' },
        '21st_semifinal': { final: '21st_place', third: '23rd_place' },
      };

      const tierMapping = semifinalToFinalMap[matchData.round];
      if (isKnockoutRound && tierMapping) {
        let finalQuery = supabase
          .from('matches')
          .select('id, player1_individual_id')
          .eq('tournament_id', tournamentId)
          .eq('round', tierMapping.final);
        if (matchData.category_id) {
          finalQuery = finalQuery.eq('category_id', matchData.category_id);
        } else {
          finalQuery = finalQuery.is('category_id', null);
        }
        const { data: finalMatch } = await finalQuery.maybeSingle();

        if (finalMatch && finalMatch.player1_individual_id) {
          await supabase
            .from('matches')
            .update({
              player1_individual_id: null,
              player2_individual_id: null,
              player3_individual_id: null,
              player4_individual_id: null
            })
            .eq('id', finalMatch.id);
        }

        let thirdQuery = supabase
          .from('matches')
          .select('id, player1_individual_id')
          .eq('tournament_id', tournamentId)
          .eq('round', tierMapping.third);
        if (matchData.category_id) {
          thirdQuery = thirdQuery.eq('category_id', matchData.category_id);
        } else {
          thirdQuery = thirdQuery.is('category_id', null);
        }
        const { data: thirdPlaceMatch } = await thirdQuery.maybeSingle();

        if (thirdPlaceMatch && thirdPlaceMatch.player1_individual_id) {
          await supabase
            .from('matches')
            .update({
              player1_individual_id: null,
              player2_individual_id: null,
              player3_individual_id: null,
              player4_individual_id: null
            })
            .eq('id', thirdPlaceMatch.id);
        }
      }

      const knockoutPositionRounds = [
        'final', '3rd_place', 'consolation',
        '13th_place', '15th_place', '17th_place', '19th_place', '21st_place', '23rd_place'
      ];
      if (isKnockoutRound && knockoutPositionRounds.includes(matchData.round)) {
        console.log('[MATCH_MODAL] Reverting knockout position match, clearing final positions');
        await clearIndividualFinalPositions(tournamentId, matchData.category_id);
      }

      // INDIVIDUAL QUARTERFINAL - Revert progression (clear SF and 5th_SF slots)
      if (matchData.round === 'quarterfinal' || matchData.round === 'quarter_final') {
        const qfRoundName = matchData.round;
        const catFilter = matchData.category_id || null;

        // Get all QF matches to find this one's index
        let qfQuery = supabase.from('matches').select('id, match_number').eq('tournament_id', tournamentId).eq('round', qfRoundName).order('match_number', { ascending: true });
        if (catFilter) qfQuery = qfQuery.eq('category_id', catFilter); else qfQuery = qfQuery.is('category_id', null);
        const { data: qfMatches } = await qfQuery;

        if (qfMatches) {
          const matchIndex = qfMatches.findIndex(m => m.id === matchId);
          if (matchIndex >= 0) {
            const targetIdx = Math.floor(matchIndex / 2);
            const isFirst = matchIndex % 2 === 0;

            // Clear semifinal slot
            const sfRounds = ['semifinal', 'semi_final'];
            for (const sfRound of sfRounds) {
              let sfQuery = supabase.from('matches').select('id').eq('tournament_id', tournamentId).eq('round', sfRound).order('match_number', { ascending: true });
              if (catFilter) sfQuery = sfQuery.eq('category_id', catFilter); else sfQuery = sfQuery.is('category_id', null);
              const { data: sfMatches } = await sfQuery;
              if (sfMatches && sfMatches[targetIdx]) {
                const clearData: any = isFirst
                  ? { player1_individual_id: null, player2_individual_id: null }
                  : { player3_individual_id: null, player4_individual_id: null };
                await supabase.from('matches').update(clearData).eq('id', sfMatches[targetIdx].id);
                console.log(`[MATCH_MODAL] Reverted QF${matchIndex + 1}: cleared SF${targetIdx + 1} ${isFirst ? 'team1' : 'team2'}`);
              }
            }

            // Clear consolation slot
            let consolQuery = supabase.from('matches').select('id').eq('tournament_id', tournamentId).eq('round', 'consolation').order('match_number', { ascending: true });
            if (catFilter) consolQuery = consolQuery.eq('category_id', catFilter); else consolQuery = consolQuery.is('category_id', null);
            const { data: consolMatches } = await consolQuery;
            if (consolMatches && consolMatches[0]) {
              const clearData: any = isFirst
                ? { player1_individual_id: null, player2_individual_id: null }
                : { player3_individual_id: null, player4_individual_id: null };
              await supabase.from('matches').update(clearData).eq('id', consolMatches[0].id);
              console.log(`[MATCH_MODAL] Reverted QF${matchIndex + 1}: cleared consolation ${isFirst ? 'team1' : 'team2'}`);
            }
          }
        }
      }

      // GROUPS_KNOCKOUT TEAMS - if a group result was reverted, recompute
      // (clear) the dependent knockout matches so phantom team names disappear
      // from the SF / Final / 3rd-place brackets.
      // Run for any group_* revert: the function is defensive and safely
      // skips categories that have no knockout matches.
      if (
        typeof matchData.round === 'string' &&
        matchData.round.startsWith('group_')
      ) {
        try {
          console.log('[MATCH_MODAL] Group match reverted, refreshing knockouts (defensive)');
          await populateTeamPlacementMatches(tournamentId, matchData.category_id || null);
        } catch (err) {
          console.error('[MATCH_MODAL] populateTeamPlacementMatches (revert) failed:', err);
        }
      }

      // CROSSED PLAYOFFS TEAMS - Revert progression
      if (matchData.round?.startsWith('crossed_r1_j')) {
        // Reverting a QF match - clear the SF slot and classification slot
        const qfNum = parseInt(matchData.round.match(/j(\d+)/)?.[1] || '0');
        const sfNumber = qfNum <= 2 ? 1 : 2;
        const sfSlot = qfNum % 2 === 1 ? 'team1_id' : 'team2_id';
        const sfRound = `crossed_r2_j${sfNumber}`;
        const classRound = qfNum <= 2 ? 'crossed_r4_5th' : 'crossed_r5_7th';
        const classSlot = qfNum % 2 === 1 ? 'team1_id' : 'team2_id';
        
        console.log(`[MATCH_MODAL] Reverting crossed QF${qfNum}: clearing ${sfRound} ${sfSlot} and ${classRound} ${classSlot}`);
        
        await supabase.from('matches').update({ [sfSlot]: null }).eq('tournament_id', tournamentId).eq('round', sfRound).is('category_id', null);
        await supabase.from('matches').update({ [classSlot]: null }).eq('tournament_id', tournamentId).eq('round', classRound).is('category_id', null);
      } else if (matchData.round?.startsWith('crossed_r2_j')) {
        // Reverting a SF match - clear the final slot and 3rd place slot
        const sfNum = parseInt(matchData.round.match(/j(\d+)/)?.[1] || '0');
        const slot = sfNum === 1 ? 'team1_id' : 'team2_id';
        
        console.log(`[MATCH_MODAL] Reverting crossed SF${sfNum}: clearing final and 3rd_place ${slot}`);
        
        await supabase.from('matches').update({ [slot]: null }).eq('tournament_id', tournamentId).eq('round', 'crossed_r3_final').is('category_id', null);
        await supabase.from('matches').update({ [slot]: null }).eq('tournament_id', tournamentId).eq('round', 'crossed_r3_3rd_place').is('category_id', null);
      }

      console.log('[MATCH_MODAL] Match reverted successfully');
      onSuccess();
      onClose();
    } catch (err) {
      console.error('[MATCH_MODAL] Error reverting match:', err);
      setError('Failed to revert match');
      setLoading(false);
    }
  };

  const isMatchCompleted = matchData?.status === 'completed';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">
            {matchId ? t.match.edit : t.match.scheduleMatch}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {!matchId && !isIndividualRoundRobin && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t.match.team1} *</label>
                <select
                  value={formData.team1_id}
                  onChange={(e) => setFormData({ ...formData, team1_id: e.target.value })}
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">{t.match.selectTeam}</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t.match.team2} *</label>
                <select
                  value={formData.team2_id}
                  onChange={(e) => setFormData({ ...formData, team2_id: e.target.value })}
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">{t.match.selectTeam}</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {matchId && !isIndividualRoundRobin && (() => {
            const matchCategoryId = matchData?.category_id;
            const categoryTeams = matchCategoryId
              ? teams.filter(t => t.category_id === matchCategoryId)
              : teams;
            const availableTeams = categoryTeams.length > 0 ? categoryTeams : teams;
            const team1 = teams.find(t => t.id === formData.team1_id);
            const team2 = teams.find(t => t.id === formData.team2_id);

            return (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3">Jogo</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Equipa 1</label>
                    <select
                      value={formData.team1_id}
                      onChange={(e) => setFormData({ ...formData, team1_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">TBD</option>
                      {availableTeams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    {team1 && (
                      <div className="mt-1 text-xs text-gray-500">
                        {team1.player1?.name}{team1.player2?.name ? ` / ${team1.player2.name}` : ''}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Equipa 2</label>
                    <select
                      value={formData.team2_id}
                      onChange={(e) => setFormData({ ...formData, team2_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">TBD</option>
                      {availableTeams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    {team2 && (
                      <div className="mt-1 text-xs text-gray-500">
                        {team2.player1?.name}{team2.player2?.name ? ` / ${team2.player2.name}` : ''}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {!matchId && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t.match.round} *</label>
                <select
                  value={formData.round}
                  onChange={(e) => setFormData({ ...formData, round: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="group_stage">{t.bracket.group_stage}</option>
                  <option value="round_of_16">{t.bracket.round_of_16}</option>
                  <option value="quarter_final">{t.bracket.quarter_final}</option>
                  <option value="semi_final">{t.bracket.semi_final}</option>
                  <option value="final">{t.bracket.final}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t.match.matchNumber} *</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={formData.match_number}
                  onChange={(e) => setFormData({ ...formData, match_number: parseInt(e.target.value) })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          )}

          {!matchId && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t.match.scheduledTime}</label>
                <input
                  type="datetime-local"
                  value={formData.scheduled_time}
                  onChange={(e) => setFormData({ ...formData, scheduled_time: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t.match.court}</label>
                <input
                  type="text"
                  value={formData.court}
                  onChange={(e) => setFormData({ ...formData, court: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={t.match.courtPlaceholder}
                />
              </div>
            </div>
          )}

          {!matchId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t.match.status}</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="scheduled">{t.match.statusScheduled}</option>
                <option value="in_progress">{t.match.statusInProgress}</option>
                <option value="completed">{t.match.statusCompleted}</option>
                <option value="cancelled">{t.match.statusCancelled}</option>
              </select>
              <p className="text-sm text-gray-500 mt-1">
                {t.match.autoCompleteNote}
              </p>
            </div>
          )}

          {matchId && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t.match.scheduledTime}</label>
                  <input
                    type="datetime-local"
                    value={formData.scheduled_time}
                    onChange={(e) => setFormData({ ...formData, scheduled_time: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t.match.court}</label>
                  <input
                    type="text"
                    value={formData.court}
                    onChange={(e) => setFormData({ ...formData, court: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder={t.match.courtPlaceholder}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t.match.status}</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="scheduled">{t.match.statusScheduled}</option>
                  <option value="in_progress">{t.match.statusInProgress}</option>
                  <option value="completed">{t.match.statusCompleted}</option>
                  <option value="cancelled">{t.match.statusCancelled}</option>
                </select>
                <p className="text-sm text-gray-500 mt-1">
                  {t.match.autoCompleteNote}
                </p>
              </div>
            </>
          )}

          {isIndividualRoundRobin && matchData && (() => {
            const knockoutRounds = [
              'semifinal', 'semi_final', '1st_semifinal', '5th_semifinal', '9th_semifinal', '13th_semifinal',
              'quarterfinal', 'quarter_final', 'round_of_16',
              'final', '3rd_place', 'consolation',
              '5th_place', '7th_place', '9th_place', '11th_place', '13th_place', '15th_place',
              '17th_place', '19th_place', '21st_place', '23rd_place'
            ];
            const isKnockoutMatch = knockoutRounds.includes(matchData.round);

            const handleSavePlayerAssignments = async () => {
              if (!editingPlayers || !matchId) return;
              setLoading(true);
              const { error: updateError } = await supabase
                .from('matches')
                .update({
                  player1_individual_id: editingPlayers.player1_individual_id || null,
                  player2_individual_id: editingPlayers.player2_individual_id || null,
                  player3_individual_id: editingPlayers.player3_individual_id || null,
                  player4_individual_id: editingPlayers.player4_individual_id || null,
                })
                .eq('id', matchId);
              setLoading(false);
              if (updateError) {
                setError(updateError.message);
                return;
              }
              setEditingPlayers(null);
              await fetchMatch();
            };

            return (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">{t.match.matchPairs}</h3>
                  {isKnockoutMatch && !editingPlayers && (
                    <button
                      type="button"
                      onClick={() => setEditingPlayers({
                        player1_individual_id: matchData.player1_individual_id || '',
                        player2_individual_id: matchData.player2_individual_id || '',
                        player3_individual_id: matchData.player3_individual_id || '',
                        player4_individual_id: matchData.player4_individual_id || '',
                      })}
                      className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                      title="Editar Jogadores"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {isKnockoutMatch && editingPlayers ? (
                  <>
                    <div className="grid grid-cols-3 gap-4 items-center">
                      <div className="space-y-2">
                        <select
                          value={editingPlayers.player1_individual_id}
                          onChange={(e) => setEditingPlayers({ ...editingPlayers, player1_individual_id: e.target.value })}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">TBD</option>
                          {individualPlayers.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <select
                          value={editingPlayers.player2_individual_id}
                          onChange={(e) => setEditingPlayers({ ...editingPlayers, player2_individual_id: e.target.value })}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">TBD</option>
                          {individualPlayers.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="text-center">
                        <span className="text-gray-600 font-semibold">VS</span>
                      </div>
                      <div className="space-y-2">
                        <select
                          value={editingPlayers.player3_individual_id}
                          onChange={(e) => setEditingPlayers({ ...editingPlayers, player3_individual_id: e.target.value })}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">TBD</option>
                          {individualPlayers.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <select
                          value={editingPlayers.player4_individual_id}
                          onChange={(e) => setEditingPlayers({ ...editingPlayers, player4_individual_id: e.target.value })}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">TBD</option>
                          {individualPlayers.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => setEditingPlayers(null)}
                        className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        {t.button.cancel}
                      </button>
                      <button
                        type="button"
                        onClick={handleSavePlayerAssignments}
                        disabled={loading}
                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Guardar
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-3 gap-4 items-center">
                    <div className="text-right space-y-1">
                      <p className="font-medium text-sm text-gray-900">
                        {getPlayerName(matchData.player1_individual_id)}
                      </p>
                      <p className="font-medium text-sm text-gray-900">
                        {getPlayerName(matchData.player2_individual_id)}
                      </p>
                    </div>
                    <div className="text-center">
                      <span className="text-gray-600 font-semibold">VS</span>
                    </div>
                    <div className="text-left space-y-1">
                      <p className="font-medium text-sm text-gray-900">
                        {getPlayerName(matchData.player3_individual_id)}
                      </p>
                      <p className="font-medium text-sm text-gray-900">
                        {getPlayerName(matchData.player4_individual_id)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="border-t pt-6">
            <h3 className="font-semibold text-gray-900 mb-4">{t.match.score}</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 items-center">
                <span className="text-sm font-medium text-gray-700">{t.match.set1}</span>
                <input
                  type="number"
                  min="0"
                  value={formData.team1_score_set1 === 0 ? '' : formData.team1_score_set1}
                  onChange={(e) => setFormData({ ...formData, team1_score_set1: e.target.value === '' ? 0 : parseInt(e.target.value) })}
                  placeholder="0"
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center placeholder:text-gray-400"
                />
                <input
                  type="number"
                  min="0"
                  value={formData.team2_score_set1 === 0 ? '' : formData.team2_score_set1}
                  onChange={(e) => setFormData({ ...formData, team2_score_set1: e.target.value === '' ? 0 : parseInt(e.target.value) })}
                  placeholder="0"
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center placeholder:text-gray-400"
                />
              </div>

              <div className="grid grid-cols-3 gap-4 items-center">
                <span className="text-sm font-medium text-gray-700">{t.match.set2}</span>
                <input
                  type="number"
                  min="0"
                  value={formData.team1_score_set2 === 0 ? '' : formData.team1_score_set2}
                  onChange={(e) => setFormData({ ...formData, team1_score_set2: e.target.value === '' ? 0 : parseInt(e.target.value) })}
                  placeholder="0"
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center placeholder:text-gray-400"
                />
                <input
                  type="number"
                  min="0"
                  value={formData.team2_score_set2 === 0 ? '' : formData.team2_score_set2}
                  onChange={(e) => setFormData({ ...formData, team2_score_set2: e.target.value === '' ? 0 : parseInt(e.target.value) })}
                  placeholder="0"
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center placeholder:text-gray-400"
                />
              </div>

              <div className="grid grid-cols-3 gap-4 items-center">
                <span className="text-sm font-medium text-gray-700">{t.match.set3}</span>
                <input
                  type="number"
                  min="0"
                  value={formData.team1_score_set3 === 0 ? '' : formData.team1_score_set3}
                  onChange={(e) => setFormData({ ...formData, team1_score_set3: e.target.value === '' ? 0 : parseInt(e.target.value) })}
                  placeholder="0"
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center placeholder:text-gray-400"
                />
                <input
                  type="number"
                  min="0"
                  value={formData.team2_score_set3 === 0 ? '' : formData.team2_score_set3}
                  onChange={(e) => setFormData({ ...formData, team2_score_set3: e.target.value === '' ? 0 : parseInt(e.target.value) })}
                  placeholder="0"
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center placeholder:text-gray-400"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              {t.button.cancel}
            </button>
            {matchId && isMatchCompleted && (
              <button
                type="button"
                onClick={handleRevert}
                disabled={loading}
                className="flex-1 px-6 py-3 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                {t.match.revertMatch}
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? t.button.saving : matchId ? t.match.updateMatch : t.match.scheduleMatch}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
