import { Match, Team, Player } from '../lib/supabase';

type TeamWithPlayers = Team & {
  player1: Player;
  player2: Player;
};

type MatchWithTeams = Match & {
  team1: TeamWithPlayers | null;
  team2: TeamWithPlayers | null;
};

type BracketViewProps = {
  matches: MatchWithTeams[];
  onMatchClick: (matchId: string) => void;
  isIndividual?: boolean;
  individualPlayers?: Player[];
};

export default function BracketView({ matches, onMatchClick, isIndividual = false, individualPlayers = [] }: BracketViewProps) {
  console.log('[BRACKET] Received', matches.length, 'matches');
  console.log('[BRACKET] All rounds:', Array.from(new Set(matches.map(m => m.round))));
  console.log('[BRACKET] Non-group matches:', matches.filter(m => !m.round?.startsWith('group_')).map(m => ({ round: m.round, id: m.id, matchNum: m.match_number })));
  
  const getMatchWinner = (match: MatchWithTeams) => {
    if (match.status !== 'completed') return null;
    const t1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
    const t2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
    if (t1Games > t2Games) return 'team1';
    if (t2Games > t1Games) return 'team2';
    return null;
  };

  const allRoundNames = Array.from(new Set(matches.map(m => m.round)));

  const mainRoundOrder = [
    'crossed_r1_j1', 'crossed_r1_j2', 'crossed_r1_j3',
    'crossed_r2_j4', 'crossed_r2_j5', 'crossed_r2_j6',
    'crossed_r3_j7', 'crossed_r3_j8',
    // Legacy names (backwards compatibility)
    'crossed_r2_semifinal1', 'crossed_r2_semifinal2', 'crossed_r2_5th_place',
    'crossed_r3_final', 'crossed_r3_3rd_place',
    'crossed_playoff_categories', 'crossed_playoff',
    'mixed_semifinal1', 'mixed_semifinal2', 'mixed_final',
    'round_of_128', 'round_of_64', 'round_of_32', 'round_of_16', 
    'quarter_final', 'quarterfinal', 'semi_final', 'semifinal', 'final'
  ];
  const placementRoundOrder = [
    '3rd_place', '5th_place', '7th_place', '9th_place', '11th_place',
    '13th_place', '15th_place', '17th_place', '19th_place', '21st_place', '23rd_place',
    'mixed_3rd_place'
  ];
  const semifinalRoundOrder = [
    '5th_semifinal', '9th_semifinal', '13th_semifinal', '17th_semifinal', '21st_semifinal'
  ];

  const mainRounds = mainRoundOrder.filter(r => allRoundNames.includes(r));
  const placementRounds = placementRoundOrder.filter(r => allRoundNames.includes(r));
  const semifinalRounds = semifinalRoundOrder.filter(r => allRoundNames.includes(r));

  console.log('[BRACKET] mainRounds:', mainRounds);
  console.log('[BRACKET] placementRounds:', placementRounds);
  console.log('[BRACKET] semifinalRounds:', semifinalRounds);

  const matchesByRound = new Map<string, MatchWithTeams[]>();
  [...mainRounds, ...placementRounds, ...semifinalRounds].forEach(round => {
    const roundMatches = matches.filter(m => m.round === round).sort((a, b) => a.match_number - b.match_number);
    if (roundMatches.length > 0) {
      matchesByRound.set(round, roundMatches);
    }
  });

  console.log('[BRACKET] matchesByRound keys:', Array.from(matchesByRound.keys()));

  const existingRounds = mainRounds;

  if (existingRounds.length === 0 && placementRounds.length === 0) {
    console.log('[BRACKET] NO ROUNDS FOUND - showing empty message');
    return <div className="text-gray-500 text-center py-8">No bracket matches scheduled yet</div>;
  }

  console.log('[BRACKET] existingRounds:', existingRounds, '- rendering bracket');

  const getRoundName = (round: string) => {
    switch(round) {
      case 'crossed_r1_j1': return 'Playoff R1 - Jogo 1';
      case 'crossed_r1_j2': return 'Playoff R1 - Jogo 2';
      case 'crossed_r1_j3': return 'Playoff R1 - Jogo 3';
      case 'crossed_r2_j4': return 'Meia-Final 1';
      case 'crossed_r2_j5': return 'Meia-Final 2';
      case 'crossed_r2_j6': return '5º/6º Lugar';
      case 'crossed_r3_j7': return 'Final';
      case 'crossed_r3_j8': return '3º/4º Lugar';
      // Legacy names (backwards compatibility)
      case 'crossed_r2_semifinal1': return 'Meia-Final 1';
      case 'crossed_r2_semifinal2': return 'Meia-Final 2';
      case 'crossed_r2_5th_place': return '5º/6º Lugar';
      case 'crossed_r3_final': return 'Final';
      case 'crossed_r3_3rd_place': return '3º/4º Lugar';
      case 'mixed_semifinal1': return 'Meia-Final 1';
      case 'mixed_semifinal2': return 'Meia-Final 2';
      case 'mixed_final': return 'Final';
      case 'mixed_3rd_place': return '3º/4º Lugar';
      case 'crossed_playoff_categories': return 'Playoffs Cruzados (Categorias)';
      case 'crossed_playoff': return 'Playoffs Cruzados';
      case 'round_of_128': return 'Round of 128';
      case 'round_of_64': return 'Round of 64';
      case 'round_of_32': return 'Round of 32';
      case 'round_of_16': return 'Round of 16';
      case 'quarter_final':
      case 'quarterfinal': return 'Quarter Finals';
      case 'semi_final':
      case 'semifinal': return 'Semi Finals';
      case 'final': return 'Final';
      case '3rd_place': return '3rd/4th Place';
      case '5th_place': return '5th/6th Place';
      case '7th_place': return '7th/8th Place';
      case '9th_place': return '9th/10th Place';
      case '11th_place': return '11th/12th Place';
      case '13th_place': return '13th/14th Place';
      case '15th_place': return '15th/16th Place';
      case '17th_place': return '17th/18th Place';
      case '19th_place': return '19th/20th Place';
      case '21st_place': return '21st/22nd Place';
      case '23rd_place': return '23rd/24th Place';
      case '5th_semifinal': return '5th-8th Semifinal';
      case '9th_semifinal': return '9th-12th Semifinal';
      case '13th_semifinal': return '13th-16th Semifinal';
      case '17th_semifinal': return '17th-20th Semifinal';
      case '21st_semifinal': return '21st-24th Semifinal';
      default:
        const match = round.match(/round_of_(\d+)/);
        if (match) return `Round of ${match[1]}`;
        return round;
    }
  };

  const getTeamName = (match: MatchWithTeams, isTeam1: boolean) => {
    if (isIndividual) {
      const player1Id = isTeam1 ? match.player1_individual_id : match.player3_individual_id;
      const player2Id = isTeam1 ? match.player2_individual_id : match.player4_individual_id;

      if (!player1Id || player1Id === 'TBD') return 'TBD';

      const player1 = individualPlayers.find(p => p.id === player1Id);
      const player2 = individualPlayers.find(p => p.id === player2Id);

      if (!player1) return 'TBD';
      if (!player2) return player1.name;

      return `${player1.name} + ${player2.name}`;
    } else {
      return isTeam1 ? (match.team1?.name || 'TBD') : (match.team2?.name || 'TBD');
    }
  };

  const getMatchScore = (match: MatchWithTeams) => {
    if (match.status !== 'completed') return 'vs';

    const scores: string[] = [];

    if (match.team1_score_set1 !== null && match.team2_score_set1 !== null) {
      scores.push(`${match.team1_score_set1}-${match.team2_score_set1}`);
    }

    if (match.team1_score_set2 !== null && match.team2_score_set2 !== null &&
        (match.team1_score_set2 > 0 || match.team2_score_set2 > 0)) {
      scores.push(`${match.team1_score_set2}-${match.team2_score_set2}`);
    }

    if (match.team1_score_set3 !== null && match.team2_score_set3 !== null &&
        (match.team1_score_set3 > 0 || match.team2_score_set3 > 0)) {
      scores.push(`${match.team1_score_set3}-${match.team2_score_set3}`);
    }

    return scores.length > 0 ? scores.join(', ') : 'vs';
  };

  const renderMatch = (match: MatchWithTeams) => {
    const winner = getMatchWinner(match);
    const isWinner1 = winner === 'team1';
    const isWinner2 = winner === 'team2';

    return (
      <button
        key={match.id}
        onClick={() => onMatchClick(match.id)}
        className="w-full bg-white border-2 border-gray-300 rounded-lg hover:shadow-lg transition-all hover:border-blue-400"
      >
        <div className={`flex items-center justify-between p-3 border-b border-gray-200 ${
          isWinner1 ? 'bg-green-50' : match.status === 'completed' ? 'bg-gray-50' : ''
        }`}>
          <span className="font-semibold text-sm truncate flex-1">
            {getTeamName(match, true)}
          </span>
          {match.status === 'completed' && (
            <span className="text-sm font-bold ml-2">
              {isWinner1 ? '1st' : ''}
            </span>
          )}
        </div>

        <div className="px-3 py-1 bg-gray-50 border-b border-gray-200">
          <span className="text-xs text-gray-600 font-medium">
            {getMatchScore(match)}
          </span>
        </div>

        <div className={`flex items-center justify-between p-3 border-b border-gray-200 ${
          isWinner2 ? 'bg-green-50' : match.status === 'completed' ? 'bg-gray-50' : ''
        }`}>
          <span className="font-semibold text-sm truncate flex-1">
            {getTeamName(match, false)}
          </span>
          {match.status === 'completed' && (
            <span className="text-sm font-bold ml-2">
              {isWinner2 ? '1st' : ''}
            </span>
          )}
        </div>

        <div className="px-3 py-2 bg-gray-100">
          <div className="text-xs text-gray-600">
            {match.scheduled_time && (
              <div className="truncate">
                {new Date(match.scheduled_time).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false
                })}
              </div>
            )}
            {match.court && (
              <div className="font-medium mt-0.5">
                Court {match.court}
              </div>
            )}
          </div>
        </div>
      </button>
    );
  };

  const getPlacementLabel = (round: string, isWinner: boolean) => {
    switch (round) {
      case 'final':
      case 'crossed_r3_j7':
      case 'crossed_r3_final': return isWinner ? '1st' : '2nd';
      case '3rd_place':
      case 'crossed_r3_j8':
      case 'crossed_r3_3rd_place': return isWinner ? '3rd' : '4th';
      case '5th_place': return isWinner ? '5th' : '6th';
      case '7th_place': return isWinner ? '7th' : '8th';
      case '9th_place': return isWinner ? '9th' : '10th';
      case '11th_place': return isWinner ? '11th' : '12th';
      case '13th_place': return isWinner ? '13th' : '14th';
      case '15th_place': return isWinner ? '15th' : '16th';
      case '17th_place': return isWinner ? '17th' : '18th';
      case '19th_place': return isWinner ? '19th' : '20th';
      case '21st_place': return isWinner ? '21st' : '22nd';
      case '23rd_place': return isWinner ? '23rd' : '24th';
      default: return '';
    }
  };

  const renderPlacementMatch = (match: MatchWithTeams, round: string) => {
    const winner = getMatchWinner(match);
    const isWinner1 = winner === 'team1';
    const isWinner2 = winner === 'team2';

    return (
      <button
        key={match.id}
        onClick={() => onMatchClick(match.id)}
        className="w-full bg-white border-2 border-gray-300 rounded-lg hover:shadow-lg transition-all hover:border-blue-400"
        style={{ minWidth: '280px' }}
      >
        <div className={`flex items-center justify-between p-3 border-b border-gray-200 ${
          isWinner1 ? 'bg-amber-50' : match.status === 'completed' ? 'bg-gray-50' : ''
        }`}>
          <span className="font-semibold text-sm truncate flex-1">
            {getTeamName(match, true)}
          </span>
          {match.status === 'completed' && (
            <span className={`text-xs font-bold ml-2 px-2 py-0.5 rounded ${
              isWinner1 ? 'bg-amber-200 text-amber-800' : 'bg-gray-200 text-gray-600'
            }`}>
              {getPlacementLabel(round, isWinner1)}
            </span>
          )}
        </div>

        <div className="px-3 py-1 bg-gray-50 border-b border-gray-200">
          <span className="text-xs text-gray-600 font-medium">
            {getMatchScore(match)}
          </span>
        </div>

        <div className={`flex items-center justify-between p-3 border-b border-gray-200 ${
          isWinner2 ? 'bg-amber-50' : match.status === 'completed' ? 'bg-gray-50' : ''
        }`}>
          <span className="font-semibold text-sm truncate flex-1">
            {getTeamName(match, false)}
          </span>
          {match.status === 'completed' && (
            <span className={`text-xs font-bold ml-2 px-2 py-0.5 rounded ${
              isWinner2 ? 'bg-amber-200 text-amber-800' : 'bg-gray-200 text-gray-600'
            }`}>
              {getPlacementLabel(round, isWinner2)}
            </span>
          )}
        </div>

        <div className="px-3 py-2 bg-gray-100">
          <div className="text-xs text-gray-600">
            {match.scheduled_time && (
              <div className="truncate">
                {new Date(match.scheduled_time).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false
                })}
              </div>
            )}
            {match.court && (
              <div className="font-medium mt-0.5">
                Court {match.court}
              </div>
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-8">
      {existingRounds.length > 0 && (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-8 min-w-max p-4">
            {existingRounds.map((round, roundIndex) => {
              const roundMatches = matchesByRound.get(round)!;
              const isFirst = roundIndex === 0;
              const isLast = roundIndex === existingRounds.length - 1;

              return (
                <div key={round} className="flex flex-col justify-around" style={{ minWidth: '280px' }}>
                  <div className="text-center font-bold text-gray-700 mb-4 text-sm uppercase tracking-wide">
                    {getRoundName(round)}
                  </div>

                  <div className="flex flex-col justify-around h-full gap-4">
                    {roundMatches.map((match, matchIndex) => {
                      const winner = getMatchWinner(match);
                      const isWinner1 = winner === 'team1';
                      const isWinner2 = winner === 'team2';
                      const isFinal = round === 'final';

                      return (
                        <div key={match.id} className="relative">
                          {!isFirst && (
                            <div
                              className="absolute right-full top-1/2 w-8 h-px bg-gray-300"
                              style={{ transform: 'translateY(-50%)' }}
                            />
                          )}

                          <button
                            onClick={() => onMatchClick(match.id)}
                            className="w-full bg-white border-2 border-gray-300 rounded-lg hover:shadow-lg transition-all hover:border-blue-400"
                          >
                            <div className={`flex items-center justify-between p-3 border-b border-gray-200 ${
                              isWinner1 ? 'bg-green-50' : match.status === 'completed' ? 'bg-gray-50' : ''
                            }`}>
                              <span className="font-semibold text-sm truncate flex-1">
                                {getTeamName(match, true)}
                              </span>
                              {match.status === 'completed' && isFinal && (
                                <span className={`text-xs font-bold ml-2 px-2 py-0.5 rounded ${
                                  isWinner1 ? 'bg-yellow-300 text-yellow-900' : 'bg-gray-300 text-gray-700'
                                }`}>
                                  {isWinner1 ? '1st' : '2nd'}
                                </span>
                              )}
                              {match.status === 'completed' && !isFinal && isWinner1 && (
                                <span className="text-sm font-bold ml-2 text-green-600">W</span>
                              )}
                            </div>

                            <div className="px-3 py-1 bg-gray-50 border-b border-gray-200">
                              <span className="text-xs text-gray-600 font-medium">
                                {getMatchScore(match)}
                              </span>
                            </div>

                            <div className={`flex items-center justify-between p-3 border-b border-gray-200 ${
                              isWinner2 ? 'bg-green-50' : match.status === 'completed' ? 'bg-gray-50' : ''
                            }`}>
                              <span className="font-semibold text-sm truncate flex-1">
                                {getTeamName(match, false)}
                              </span>
                              {match.status === 'completed' && isFinal && (
                                <span className={`text-xs font-bold ml-2 px-2 py-0.5 rounded ${
                                  isWinner2 ? 'bg-yellow-300 text-yellow-900' : 'bg-gray-300 text-gray-700'
                                }`}>
                                  {isWinner2 ? '1st' : '2nd'}
                                </span>
                              )}
                              {match.status === 'completed' && !isFinal && isWinner2 && (
                                <span className="text-sm font-bold ml-2 text-green-600">W</span>
                              )}
                            </div>

                            <div className="px-3 py-2 bg-gray-100">
                              <div className="text-xs text-gray-600">
                                {match.scheduled_time && (
                                  <div className="truncate">
                                    {new Date(match.scheduled_time).toLocaleString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      hour12: false
                                    })}
                                  </div>
                                )}
                                {match.court && (
                                  <div className="font-medium mt-0.5">
                                    Court {match.court}
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>

                          {!isLast && roundIndex < existingRounds.length - 1 && (
                            <>
                              {matchIndex % 2 === 0 && matchIndex + 1 < roundMatches.length && (
                                <>
                                  <div
                                    className="absolute left-full top-1/2 w-8 h-px bg-gray-300"
                                    style={{ transform: 'translateY(-50%)' }}
                                  />
                                  <div
                                    className="absolute left-full top-1/2 w-px bg-gray-300"
                                    style={{
                                      height: `${(100 / roundMatches.length) * (matchIndex + 1) * 100}%`,
                                      transform: 'translateX(32px) translateY(-50%)'
                                    }}
                                  />
                                </>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(placementRounds.length > 0 || semifinalRounds.length > 0) && (
        <div className="border-t border-gray-200 pt-6 space-y-6">
          {semifinalRounds.length > 0 && (
            <div>
              <h3 className="text-lg font-bold text-gray-700 mb-4 text-center uppercase tracking-wide">
                Classification Semifinals
              </h3>
              <div className="flex flex-wrap justify-center gap-6">
                {semifinalRounds.map(round => {
                  const roundMatches = matchesByRound.get(round);
                  if (!roundMatches || roundMatches.length === 0) return null;

                  return (
                    <div key={round} className="flex flex-col items-center gap-4">
                      <div className="text-center font-semibold text-gray-600 mb-1 text-sm uppercase tracking-wide">
                        {getRoundName(round)}
                      </div>
                      {roundMatches.map(match => renderPlacementMatch(match, round))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {placementRounds.length > 0 && (
            <div>
              <h3 className="text-lg font-bold text-gray-700 mb-4 text-center uppercase tracking-wide">
                Classification Finals
              </h3>
              <div className="flex flex-wrap justify-center gap-6">
                {placementRounds.map(round => {
                  const roundMatches = matchesByRound.get(round);
                  if (!roundMatches || roundMatches.length === 0) return null;

                  return (
                    <div key={round} className="flex flex-col items-center">
                      <div className="text-center font-semibold text-gray-600 mb-3 text-sm uppercase tracking-wide">
                        {getRoundName(round)}
                      </div>
                      {roundMatches.map(match => renderPlacementMatch(match, round))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
