import { supabase } from './supabase';

// Função para calcular posições finais dos playoffs cruzados
async function calculateCrossedPlayoffPositions(tournamentId: string): Promise<boolean> {
  console.log('[CROSSED_POSITIONS] Calculating positions for crossed playoffs');

  // Buscar todos os jogos de playoffs cruzados completados
  const { data: crossedMatches } = await supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed')
    .like('round', 'crossed_%');

  if (!crossedMatches || crossedMatches.length === 0) {
    console.log('[CROSSED_POSITIONS] No crossed playoff matches found');
    return false;
  }

  const finalMatch = crossedMatches.find(m => m.round === 'crossed_r3_final');
  const thirdPlaceMatch = crossedMatches.find(m => m.round === 'crossed_r3_3rd_place');
  const fifthPlaceMatch = crossedMatches.find(m => m.round === 'crossed_r2_5th_place');

  const getMatchWinnerLoser = (match: any) => {
    if (!match) return { winners: [], losers: [] };
    const t1Games = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
    const t2Games = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
    const t1Won = t1Games > t2Games;
    
    const team1Players = [match.player1_individual_id, match.player2_individual_id].filter(Boolean);
    const team2Players = [match.player3_individual_id, match.player4_individual_id].filter(Boolean);
    
    return {
      winners: t1Won ? team1Players : team2Players,
      losers: t1Won ? team2Players : team1Players
    };
  };

  // Buscar jogos dos grupos para desempate
  const { data: groupMatches } = await supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed')
    .like('round', 'group_%');

  const getPlayerGroupStats = (playerId: string) => {
    let wins = 0, gamesWon = 0, gamesLost = 0;
    (groupMatches || []).forEach(match => {
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

  const sortByGroupCriteria = (playerIds: string[]) => {
    return playerIds
      .map(id => ({ id, ...getPlayerGroupStats(id) }))
      .sort((a, b) => {
        if (a.wins !== b.wins) return b.wins - a.wins;
        const diffA = a.gamesWon - a.gamesLost;
        const diffB = b.gamesWon - b.gamesLost;
        if (diffA !== diffB) return diffB - diffA;
        return b.gamesWon - a.gamesWon;
      })
      .map(p => p.id);
  };

  let currentPosition = 1;

  // Vencedores da Final: 1º e 2º
  if (finalMatch) {
    const result = getMatchWinnerLoser(finalMatch);
    const sortedWinners = sortByGroupCriteria(result.winners);
    for (const playerId of sortedWinners) {
      console.log(`[CROSSED_POSITIONS] Setting position ${currentPosition} for player ${playerId}`);
      await supabase.from('players').update({ final_position: currentPosition }).eq('id', playerId);
      currentPosition++;
    }
    
    // Perdedores da Final: 3º e 4º (se não houver jogo de 3º/4º)
    if (!thirdPlaceMatch) {
      const sortedLosers = sortByGroupCriteria(result.losers);
      for (const playerId of sortedLosers) {
        console.log(`[CROSSED_POSITIONS] Setting position ${currentPosition} for player ${playerId}`);
        await supabase.from('players').update({ final_position: currentPosition }).eq('id', playerId);
        currentPosition++;
      }
    }
  }

  // Jogo de 3º/4º
  if (thirdPlaceMatch) {
    const result = getMatchWinnerLoser(thirdPlaceMatch);
    const sortedWinners = sortByGroupCriteria(result.winners);
    for (const playerId of sortedWinners) {
      console.log(`[CROSSED_POSITIONS] Setting position ${currentPosition} for player ${playerId}`);
      await supabase.from('players').update({ final_position: currentPosition }).eq('id', playerId);
      currentPosition++;
    }
    const sortedLosers = sortByGroupCriteria(result.losers);
    for (const playerId of sortedLosers) {
      console.log(`[CROSSED_POSITIONS] Setting position ${currentPosition} for player ${playerId}`);
      await supabase.from('players').update({ final_position: currentPosition }).eq('id', playerId);
      currentPosition++;
    }
  }

  // Jogo de 5º/6º
  if (fifthPlaceMatch) {
    const result = getMatchWinnerLoser(fifthPlaceMatch);
    const sortedWinners = sortByGroupCriteria(result.winners);
    for (const playerId of sortedWinners) {
      console.log(`[CROSSED_POSITIONS] Setting position ${currentPosition} for player ${playerId}`);
      await supabase.from('players').update({ final_position: currentPosition }).eq('id', playerId);
      currentPosition++;
    }
    const sortedLosers = sortByGroupCriteria(result.losers);
    for (const playerId of sortedLosers) {
      console.log(`[CROSSED_POSITIONS] Setting position ${currentPosition} for player ${playerId}`);
      await supabase.from('players').update({ final_position: currentPosition }).eq('id', playerId);
      currentPosition++;
    }
  }

  // Jogadores que não chegaram aos jogos finais ficam sem posição
  // (perdedores de R1 que não avançaram para 5º/6º)
  const r1Matches = crossedMatches.filter(m => m.round?.startsWith('crossed_r1_'));
  for (const match of r1Matches) {
    const result = getMatchWinnerLoser(match);
    // Verificar se os perdedores de R1 já têm posição
    for (const playerId of result.losers) {
      const { data: player } = await supabase
        .from('players')
        .select('final_position')
        .eq('id', playerId)
        .single();
      
      if (!player?.final_position) {
        // Atribuir posições 7-12 para perdedores de R1 que não foram ao 5º/6º
        console.log(`[CROSSED_POSITIONS] Setting position ${currentPosition} for R1 loser ${playerId}`);
        await supabase.from('players').update({ final_position: currentPosition }).eq('id', playerId);
        currentPosition++;
      }
    }
  }

  console.log('[CROSSED_POSITIONS] Completed successfully');
  return true;
}

export async function clearIndividualFinalPositions(tournamentId: string, categoryId?: string | null) {
  console.log('[CLEAR_POSITIONS] Clearing final positions for tournament:', tournamentId, 'category:', categoryId);

  let query = supabase
    .from('players')
    .update({ final_position: null })
    .eq('tournament_id', tournamentId);

  if (categoryId) {
    query = query.eq('category_id', categoryId);
  }

  const { error } = await query;

  if (error) {
    console.error('[CLEAR_POSITIONS] Error clearing positions:', error);
    return false;
  }

  console.log('[CLEAR_POSITIONS] Positions cleared successfully');
  return true;
}

export async function calculateIndividualFinalPositions(tournamentId: string, categoryId?: string | null) {
  console.log('[CALCULATE_POSITIONS] Starting for tournament:', tournamentId, 'category:', categoryId);

  const matchFilter: any = {
    tournament_id: tournamentId,
    status: 'completed',
  };
  if (categoryId) {
    matchFilter.category_id = categoryId;
  }

  // Verificar primeiro se há playoffs cruzados
  const { data: crossedFinalMatch } = await supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed')
    .eq('round', 'crossed_r3_final')
    .maybeSingle();

  // Se houver playoffs cruzados, usar essa lógica
  if (crossedFinalMatch) {
    console.log('[CALCULATE_POSITIONS] Found crossed playoffs final, using crossed playoffs logic');
    return await calculateCrossedPlayoffPositions(tournamentId);
  }

  // Try to find final match with different round names
  let finalMatch = null;
  
  // Try 'final' first
  const { data: normalFinal } = await supabase
    .from('matches')
    .select('*')
    .match(matchFilter)
    .eq('round', 'final')
    .maybeSingle();
  
  if (normalFinal) {
    finalMatch = normalFinal;
  } else {
    // Try 'mixed_final'
    const { data: mixedFinal } = await supabase
      .from('matches')
      .select('*')
      .match(matchFilter)
      .eq('round', 'mixed_final')
      .maybeSingle();
    
    if (mixedFinal) {
      finalMatch = mixedFinal;
    }
  }

  if (!finalMatch) {
    console.log('[CALCULATE_POSITIONS] No completed final match found');
    return false;
  }
  
  console.log('[CALCULATE_POSITIONS] Found final match with round:', finalMatch.round);

  const getMatchWinner = (match: any): string[] => {
    const team1Score = (match?.team1_score_set1 || 0) + (match?.team1_score_set2 || 0) + (match?.team1_score_set3 || 0);
    const team2Score = (match?.team2_score_set1 || 0) + (match?.team2_score_set2 || 0) + (match?.team2_score_set3 || 0);

    if (team1Score === 0 && team2Score === 0) return [];

    if (team1Score > team2Score) {
      return [match.player1_individual_id, match.player2_individual_id].filter(Boolean);
    } else {
      return [match.player3_individual_id, match.player4_individual_id].filter(Boolean);
    }
  };

  const getMatchLoser = (match: any): string[] => {
    const team1Score = (match?.team1_score_set1 || 0) + (match?.team1_score_set2 || 0) + (match?.team1_score_set3 || 0);
    const team2Score = (match?.team2_score_set1 || 0) + (match?.team2_score_set2 || 0) + (match?.team2_score_set3 || 0);

    if (team1Score === 0 && team2Score === 0) return [];

    if (team1Score < team2Score) {
      return [match.player1_individual_id, match.player2_individual_id].filter(Boolean);
    } else {
      return [match.player3_individual_id, match.player4_individual_id].filter(Boolean);
    }
  };

  const { data: groupMatches } = await supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed')
    .like('round', 'group_%');

  const playerGroupStats = new Map<string, { wins: number; gamesWon: number; gamesLost: number }>();
  (groupMatches || []).forEach((m: any) => {
    const t1Games = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
    const t2Games = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);
    const t1Won = t1Games > t2Games;
    const t1Players = [m.player1_individual_id, m.player2_individual_id].filter(Boolean);
    const t2Players = [m.player3_individual_id, m.player4_individual_id].filter(Boolean);
    for (const pid of t1Players) {
      const s = playerGroupStats.get(pid) || { wins: 0, gamesWon: 0, gamesLost: 0 };
      s.gamesWon += t1Games; s.gamesLost += t2Games;
      if (t1Won) s.wins++;
      playerGroupStats.set(pid, s);
    }
    for (const pid of t2Players) {
      const s = playerGroupStats.get(pid) || { wins: 0, gamesWon: 0, gamesLost: 0 };
      s.gamesWon += t2Games; s.gamesLost += t1Games;
      if (!t1Won) s.wins++;
      playerGroupStats.set(pid, s);
    }
  });

  const rankWithinPair = (playerIds: string[]): string[] => {
    return [...playerIds].sort((a, b) => {
      const sa = playerGroupStats.get(a) || { wins: 0, gamesWon: 0, gamesLost: 0 };
      const sb = playerGroupStats.get(b) || { wins: 0, gamesWon: 0, gamesLost: 0 };
      if (sb.wins !== sa.wins) return sb.wins - sa.wins;
      const diffA = sa.gamesWon - sa.gamesLost;
      const diffB = sb.gamesWon - sb.gamesLost;
      if (diffB !== diffA) return diffB - diffA;
      return sb.gamesWon - sa.gamesWon;
    });
  };

  const finalWinners = getMatchWinner(finalMatch);
  const finalLosers = getMatchLoser(finalMatch);

  console.log('[CALCULATE_POSITIONS] Final winners:', finalWinners);
  console.log('[CALCULATE_POSITIONS] Final losers:', finalLosers);

  let thirdPlaceMatch = null;
  const { data: normal3rd } = await supabase
    .from('matches')
    .select('*')
    .match(matchFilter)
    .eq('round', '3rd_place')
    .maybeSingle();
  if (normal3rd) {
    thirdPlaceMatch = normal3rd;
  } else {
    const { data: mixed3rd } = await supabase
      .from('matches')
      .select('*')
      .match(matchFilter)
      .eq('round', 'mixed_3rd_place')
      .maybeSingle();
    if (mixed3rd) thirdPlaceMatch = mixed3rd;
  }

  const { data: fifthPlaceMatch } = await supabase
    .from('matches')
    .select('*')
    .match(matchFilter)
    .eq('round', '5th_place')
    .maybeSingle();

  const { data: seventhPlaceMatch } = await supabase
    .from('matches')
    .select('*')
    .match(matchFilter)
    .eq('round', '7th_place')
    .maybeSingle();

  const sortedFinalWinners = rankWithinPair(finalWinners);
  for (let i = 0; i < sortedFinalWinners.length; i++) {
    await supabase.from('players').update({ final_position: 1 + i }).eq('id', sortedFinalWinners[i]);
  }

  const finalLoserBase = thirdPlaceMatch ? (sortedFinalWinners.length + 1) : (sortedFinalWinners.length + 1);
  if (thirdPlaceMatch) {
    console.log('[CALCULATE_POSITIONS] Found 3rd place match with round:', thirdPlaceMatch.round);
    const thirdWinners = rankWithinPair(getMatchWinner(thirdPlaceMatch));
    const thirdLosers = rankWithinPair(getMatchLoser(thirdPlaceMatch));
    for (let i = 0; i < thirdWinners.length; i++) {
      await supabase.from('players').update({ final_position: 3 + i }).eq('id', thirdWinners[i]);
    }
    for (let i = 0; i < thirdLosers.length; i++) {
      await supabase.from('players').update({ final_position: 3 + thirdWinners.length + i }).eq('id', thirdLosers[i]);
    }
  } else {
    const sortedFinalLosers = rankWithinPair(finalLosers);
    const loserBase = sortedFinalWinners.length + 1;
    for (let i = 0; i < sortedFinalLosers.length; i++) {
      await supabase.from('players').update({ final_position: loserBase + i }).eq('id', sortedFinalLosers[i]);
    }
  }

  if (fifthPlaceMatch) {
    const fifthWinners = rankWithinPair(getMatchWinner(fifthPlaceMatch));
    const fifthLosers = rankWithinPair(getMatchLoser(fifthPlaceMatch));

    console.log('[CALCULATE_POSITIONS] 5th place winners:', fifthWinners);
    console.log('[CALCULATE_POSITIONS] 5th place losers:', fifthLosers);

    for (let i = 0; i < fifthWinners.length; i++) {
      await supabase.from('players').update({ final_position: 5 + i }).eq('id', fifthWinners[i]);
    }

    const loserBase = seventhPlaceMatch ? 6 : 5 + fifthWinners.length;
    if (!seventhPlaceMatch) {
      for (let i = 0; i < fifthLosers.length; i++) {
        await supabase.from('players').update({ final_position: loserBase + i }).eq('id', fifthLosers[i]);
      }
    }
  }

  if (seventhPlaceMatch) {
    const seventhWinners = rankWithinPair(getMatchWinner(seventhPlaceMatch));
    const seventhLosers = rankWithinPair(getMatchLoser(seventhPlaceMatch));

    console.log('[CALCULATE_POSITIONS] 7th place winners:', seventhWinners);
    console.log('[CALCULATE_POSITIONS] 8th place losers:', seventhLosers);

    for (let i = 0; i < seventhWinners.length; i++) {
      await supabase.from('players').update({ final_position: 7 + i }).eq('id', seventhWinners[i]);
    }
    for (let i = 0; i < seventhLosers.length; i++) {
      await supabase.from('players').update({ final_position: 7 + seventhWinners.length + i }).eq('id', seventhLosers[i]);
    }
  }

  console.log('[CALCULATE_POSITIONS] Completed successfully');
  return true;
}

async function updatePlayerStanding(
  leagueId: string,
  playerId: string | null,
  playerName: string | null,
  points: number,
  position: number
) {
  if (!playerName) return;

  // ALWAYS look up by name first to avoid duplicates
  const { data: existingPlayer } = await supabase
    .from('players')
    .select('id')
    .ilike('name', playerName.trim())
    .maybeSingle();

  let finalPlayerId: string;

  if (existingPlayer) {
    finalPlayerId = existingPlayer.id;
  } else if (playerId) {
    // Use the provided ID if no player found by name
    finalPlayerId = playerId;
  } else {
    // Create new player if none exists
    const { data: newPlayer } = await supabase
      .from('players')
      .insert({ name: playerName.trim() })
      .select('id')
      .single();

    if (!newPlayer) return;
    finalPlayerId = newPlayer.id;
  }

  // Look up existing standing by player name to consolidate duplicates
  const { data: existingStandings } = await supabase
    .from('league_standings')
    .select('*')
    .eq('league_id', leagueId)
    .eq('entity_type', 'player')
    .ilike('entity_name', playerName.trim());

  if (existingStandings && existingStandings.length > 0) {
    // Use the first standing and consolidate
    const primaryStanding = existingStandings[0];

    // Calculate cumulative stats from all standings with this name
    let totalPoints = points;
    let totalTournaments = 1;
    let bestPos = position;

    existingStandings.forEach(standing => {
      totalPoints += standing.total_points;
      totalTournaments += standing.tournaments_played;
      if (standing.best_position < bestPos) {
        bestPos = standing.best_position;
      }
    });

    // Update the primary standing
    await supabase
      .from('league_standings')
      .update({
        entity_id: finalPlayerId,
        total_points: totalPoints,
        tournaments_played: totalTournaments,
        best_position: bestPos,
        updated_at: new Date().toISOString(),
      })
      .eq('id', primaryStanding.id);

    // Delete duplicate standings
    if (existingStandings.length > 1) {
      const idsToDelete = existingStandings.slice(1).map(s => s.id);
      await supabase
        .from('league_standings')
        .delete()
        .in('id', idsToDelete);
    }
  } else {
    // No existing standing, create new one
    await supabase
      .from('league_standings')
      .insert({
        league_id: leagueId,
        entity_type: 'player',
        entity_id: finalPlayerId,
        entity_name: playerName.trim(),
        total_points: points,
        tournaments_played: 1,
        best_position: position,
      });
  }
}

export async function updateLeagueStandings(tournamentId: string) {
  console.log('[LEAGUE_UPDATE] updateLeagueStandings called for tournament:', tournamentId);

  const { data: tournament, error: tournamentError } = await supabase
    .from('tournaments')
    .select('status')
    .eq('id', tournamentId)
    .single();

  console.log('[LEAGUE_UPDATE] Tournament data:', tournament);
  console.log('[LEAGUE_UPDATE] Tournament error:', tournamentError);

  if (!tournament || tournament.status !== 'completed') {
    console.log('[LEAGUE_UPDATE] Skipping - no tournament or not completed. Status:', tournament?.status);
    return;
  }

  const { data: tournamentLeagues, error: leaguesError } = await supabase
    .from('tournament_leagues')
    .select('league_id, league_category')
    .eq('tournament_id', tournamentId);

  console.log('[LEAGUE_UPDATE] Tournament leagues:', tournamentLeagues);
  console.log('[LEAGUE_UPDATE] Tournament leagues error:', leaguesError);

  if (!tournamentLeagues || tournamentLeagues.length === 0) {
    console.log('[LEAGUE_UPDATE] Skipping - no leagues associated with this tournament');
    return;
  }

  // Verificar se há equipas com final_position e dados completos
  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select(`
      id, 
      name, 
      final_position, 
      player1_id, 
      player2_id
    `)
    .eq('tournament_id', tournamentId);

  console.log('[LEAGUE_UPDATE] Teams found:', teams?.length || 0);
  console.log('[LEAGUE_UPDATE] Teams with final_position:', teams?.filter(t => t.final_position).length || 0);
  console.log('[LEAGUE_UPDATE] Teams data:', teams);

  // Verificar se os player IDs existem na tabela players e têm nomes
  if (teams && teams.length > 0) {
    const allPlayerIds = teams.flatMap(t => [t.player1_id, t.player2_id]).filter(Boolean);
    console.log('[LEAGUE_UPDATE] Player IDs from teams:', allPlayerIds);
    
    const { data: playersFromIds, error: playersFromIdsError } = await supabase
      .from('players')
      .select('id, name, tournament_id')
      .in('id', allPlayerIds);
    
    console.log('[LEAGUE_UPDATE] Players found by ID:', playersFromIds?.length || 0);
    console.log('[LEAGUE_UPDATE] Players from IDs data:', playersFromIds);
    console.log('[LEAGUE_UPDATE] Players with names:', playersFromIds?.filter(p => p.name).length || 0);
    
    if (playersFromIds && playersFromIds.length === 0) {
      console.warn('[LEAGUE_UPDATE] WARNING: No players found with the IDs from teams! This is why RPC fails.');
    }
  }

  // Verificar se há jogadores individuais com final_position
  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('id, name, final_position')
    .eq('tournament_id', tournamentId);

  console.log('[LEAGUE_UPDATE] Players found:', players?.length || 0);
  console.log('[LEAGUE_UPDATE] Players with final_position:', players?.filter(p => p.final_position).length || 0);

  const uniqueLeagueIds = [...new Set(tournamentLeagues.map(tl => tl.league_id))];
  console.log('[LEAGUE_UPDATE] Associated leagues:', uniqueLeagueIds);

  for (const leagueId of uniqueLeagueIds) {
    console.log('[LEAGUE_UPDATE] Calling recalculate_league_standings for:', leagueId);
    
    // Buscar dados da liga para ver o sistema de pontuação
    const { data: leagueData, error: leagueError } = await supabase
      .from('leagues')
      .select('id, name, scoring_system, category_scoring_systems')
      .eq('id', leagueId)
      .single();
    
    console.log('[LEAGUE_UPDATE] Liga:', leagueData?.name);
    console.log('[LEAGUE_UPDATE] scoring_system:', leagueData?.scoring_system);
    console.log('[LEAGUE_UPDATE] category_scoring_systems:', leagueData?.category_scoring_systems);
    
    // Verificar standings ANTES da chamada RPC
    const { data: standingsBefore } = await supabase
      .from('league_standings')
      .select('*')
      .eq('league_id', leagueId);
    console.log('[LEAGUE_UPDATE] Standings BEFORE RPC:', standingsBefore?.length || 0, 'entries');
    
    const { error, data } = await supabase.rpc('recalculate_league_standings_for_league', {
      league_uuid: leagueId
    });

    if (error) {
      console.error('[LEAGUE_UPDATE] Error recalculating league standings:', error);
      console.error('[LEAGUE_UPDATE] Error details:', JSON.stringify(error));
    } else {
      console.log('[LEAGUE_UPDATE] RPC executed for league:', leagueId);
      
      // Verificar standings DEPOIS da chamada RPC
      const { data: standingsAfter, error: standingsError } = await supabase
        .from('league_standings')
        .select('*')
        .eq('league_id', leagueId);
      
      console.log('[LEAGUE_UPDATE] Standings AFTER RPC:', standingsAfter?.length || 0, 'entries');
      console.log('[LEAGUE_UPDATE] Standings error:', standingsError);
      if (standingsAfter && standingsAfter.length > 0) {
        console.log('[LEAGUE_UPDATE] Sample standing:', standingsAfter[0]);
      }
    }
  }

  console.log('[LEAGUE_UPDATE] League standings updated for all associated leagues');
}

export async function recalculateLeagueStandingsForTournament(tournamentId: string) {
  console.log('Recalculating standings for tournament:', tournamentId);

  const { data: tournamentLeagues } = await supabase
    .from('tournament_leagues')
    .select('league_id')
    .eq('tournament_id', tournamentId);

  if (!tournamentLeagues || tournamentLeagues.length === 0) {
    console.log('No leagues associated');
    return;
  }

  const uniqueLeagueIds = [...new Set(tournamentLeagues.map(tl => tl.league_id))];
  console.log('Recalculating for leagues:', uniqueLeagueIds);

  for (const leagueId of uniqueLeagueIds) {
    console.log('Calling recalculate_league_standings for:', leagueId);
    const { error } = await supabase.rpc('recalculate_league_standings_for_league', {
      league_uuid: leagueId
    });

    if (error) {
      console.error('Error recalculating league standings:', error);
    } else {
      console.log('Recalculated standings for league:', leagueId);
    }
  }

  console.log('Recalculation complete');
}

async function updateLeagueStandingsIncremental(tournamentId: string) {
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('status')
    .eq('id', tournamentId)
    .single();

  if (!tournament || tournament.status !== 'completed') {
    return;
  }

  const { data: tournamentCategory } = await supabase
    .from('tournament_categories')
    .select('name')
    .eq('tournament_id', tournamentId)
    .maybeSingle();

  const tournamentCategoryName = tournamentCategory?.name || null;

  const { data: tournamentLeagues } = await supabase
    .from('tournament_leagues')
    .select('league_id, league_category')
    .eq('tournament_id', tournamentId);

  if (!tournamentLeagues || tournamentLeagues.length === 0) {
    return;
  }

  const leagueIds = tournamentLeagues.map(tl => tl.league_id);

  const { data: leagues } = await supabase
    .from('leagues')
    .select('id, scoring_system, categories, category_scoring_systems')
    .in('id', leagueIds);

  if (!leagues || leagues.length === 0) {
    return;
  }

  const { data: teams } = await supabase
    .from('teams')
    .select(`
      id,
      name,
      final_position,
      player1_id,
      player2_id,
      player1:players!teams_player1_id_fkey(id, name),
      player2:players!teams_player2_id_fkey(id, name)
    `)
    .eq('tournament_id', tournamentId)
    .not('final_position', 'is', null);

  const { data: individualPlayers } = await supabase
    .from('players')
    .select('id, name, final_position')
    .eq('tournament_id', tournamentId)
    .not('final_position', 'is', null);

  for (const league of leagues) {
    const tournamentLeagueEntry = tournamentLeagues.find(tl => tl.league_id === league.id);
    const leagueCategory = tournamentLeagueEntry?.league_category || tournamentCategoryName;

    let scoringSystem: Record<string, number> = league.scoring_system;

    if (leagueCategory && league.category_scoring_systems && league.category_scoring_systems[leagueCategory]) {
      scoringSystem = league.category_scoring_systems[leagueCategory];
    }

    if (teams && teams.length > 0) {
      for (const team of teams) {
        if (team.final_position) {
          const points = scoringSystem[team.final_position.toString()] || 0;

          if (team.player1 && team.player1.name) {
            await addToPlayerStanding(league.id, team.player1.name, points, team.final_position);
          }

          if (team.player2 && team.player2.name) {
            await addToPlayerStanding(league.id, team.player2.name, points, team.final_position);
          }
        }
      }
    }

    if (individualPlayers && individualPlayers.length > 0) {
      for (const player of individualPlayers) {
        if (player.final_position && player.name) {
          const points = scoringSystem[player.final_position.toString()] || 0;
          await addToPlayerStanding(league.id, player.name, points, player.final_position);
        }
      }
    }
  }
}

async function addToPlayerStanding(
  leagueId: string,
  playerName: string,
  points: number,
  position: number
) {
  const { data: existing } = await supabase
    .from('league_standings')
    .select('*')
    .eq('league_id', leagueId)
    .eq('entity_type', 'player')
    .ilike('entity_name', playerName.trim())
    .maybeSingle();

  if (existing) {
    await supabase
      .from('league_standings')
      .update({
        total_points: existing.total_points + points,
        tournaments_played: existing.tournaments_played + 1,
        best_position: Math.min(existing.best_position, position),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('league_standings')
      .insert({
        league_id: leagueId,
        entity_type: 'player',
        entity_name: playerName.trim(),
        total_points: points,
        tournaments_played: 1,
        best_position: position,
      });
  }
}
