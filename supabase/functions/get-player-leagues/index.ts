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
    let body: { player_account_id?: string } = {};
    try {
      const raw = await req.text();
      body = raw ? JSON.parse(raw) : {};
    } catch (_) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const player_account_id = body.player_account_id;
    if (!player_account_id) {
      return new Response(JSON.stringify({ error: 'player_account_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Buscar player_account para obter nome e telefone
    const { data: playerAccount, error: paError } = await supabase
      .from('player_accounts')
      .select('name, phone_number')
      .eq('id', player_account_id)
      .maybeSingle();

    if (paError || !playerAccount) {
      return new Response(JSON.stringify({ error: 'Player account not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const playerName = (playerAccount.name || '').trim();
    const playerPhone = (playerAccount as any).phone_number;

    // Buscar todos os players que correspondem ao nome ou telefone
    const conditions: string[] = [];
    if (playerPhone) {
      conditions.push(`phone_number.eq.${playerPhone}`);
    }
    if (playerName) {
      conditions.push(`name.ilike.%${playerName}%`);
    }

    let playerIds: string[] = [];
    let teamIds: string[] = [];

    if (conditions.length > 0) {
      const { data: players } = await supabase
        .from('players')
        .select('id')
        .or(conditions.join(','));

      if (players && players.length > 0) {
        playerIds = players.map((p: any) => p.id);

        // Buscar teams associadas a esses players
        const playerConditions = playerIds.map((id) => `player1_id.eq.${id},player2_id.eq.${id}`).join(',');
        if (playerConditions) {
          const { data: teams } = await supabase
            .from('teams')
            .select('id')
            .or(playerConditions);

          if (teams && teams.length > 0) {
            teamIds = teams.map((t: any) => t.id);
          }
        }
      }
    }

    // Buscar league_standings por player_account_id, entity_id (player ou team) ou entity_name
    const standingsConditions: string[] = [`player_account_id.eq.${player_account_id}`];
    
    if (playerName) {
      standingsConditions.push(`entity_name.ilike.%${playerName}%`);
    }
    
    if (playerIds.length > 0) {
      standingsConditions.push(`entity_id.in.(${playerIds.join(',')})`);
    }
    
    if (teamIds.length > 0) {
      standingsConditions.push(`entity_id.in.(${teamIds.join(',')})`);
    }

    const { data: standings, error: standingsError } = await supabase
      .from('league_standings')
      .select(`
        id, league_id, total_points, tournaments_played, entity_name,
        leagues!inner(id, name)
      `)
      .or(standingsConditions.join(','))
      .order('total_points', { ascending: false });

    if (standingsError) {
      console.error('[get-player-leagues] Standings error:', standingsError);
      return new Response(JSON.stringify({ error: standingsError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!standings || standings.length === 0) {
      return new Response(JSON.stringify({ leagues: [] }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Para cada liga, buscar a posição completa do jogador
    const leagueData = await Promise.all(
      (standings as any[]).map(async (s) => {
        const leagueId = s.leagues?.id;
        if (!leagueId) return null;

        // Buscar todas as classificações da liga para determinar a posição
        const { data: allStandings } = await supabase
          .from('league_standings')
          .select('id, total_points')
          .eq('league_id', leagueId)
          .order('total_points', { ascending: false });

        const position = allStandings ? allStandings.findIndex((st: any) => st.id === s.id) + 1 : 0;

        return {
          league_id: leagueId,
          league_name: s.leagues?.name || '',
          position,
          total_participants: allStandings?.length || 0,
          points: s.total_points,
          tournaments_played: s.tournaments_played,
        };
      })
    );

    // Remover duplicatas (mesmo league_id) e nulls
    const uniqueLeagues = leagueData
      .filter((l) => l != null)
      .reduce((acc: any[], current: any) => {
        const exists = acc.find((l: any) => l.league_id === current.league_id);
        if (!exists) acc.push(current);
        return acc;
      }, []);

    console.log(`[get-player-leagues] Found ${uniqueLeagues.length} leagues for player ${playerName}`);

    return new Response(JSON.stringify({ leagues: uniqueLeagues }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[get-player-leagues] Error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
