import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface LevelRange {
  label: string;
  min: number;
  max: number;
}

function parseLevelRanges(categories: string[]): LevelRange[] {
  return categories.map(cat => {
    const c = cat.trim();
    const plusMatch = c.match(/^[+>]\s*(\d+(?:\.\d+)?)$/);
    if (plusMatch) {
      return { label: c, min: parseFloat(plusMatch[1]), max: Infinity };
    }
    const rangeMatch = c.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
    if (rangeMatch) {
      return { label: c, min: parseFloat(rangeMatch[1]), max: parseFloat(rangeMatch[2]) };
    }
    return null;
  }).filter((r): r is LevelRange => r !== null);
}

function getLevelCategory(level: number | null, ranges: LevelRange[]): string | null {
  if (level == null || ranges.length === 0) return null;
  for (const r of ranges) {
    if (level >= r.min && (r.max === Infinity || level <= r.max)) return r.label;
  }
  return null;
}

function isGenderCategories(categories: string[]): boolean {
  if (categories.length === 0) return false;
  const genderLabels = ['masculino', 'feminino', 'male', 'female', 'masc', 'fem'];
  return categories.every(c => genderLabels.includes(c.trim().toLowerCase()));
}

function getGenderCategory(playerCategory: string | null, gender: string | null, categories: string[]): string | null {
  const isMale = (playerCategory && playerCategory.startsWith('M')) || gender === 'male';
  const isFemale = (playerCategory && playerCategory.startsWith('F')) || gender === 'female';
  if (!isMale && !isFemale) return null;
  for (const cat of categories) {
    const lower = cat.trim().toLowerCase();
    if (isMale && (lower === 'masculino' || lower === 'male' || lower === 'masc')) return cat;
    if (isFemale && (lower === 'feminino' || lower === 'female' || lower === 'fem')) return cat;
  }
  return null;
}

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

    // Fetch league info, standings, and tournament_leagues
    const [leagueRes, standingsRes, tlRes] = await Promise.all([
      supabase
        .from('leagues')
        .select('categories')
        .eq('id', league_id)
        .single(),
      supabase
        .from('league_standings')
        .select('entity_name, entity_id, total_points, tournaments_played, best_position, player_account_id, category')
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
    const leagueCategories: string[] = leagueRes.data?.categories || [];
    const levelRanges = parseLevelRanges(leagueCategories);
    const useLevelRanges = levelRanges.length > 0;
    const useGenderCategories = !useLevelRanges && isGenderCategories(leagueCategories);

    if (allStandings.length === 0) {
      return new Response(JSON.stringify({ standings: [], categories: [] }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const pName = (player_name || '').trim().toLowerCase();

    // Fetch player info from player_accounts
    const playerAccountIds = allStandings
      .map(s => s.player_account_id)
      .filter((id): id is string => id != null);

    let levelByAccountId = new Map<string, number>();
    let levelByName = new Map<string, number>();
    let genderByAccountId = new Map<string, { player_category: string | null; gender: string | null }>();
    let genderByName = new Map<string, { player_category: string | null; gender: string | null }>();

    if ((useLevelRanges || useGenderCategories) && playerAccountIds.length > 0) {
      const { data: accounts } = await supabase
        .from('player_accounts')
        .select('id, name, level, player_category, gender')
        .in('id', playerAccountIds);

      if (accounts) {
        for (const a of accounts) {
          if (a.level != null) {
            levelByAccountId.set(a.id, Number(a.level));
            const nameKey = (a.name || '').trim().toLowerCase();
            if (nameKey) levelByName.set(nameKey, Number(a.level));
          }
          const gInfo = { player_category: a.player_category || null, gender: (a as any).gender || null };
          genderByAccountId.set(a.id, gInfo);
          const nameKey = (a.name || '').trim().toLowerCase();
          if (nameKey) genderByName.set(nameKey, gInfo);
        }
      }
    }

    // Determine category for each standing
    const standingsWithCategory = allStandings.map(s => {
      let categoryLabel: string | null = null;

      if (useLevelRanges) {
        let level: number | null = null;
        if (s.player_account_id && levelByAccountId.has(s.player_account_id)) {
          level = levelByAccountId.get(s.player_account_id)!;
        } else if (s.entity_name) {
          const nameKey = s.entity_name.trim().toLowerCase();
          level = levelByName.get(nameKey) ?? null;
        }
        categoryLabel = getLevelCategory(level, levelRanges);
      } else if (useGenderCategories) {
        let gInfo: { player_category: string | null; gender: string | null } | undefined;
        if (s.player_account_id) gInfo = genderByAccountId.get(s.player_account_id);
        if (!gInfo && s.entity_name) gInfo = genderByName.get(s.entity_name.trim().toLowerCase());
        if (gInfo) {
          categoryLabel = getGenderCategory(gInfo.player_category, gInfo.gender, leagueCategories);
        }
      }

      return { ...s, resolved_category: categoryLabel };
    });

    // Build category tabs
    let categories: any[] = [];

    if (useLevelRanges || useGenderCategories) {
      const categoryStandingsMap = new Map<string, any[]>();
      for (const s of standingsWithCategory) {
        if (s.resolved_category) {
          if (!categoryStandingsMap.has(s.resolved_category)) {
            categoryStandingsMap.set(s.resolved_category, []);
          }
          categoryStandingsMap.get(s.resolved_category)!.push(s);
        }
      }

      // Order categories by their position in the league's categories array
      const orderedCats = leagueCategories.filter(c => categoryStandingsMap.has(c));

      categories = orderedCats.map(catName => {
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
    } else {
      // Fallback: use old player_category-based logic
      const entityIds = allStandings.map(s => s.entity_id).filter(Boolean);
      const [playersRes, orgPlayersRes] = await Promise.all([
        supabase.from('players').select('id, name, player_category').in('id', entityIds),
        supabase.from('organizer_players').select('name, player_category').not('player_category', 'is', null),
      ]);

      const playerCategoryMap = new Map<string, string>();
      const playerNameCategoryMap = new Map<string, string>();

      for (const op of (orgPlayersRes.data || [])) {
        if (op.player_category) {
          const nameKey = (op.name || '').trim().toLowerCase();
          if (nameKey) playerNameCategoryMap.set(nameKey, op.player_category);
        }
      }
      for (const p of (playersRes.data || [])) {
        if (p.player_category) {
          playerCategoryMap.set(p.id, p.player_category);
          const nameKey = (p.name || '').trim().toLowerCase();
          if (nameKey) playerNameCategoryMap.set(nameKey, p.player_category);
        }
      }

      const uniquePlayerCategories = new Set<string>();
      for (const s of allStandings) {
        let cat: string | undefined;
        if (s.entity_id) cat = playerCategoryMap.get(s.entity_id);
        if (!cat && s.entity_name) cat = playerNameCategoryMap.get(s.entity_name.trim().toLowerCase());
        if (cat) uniquePlayerCategories.add(cat);
      }

      if (uniquePlayerCategories.size > 1) {
        const categoryStandingsMap = new Map<string, any[]>();
        for (const s of allStandings) {
          let cat: string | undefined;
          if (s.entity_id) cat = playerCategoryMap.get(s.entity_id);
          if (!cat && s.entity_name) cat = playerNameCategoryMap.get(s.entity_name.trim().toLowerCase());
          if (cat) {
            if (!categoryStandingsMap.has(cat)) categoryStandingsMap.set(cat, []);
            categoryStandingsMap.get(cat)!.push(s);
          }
        }

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
    }

    // Global standings (always included)
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
