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
    const { league_id, player_name } = await req.json();
    if (!league_id) {
      return new Response(JSON.stringify({ error: 'league_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Buscar standings e tournament_leagues para determinar categorias
    const [standingsRes, tlRes] = await Promise.all([
      supabase
        .from('league_standings')
        .select('entity_name, entity_id, total_points, tournaments_played, best_position, category')
        .eq('league_id', league_id)
        .order('total_points', { ascending: false }),
      supabase
        .from('tournament_leagues')
        .select('league_category, tournament_id')
        .eq('league_id', league_id),
    ]);

    if (standingsRes.error) {
      return new Response(JSON.stringify({ error: standingsRes.error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const allStandings = standingsRes.data || [];
    const tournamentLeagues = tlRes.data || [];

    if (allStandings.length === 0) {
      return new Response(JSON.stringify({ standings: [], categories: [] }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const pName = (player_name || '').trim().toLowerCase();

    // Buscar categorias dos jogadores
    // Fonte 1: players.player_category (por entity_id)
    // Fonte 2: organizer_players.player_category (por nome - fallback)
    const entityIds = allStandings.map(s => s.entity_id).filter(Boolean);
    const entityNames = allStandings.map(s => (s.entity_name || '').trim()).filter(Boolean);
    
    const [playersRes, orgPlayersRes] = await Promise.all([
      supabase
        .from('players')
        .select('id, name, player_category')
        .in('id', entityIds),
      supabase
        .from('organizer_players')
        .select('name, player_category')
        .not('player_category', 'is', null),
    ]);

    // Criar mapa: player_id -> categoria e player_name -> categoria
    const playerCategoryMap = new Map<string, string>();
    const playerNameCategoryMap = new Map<string, string>();
    
    // Primeiro popular com organizer_players (fallback)
    for (const op of (orgPlayersRes.data || [])) {
      if (op.player_category) {
        const nameKey = (op.name || '').trim().toLowerCase();
        if (nameKey) {
          playerNameCategoryMap.set(nameKey, op.player_category);
        }
      }
    }
    
    // Depois sobrepor com players.player_category (prioridade)
    for (const p of (playersRes.data || [])) {
      if (p.player_category) {
        playerCategoryMap.set(p.id, p.player_category);
        const nameKey = (p.name || '').trim().toLowerCase();
        if (nameKey) {
          playerNameCategoryMap.set(nameKey, p.player_category);
        }
      }
    }

    // Determinar se há múltiplas categorias entre os jogadores
    const uniquePlayerCategories = new Set<string>();
    for (const s of allStandings) {
      let category: string | undefined;
      if (s.entity_id) {
        category = playerCategoryMap.get(s.entity_id);
      }
      if (!category && s.entity_name) {
        const nameKey = s.entity_name.trim().toLowerCase();
        category = playerNameCategoryMap.get(nameKey);
      }
      if (category) {
        uniquePlayerCategories.add(category);
      }
    }

    const hasMultipleCategories = uniquePlayerCategories.size > 1;

    let categories: any[] = [];

    if (hasMultipleCategories) {
      // Classificar standings por categoria
      const categoryStandingsMap = new Map<string, any[]>();
      
      for (const s of allStandings) {
        // Determinar categoria do jogador
        let category: string | undefined;
        
        // 1. Tentar por entity_id
        if (s.entity_id) {
          category = playerCategoryMap.get(s.entity_id);
        }
        
        // 2. Fallback: tentar por nome
        if (!category && s.entity_name) {
          const nameKey = s.entity_name.trim().toLowerCase();
          category = playerNameCategoryMap.get(nameKey);
        }
        
        // Se encontrou categoria, adicionar ao mapa
        if (category) {
          if (!categoryStandingsMap.has(category)) {
            categoryStandingsMap.set(category, []);
          }
          categoryStandingsMap.get(category)!.push(s);
        }
      }

      // Criar array de categorias ordenadas
      const sortedCats = Array.from(categoryStandingsMap.keys()).sort((a, b) =>
        a.localeCompare(b, 'pt', { numeric: true })
      );

      categories = sortedCats.map(catName => {
        const items = categoryStandingsMap.get(catName)!
          .sort((a, b) => b.total_points - a.total_points)
          .map((s, index) => ({
            position: index + 1,
            entity_name: s.entity_name,
            total_points: s.total_points,
            tournaments_played: s.tournaments_played,
            best_position: s.best_position ?? 0,
            is_current_player: pName ? (s.entity_name || '').trim().toLowerCase() === pName : false,
          }));
        return { category_name: catName, standings: items };
      });
    }

    // Standings geral (sempre incluído)
    const flatStandings = allStandings
      .sort((a, b) => b.total_points - a.total_points)
      .map((s, index) => ({
        position: index + 1,
        entity_name: s.entity_name,
        total_points: s.total_points,
        tournaments_played: s.tournaments_played,
        best_position: s.best_position ?? 0,
        is_current_player: pName ? (s.entity_name || '').trim().toLowerCase() === pName : false,
      }));

    return new Response(JSON.stringify({ 
      standings: flatStandings,
      categories,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
