import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      console.error('[EdgeFn] Missing Authorization header');
      return new Response(
        JSON.stringify({ error: 'Missing or invalid Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Decode JWT to get user ID (avoids auth.getUser network call that can fail)
    const token = authHeader.replace('Bearer ', '');
    let userId: string;
    try {
      const [, payloadB64] = token.split('.');
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
      userId = payload.sub;
      if (!userId) throw new Error('No sub in JWT');
      console.log('[EdgeFn] Decoded userId from JWT:', userId);
    } catch (jwtErr) {
      console.error('[EdgeFn] JWT decode error:', jwtErr);
      // Fallback: try auth.getUser
      const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
      if (authError || !authUser) {
        console.error('[EdgeFn] auth.getUser also failed:', authError);
        return new Response(
          JSON.stringify({ error: 'Invalid or expired token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      userId = authUser.id;
    }
    const user = { id: userId };

    const { data: playerAccount } = await supabaseAdmin
      .from('player_accounts')
      .select('id, name, phone_number')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!playerAccount) {
      return new Response(
        JSON.stringify({ leagueStandings: [], pastTournaments: [], pastTournamentDetails: {}, stats: null, recentMatches: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const phone = (playerAccount as any).phone_number;
    const name = playerAccount.name || '';
    const playerAccountId = playerAccount.id;

    // OPTIMIZED: Get player IDs using player_account_id (direct FK) with fallback to phone/name
    const [playersByAccountId, playersByPhone, playersByName] = await Promise.all([
      playerAccountId
        ? supabaseAdmin.from('players').select('id, tournament_id').eq('player_account_id', playerAccountId)
        : { data: [] },
      // Fallback: phone match (for players not yet linked)
      phone
        ? supabaseAdmin.from('players').select('id, tournament_id').eq('phone_number', phone).is('player_account_id', null)
        : { data: [] },
      // Fallback: name match (for players without phone or account link)
      name
        ? supabaseAdmin.from('players').select('id, tournament_id').ilike('name', name).is('player_account_id', null)
        : { data: [] },
    ]);

    const allPlayersMap = new Map<string, { id: string; tournament_id: string | null }>();
    [...(playersByAccountId.data || []), ...(playersByPhone.data || []), ...(playersByName.data || [])].forEach((p: any) => {
      allPlayersMap.set(p.id, p);
    });
    const playerIds = Array.from(allPlayersMap.values()).map((p) => p.id);

    // Get team IDs
    let teamIds: string[] = [];
    if (playerIds.length > 0) {
      const playerConditions = playerIds.map((id) => `player1_id.eq.${id},player2_id.eq.${id}`).join(',');
      const { data: myTeams } = await supabaseAdmin.from('teams').select('id').or(playerConditions);
      teamIds = (myTeams || []).map((t: any) => t.id);
    }

    // ═══════════════════════════════════════════════════════════════
    // STATS: Fetch ALL matches for this player (bypasses RLS)
    // ═══════════════════════════════════════════════════════════════
    let stats: any = null;
    let recentMatches: any[] = [];
    
    if (playerIds.length > 0 || teamIds.length > 0) {
      const matchConditions: string[] = [];
      if (teamIds.length > 0) {
        matchConditions.push(`team1_id.in.(${teamIds.join(',')})`);
        matchConditions.push(`team2_id.in.(${teamIds.join(',')})`);
      }
      if (playerIds.length > 0) {
        matchConditions.push(`player1_individual_id.in.(${playerIds.join(',')})`);
        matchConditions.push(`player2_individual_id.in.(${playerIds.join(',')})`);
        matchConditions.push(`player3_individual_id.in.(${playerIds.join(',')})`);
        matchConditions.push(`player4_individual_id.in.(${playerIds.join(',')})`);
      }

      if (matchConditions.length > 0) {
        const { data: allMatches } = await supabaseAdmin
          .from('matches')
          .select(`
            id, tournament_id, court, scheduled_time,
            team1_score_set1, team2_score_set1, team1_score_set2, team2_score_set2, team1_score_set3, team2_score_set3,
            status, round, team1_id, team2_id,
            player1_individual_id, player2_individual_id, player3_individual_id, player4_individual_id,
            tournaments(name),
            team1:teams!matches_team1_id_fkey(id, name),
            team2:teams!matches_team2_id_fkey(id, name),
            p1:players!matches_player1_individual_id_fkey(id, name),
            p2:players!matches_player2_individual_id_fkey(id, name),
            p3:players!matches_player3_individual_id_fkey(id, name),
            p4:players!matches_player4_individual_id_fkey(id, name)
          `)
          .or(matchConditions.join(','))
          .order('scheduled_time', { ascending: false })
          .limit(500);

        let wins = 0;
        let losses = 0;

        const matchResults = (allMatches || []).map((m: any) => {
          const isIndividual = m.p1 || m.p2 || m.p3 || m.p4;
          const team1Name = isIndividual
            ? `${m.p1?.name || 'TBD'}${m.p2 ? ' / ' + m.p2.name : ''}`
            : m.team1?.name || 'TBD';
          const team2Name = isIndividual
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
          let is_winner: boolean | undefined;
          if (m.status === 'completed' && (team1Sets > 0 || team2Sets > 0)) {
            const isPlayerInTeam1 = isIndividual
              ? playerIds.includes(m.p1?.id) || playerIds.includes(m.p2?.id)
              : teamIds.includes(m.team1?.id);
            is_winner = isPlayerInTeam1 ? team1Sets > team2Sets : team2Sets > team1Sets;
            if (is_winner) wins++;
            else losses++;
          }
          const set1 = m.team1_score_set1 != null && m.team2_score_set1 != null
            ? `${m.team1_score_set1}-${m.team2_score_set1}` : undefined;
          const set2 = m.team1_score_set2 != null && m.team2_score_set2 != null && (m.team1_score_set2 > 0 || m.team2_score_set2 > 0)
            ? `${m.team1_score_set2}-${m.team2_score_set2}` : undefined;
          const set3 = m.team1_score_set3 != null && m.team2_score_set3 != null && (m.team1_score_set3 > 0 || m.team2_score_set3 > 0)
            ? `${m.team1_score_set3}-${m.team2_score_set3}` : undefined;
          return {
            id: m.id,
            tournament_id: m.tournament_id,
            tournament_name: (m.tournaments as any)?.name || '',
            court: m.court || '',
            start_time: m.scheduled_time || '',
            team1_name: team1Name,
            team2_name: team2Name,
            score1: team1Sets,
            score2: team2Sets,
            status: m.status,
            round: m.round || '',
            is_winner,
            set1, set2, set3,
          };
        });

        const totalMatches = wins + losses;
        stats = {
          totalMatches,
          wins,
          losses,
          winRate: totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0,
        };

        // Recent completed matches (most recent first, already sorted desc)
        recentMatches = matchResults.filter((m: any) => m.status === 'completed').slice(0, 50);

        console.log('[EdgeFn] Stats computed:', stats, 'recentMatches:', recentMatches.length);
      }
    }

    // Fetch league standings (priority: player_account_id > entity_id > entity_name)
    const conditions: string[] = [];
    
    // First priority: use player_account_id (most reliable)
    if (playerAccount.id) {
      conditions.push(`player_account_id.eq.${playerAccount.id}`);
    }
    
    // Second priority: use entity_id (player IDs from tournaments)
    if (playerIds.length > 0) {
      conditions.push(`entity_id.in.(${playerIds.join(',')})`);
    }
    
    // Third priority: use entity_name as fallback (only if no player_account_id or entity_id)
    if (name?.trim() && (!playerAccount.id || conditions.length === 0)) {
      conditions.push(`entity_name.ilike.%${name.trim()}%`);
    }
    
    // Team IDs (for team-based leagues)
    if (teamIds.length > 0) {
      conditions.push(`entity_id.in.(${teamIds.join(',')})`);
    }

    let standings: any[] = [];
    let standingsError: any = null;
    
    if (conditions.length > 0) {
      const result = await supabaseAdmin
        .from('league_standings')
        .select('id, league_id, total_points, tournaments_played, entity_name, player_account_id, leagues!inner(id, name)')
        .or(conditions.join(','))
        .order('total_points', { ascending: false });
      
      standings = result.data || [];
      standingsError = result.error;
    }

    // OPTIMIZED: Batch fetch all league standings counts instead of N+1 queries
    const leagueStandings: any[] = [];
    if (standings && standings.length > 0) {
      const uniqueLeagueIds = [...new Set((standings as any[]).map((s) => s.leagues?.id).filter(Boolean))];
      
      // Single batch query to get all standings for all leagues
      const { data: allLeagueStandings } = uniqueLeagueIds.length > 0
        ? await supabaseAdmin
            .from('league_standings')
            .select('id, league_id, total_points')
            .in('league_id', uniqueLeagueIds)
            .order('total_points', { ascending: false })
        : { data: [] };

      // Group standings by league
      const standingsByLeague = new Map<string, any[]>();
      (allLeagueStandings || []).forEach((st: any) => {
        const list = standingsByLeague.get(st.league_id) || [];
        list.push(st);
        standingsByLeague.set(st.league_id, list);
      });

      for (const s of standings as any[]) {
        const leagueId = s.leagues?.id;
        const leagueAllStandings = standingsByLeague.get(leagueId) || [];
        const position = leagueAllStandings.findIndex((st: any) => st.id === s.id) + 1;
        leagueStandings.push({
          league_id: leagueId,
          league_name: s.leagues?.name || '',
          position,
          total_participants: leagueAllStandings.length,
          points: s.total_points,
          tournaments_played: s.tournaments_played,
        });
      }
    }

    // Fetch past tournaments (from teams/players)
    const tournamentIds = Array.from(allPlayersMap.values())
      .filter((p) => p.tournament_id)
      .map((p) => p.tournament_id!);
    const playerConditions = playerIds.map((id) => `player1_id.eq.${id},player2_id.eq.${id}`).join(',');
    const { data: teamsData } = await supabaseAdmin
      .from('teams')
      .select('tournament_id, tournaments!inner(id, name, start_date, end_date, status)')
      .or(playerIds.length > 0 ? playerConditions : 'id.eq.00000000-0000-0000-0000-000000000000');

    const teamTournaments = (teamsData as any[] || []).map((t) => t.tournaments);
    const individualTournaments = tournamentIds.length > 0
      ? (await supabaseAdmin.from('tournaments').select('id, name, start_date, end_date, status').in('id', tournamentIds)).data || []
      : [];
    const allTournamentData = [...individualTournaments, ...teamTournaments];
    const uniqueTournaments = allTournamentData.reduce((acc: any[], t: any) => {
      if (!acc.find((x) => x.id === t.id)) acc.push(t);
      return acc;
    }, []);

    const pastTournaments = uniqueTournaments.filter(
      (t) => t.status === 'completed' || t.status === 'finished'
    ).sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());

    // Fetch details for each past tournament (standings + myMatches)
    const pastTournamentDetails: Record<string, any> = {};
    for (const t of pastTournaments) {
      try {
        const [{ data: tournament }, { data: matches }, { data: teams }, { data: players }] = await Promise.all([
          supabaseAdmin.from('tournaments').select('name, format').eq('id', t.id).maybeSingle(),
          supabaseAdmin
            .from('matches')
            .select('id, team1_id, team2_id, player1_individual_id, player2_individual_id, player3_individual_id, player4_individual_id, team1_score_set1, team2_score_set1, team1_score_set2, team2_score_set2, team1_score_set3, team2_score_set3, status, round')
            .eq('tournament_id', t.id)
            .eq('status', 'completed'),
          supabaseAdmin.from('teams').select('id, name, group_name, final_position, player1_id, player2_id').eq('tournament_id', t.id),
          supabaseAdmin.from('players').select('id, name, group_name, final_position').eq('tournament_id', t.id),
        ]);

        // Mapa de nomes de jogadores para usar nos standings das equipas
        const playerNamesMap = new Map<string, string>();
        if (players) {
          players.forEach((p: any) => playerNamesMap.set(p.id, p.name));
        }

        const isIndividual = (players?.length || 0) > 0 && (teams?.length || 0) === 0;
        const isMixedFormat = tournament && ((tournament as any).format === 'mixed_american' || (tournament as any).format === 'mixed_gender');
        const standingsMap = new Map<string, any>();

        if (isIndividual && players) {
          players.forEach((p: any) => {
            standingsMap.set(p.id, { 
              id: p.id, name: p.name, group_name: p.group_name || 'Geral', 
              final_position: p.final_position || null,
              wins: 0, draws: 0, losses: 0, points_for: 0, points_against: 0, points: 0 
            });
          });
          (matches || []).forEach((m: any) => {
            const t1s = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
            const t2s = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);
            [m.player1_individual_id, m.player2_individual_id].filter(Boolean).forEach((pid: string) => {
              const s = standingsMap.get(pid);
              if (s) {
                s.points_for += t1s; s.points_against += t2s;
                if (t1s > t2s) { s.wins++; s.points += 2; } 
                else if (t1s === t2s) { s.draws++; s.points += 1; }
                else { s.losses++; }
              }
            });
            [m.player3_individual_id, m.player4_individual_id].filter(Boolean).forEach((pid: string) => {
              const s = standingsMap.get(pid);
              if (s) {
                s.points_for += t2s; s.points_against += t1s;
                if (t2s > t1s) { s.wins++; s.points += 2; } 
                else if (t2s === t1s) { s.draws++; s.points += 1; }
                else { s.losses++; }
              }
            });
          });

          // Para torneios MISTOS: calcular classificação final com base nas fases finais
          if (isMixedFormat) {
            const allMatches = matches || [];
            const finalMatch = allMatches.find((m: any) => (m.round === 'final' || m.round === 'mixed_final'));
            const thirdPlaceMatch = allMatches.find((m: any) => (m.round === '3rd_place' || m.round === 'mixed_3rd_place'));
            
            // Se não tiver final_position na DB, calcular
            const hasFinalPositions = Array.from(standingsMap.values()).some((s: any) => s.final_position != null);
            
            if (!hasFinalPositions && (finalMatch || thirdPlaceMatch)) {
              const sortByGroupStats = (pIds: string[]): string[] => {
                return [...pIds].sort((a, b) => {
                  const sa = standingsMap.get(a) || { wins: 0, points_for: 0, points_against: 0 };
                  const sb = standingsMap.get(b) || { wins: 0, points_for: 0, points_against: 0 };
                  if (sb.wins !== sa.wins) return sb.wins - sa.wins;
                  const diffA = sa.points_for - sa.points_against;
                  const diffB = sb.points_for - sb.points_against;
                  if (diffB !== diffA) return diffB - diffA;
                  return sb.points_for - sa.points_for;
                });
              };

              const getMatchWL = (match: any) => {
                const t1 = (match.team1_score_set1 || 0) + (match.team1_score_set2 || 0) + (match.team1_score_set3 || 0);
                const t2 = (match.team2_score_set1 || 0) + (match.team2_score_set2 || 0) + (match.team2_score_set3 || 0);
                const team1 = [match.player1_individual_id, match.player2_individual_id].filter(Boolean);
                const team2 = [match.player3_individual_id, match.player4_individual_id].filter(Boolean);
                return { winners: t1 > t2 ? team1 : team2, losers: t1 > t2 ? team2 : team1 };
              };

              const rankedIds = new Set<string>();

              if (finalMatch) {
                const { winners, losers } = getMatchWL(finalMatch);
                sortByGroupStats(winners).forEach((pid: string, idx: number) => {
                  const s = standingsMap.get(pid);
                  if (s) { s.final_position = idx + 1; rankedIds.add(pid); }
                });
                sortByGroupStats(losers).forEach((pid: string, idx: number) => {
                  const s = standingsMap.get(pid);
                  if (s) { s.final_position = 3 + idx; rankedIds.add(pid); }
                });
              }

              if (thirdPlaceMatch) {
                const { winners, losers } = getMatchWL(thirdPlaceMatch);
                sortByGroupStats(winners.filter((id: string) => !rankedIds.has(id))).forEach((pid: string, idx: number) => {
                  const s = standingsMap.get(pid);
                  if (s) { s.final_position = 5 + idx; rankedIds.add(pid); }
                });
                sortByGroupStats(losers.filter((id: string) => !rankedIds.has(id))).forEach((pid: string, idx: number) => {
                  const s = standingsMap.get(pid);
                  if (s) { s.final_position = 7 + idx; rankedIds.add(pid); }
                });
              }

              // Restantes
              const remaining = Array.from(standingsMap.keys()).filter(id => !rankedIds.has(id));
              if (remaining.length > 0) {
                const maxPos = Math.max(...Array.from(standingsMap.values()).map((s: any) => s.final_position || 0));
                sortByGroupStats(remaining).forEach((pid, idx) => {
                  const s = standingsMap.get(pid);
                  if (s) { s.final_position = maxPos + 1 + idx; }
                });
              }
            }
          }

        } else if (teams) {
          teams.forEach((t_: any) => {
            standingsMap.set(t_.id, { id: t_.id, name: t_.name, group_name: t_.group_name || 'Geral', final_position: t_.final_position, wins: 0, draws: 0, losses: 0, points_for: 0, points_against: 0, points: 0, player1_name: t_.player1_id ? playerNamesMap.get(t_.player1_id) : undefined, player2_name: t_.player2_id ? playerNamesMap.get(t_.player2_id) : undefined });
          });
          (matches || []).forEach((m: any) => {
            if (!m.team1_id || !m.team2_id) return;
            const t1s = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
            const t2s = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);
            const s1 = standingsMap.get(m.team1_id);
            const s2 = standingsMap.get(m.team2_id);
            if (s1) {
              s1.points_for += t1s; s1.points_against += t2s;
              if (t1s > t2s) { s1.wins++; s1.points += 2; } else if (t1s === t2s) { s1.draws++; s1.points += 1; } else { s1.losses++; }
            }
            if (s2) {
              s2.points_for += t2s; s2.points_against += t1s;
              if (t2s > t1s) { s2.wins++; s2.points += 2; } else if (t1s === t2s) { s2.draws++; s2.points += 1; } else { s2.losses++; }
            }
          });
        }

        const entityIds = new Set<string>([...playerIds, ...teamIds]);
        const standingsArray = Array.from(standingsMap.values()).sort((a, b) => {
          if (a.final_position && b.final_position) return a.final_position - b.final_position;
          if (a.final_position) return -1;
          if (b.final_position) return 1;
          if (b.wins !== a.wins) return b.wins - a.wins;
          if (b.points !== a.points) return b.points - a.points;
          const diffA = a.points_for - a.points_against;
          const diffB = b.points_for - b.points_against;
          if (diffB !== diffA) return diffB - diffA;
          return (b.points_for || 0) - (a.points_for || 0);
        });

        let playerPosition: number | undefined;
        const posIdx = standingsArray.findIndex((row) => entityIds.has(row.id));
        if (posIdx >= 0) playerPosition = posIdx + 1;

        const teamMatchCond = teamIds.length > 0 ? `team1_id.in.(${teamIds.join(',')}),team2_id.in.(${teamIds.join(',')})` : '';
        const indCond = playerIds.map((id) => `player1_individual_id.eq.${id},player2_individual_id.eq.${id},player3_individual_id.eq.${id},player4_individual_id.eq.${id}`).join(',');
        const allCond = [teamMatchCond, indCond].filter((c) => c.length > 0).join(',');

        let myMatches: any[] = [];
        if (allCond) {
          const { data: playerMatches } = await supabaseAdmin
            .from('matches')
            .select(`
              id, court, scheduled_time, team1_score_set1, team2_score_set1, team1_score_set2, team2_score_set2, team1_score_set3, team2_score_set3, status, round, team1_id, team2_id,
              team1:teams!matches_team1_id_fkey(id, name), team2:teams!matches_team2_id_fkey(id, name),
              p1:players!matches_player1_individual_id_fkey(id, name), p2:players!matches_player2_individual_id_fkey(id, name),
              p3:players!matches_player3_individual_id_fkey(id, name), p4:players!matches_player4_individual_id_fkey(id, name)
            `)
            .eq('tournament_id', t.id)
            .or(allCond)
            .order('scheduled_time', { ascending: true });

          myMatches = (playerMatches || []).map((m: any) => {
            const isInd = m.p1 || m.p2 || m.p3 || m.p4;
            const team1Name = isInd ? `${m.p1?.name || 'TBD'}${m.p2 ? ' / ' + m.p2.name : ''}` : m.team1?.name || 'TBD';
            const team2Name = isInd ? `${m.p3?.name || 'TBD'}${m.p4 ? ' / ' + m.p4.name : ''}` : m.team2?.name || 'TBD';
            const t1Sets = [(m.team1_score_set1 || 0) > (m.team2_score_set1 || 0) ? 1 : 0, (m.team1_score_set2 || 0) > (m.team2_score_set2 || 0) ? 1 : 0, (m.team1_score_set3 || 0) > (m.team2_score_set3 || 0) ? 1 : 0].reduce((a, b) => a + b, 0);
            const t2Sets = [(m.team2_score_set1 || 0) > (m.team1_score_set1 || 0) ? 1 : 0, (m.team2_score_set2 || 0) > (m.team1_score_set2 || 0) ? 1 : 0, (m.team2_score_set3 || 0) > (m.team1_score_set3 || 0) ? 1 : 0].reduce((a, b) => a + b, 0);
            let is_winner: boolean | undefined;
            if (m.status === 'completed' && (t1Sets > 0 || t2Sets > 0)) {
              const inTeam1 = isInd ? playerIds.includes(m.p1?.id) || playerIds.includes(m.p2?.id) : teamIds.includes(m.team1?.id);
              is_winner = inTeam1 ? t1Sets > t2Sets : t2Sets > t1Sets;
            }
            const set1 = m.team1_score_set1 != null && m.team2_score_set1 != null ? `${m.team1_score_set1}-${m.team2_score_set1}` : undefined;
            const set2 = m.team1_score_set2 != null && m.team2_score_set2 != null && (m.team1_score_set2 > 0 || m.team2_score_set2 > 0) ? `${m.team1_score_set2}-${m.team2_score_set2}` : undefined;
            const set3 = m.team1_score_set3 != null && m.team2_score_set3 != null && (m.team1_score_set3 > 0 || m.team2_score_set3 > 0) ? `${m.team1_score_set3}-${m.team2_score_set3}` : undefined;
            return { id: m.id, court: m.court || '', scheduled_time: m.scheduled_time || '', team1_name: team1Name, team2_name: team2Name, team1_score: t1Sets, team2_score: t2Sets, set1, set2, set3, status: m.status, round: m.round || '', is_winner };
          });
        }

        pastTournamentDetails[t.id] = {
          standings: standingsArray,
          myMatches,
          playerPosition,
          tournamentName: tournament?.name || t.name,
        };
      } catch (err) {
        console.error('Error fetching tournament details:', t.id, err);
        pastTournamentDetails[t.id] = { standings: [], myMatches: [], tournamentName: t.name };
      }
    }

    return new Response(
      JSON.stringify({
        leagueStandings,
        pastTournaments: pastTournaments.map((t) => ({ id: t.id, name: t.name, start_date: t.start_date, end_date: t.end_date, status: t.status })),
        pastTournamentDetails,
        stats,
        recentMatches,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('get-player-dashboard error:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
