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
      return new Response(
        JSON.stringify({ error: 'Missing or invalid Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user and get player account
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: playerAccount } = await supabaseAdmin
      .from('player_accounts')
      .select('id, name, phone_number')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!playerAccount) {
      return new Response(
        JSON.stringify({ leagueStandings: [], pastTournaments: [], pastTournamentDetails: {} }),
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

    console.log('[EdgeFn] League query conditions:', conditions, 'playerAccountId:', playerAccount.id, 'name:', name, 'playerIds:', playerIds, 'teamIds:', teamIds);

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

    console.log('[EdgeFn] League standings result:', standings?.length ?? 0, 'error:', standingsError);

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
        const { data: tournament } = await supabaseAdmin.from('tournaments').select('name').eq('id', t.id).maybeSingle();
        const { data: matches } = await supabaseAdmin
          .from('matches')
          .select('id, team1_id, team2_id, player1_individual_id, player2_individual_id, player3_individual_id, player4_individual_id, team1_score_set1, team2_score_set1, team1_score_set2, team2_score_set2, team1_score_set3, team2_score_set3, status, round')
          .eq('tournament_id', t.id)
          .eq('status', 'completed');
        const { data: teams } = await supabaseAdmin.from('teams').select('id, name, group_name, final_position, player1_id, player2_id').eq('tournament_id', t.id);
        const { data: players } = await supabaseAdmin.from('players').select('id, name, group_name').eq('tournament_id', t.id);

        // Mapa de nomes de jogadores para usar nos standings das equipas
        const playerNamesMap = new Map<string, string>();
        if (players) {
          players.forEach((p: any) => playerNamesMap.set(p.id, p.name));
        }

        const isIndividual = (players?.length || 0) > 0 && (teams?.length || 0) === 0;
        const standingsMap = new Map<string, any>();

        if (isIndividual && players) {
          players.forEach((p: any) => {
            standingsMap.set(p.id, { id: p.id, name: p.name, group_name: p.group_name || 'Geral', wins: 0, losses: 0, points_for: 0, points_against: 0, points: 0 });
          });
          (matches || []).forEach((m: any) => {
            const t1s = (m.team1_score_set1 || 0) + (m.team1_score_set2 || 0) + (m.team1_score_set3 || 0);
            const t2s = (m.team2_score_set1 || 0) + (m.team2_score_set2 || 0) + (m.team2_score_set3 || 0);
            [m.player1_individual_id, m.player2_individual_id].filter(Boolean).forEach((pid: string) => {
              const s = standingsMap.get(pid);
              if (s) {
                s.points_for += t1s; s.points_against += t2s;
                if (t1s > t2s) { s.wins++; s.points += 2; } else { s.losses++; s.points += 1; }
              }
            });
            [m.player3_individual_id, m.player4_individual_id].filter(Boolean).forEach((pid: string) => {
              const s = standingsMap.get(pid);
              if (s) {
                s.points_for += t2s; s.points_against += t1s;
                if (t2s > t1s) { s.wins++; s.points += 2; } else { s.losses++; s.points += 1; }
              }
            });
          });
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

        const getHeadToHeadWinner = (idA: string, idB: string): string | null => {
          const directMatch = (matches || []).find((m: any) =>
            (m.team1_id === idA && m.team2_id === idB) || (m.team1_id === idB && m.team2_id === idA)
          );
          if (!directMatch || !directMatch.team1_id || !directMatch.team2_id) return null;
          const t1g = (directMatch.team1_score_set1 || 0) + (directMatch.team1_score_set2 || 0) + (directMatch.team1_score_set3 || 0);
          const t2g = (directMatch.team2_score_set1 || 0) + (directMatch.team2_score_set2 || 0) + (directMatch.team2_score_set3 || 0);
          if (t1g === t2g) return null;
          return directMatch.team1_id === idA ? (t1g > t2g ? idA : idB) : (t2g > t1g ? idA : idB);
        };

        const groupTiedCount = new Map<string, number>();
        Array.from(standingsMap.values()).forEach((s: any) => {
          if (!s.final_position) {
            const key = `${s.group_name || 'Geral'}__${s.wins}__${s.points}`;
            groupTiedCount.set(key, (groupTiedCount.get(key) || 0) + 1);
          }
        });

        const entityIds = new Set<string>([...playerIds, ...teamIds]);
        const standingsArray = Array.from(standingsMap.values()).sort((a, b) => {
          if (a.final_position && b.final_position) return a.final_position - b.final_position;
          if (a.final_position) return -1;
          if (b.final_position) return 1;
          if (b.wins !== a.wins) return b.wins - a.wins;
          if (b.points !== a.points) return b.points - a.points;
          const gKey = `${a.group_name || 'Geral'}__${a.wins}__${a.points}`;
          if ((groupTiedCount.get(gKey) || 0) === 2) {
            const h2h = getHeadToHeadWinner(a.id, b.id);
            if (h2h === a.id) return -1;
            if (h2h === b.id) return 1;
          }
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
