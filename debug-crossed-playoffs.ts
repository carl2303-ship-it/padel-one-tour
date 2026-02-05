/**
 * Debug crossed playoffs / mixed gender tournaments
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function debug() {
  console.log('🔍 Checking crossed_playoffs and mixed_gender tournaments...\n');

  // Find tournaments with these formats
  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('id, name, format')
    .in('format', ['crossed_playoffs', 'mixed_gender'])
    .like('name', 'TEST2026%');

  if (!tournaments || tournaments.length === 0) {
    console.log('❌ No TEST2026 crossed_playoffs or mixed_gender tournaments found');
    return;
  }

  for (const t of tournaments) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📌 ${t.name} (format: ${t.format})`);
    console.log('='.repeat(60));

    // Get categories
    const { data: categories } = await supabase
      .from('tournament_categories')
      .select('id, name, format, max_teams')
      .eq('tournament_id', t.id)
      .order('name');

    console.log(`\n📋 Categories: ${categories?.length || 0}`);
    categories?.forEach(c => {
      console.log(`   - ${c.name}: format=${c.format}, max_teams=${c.max_teams}`);
    });

    // Get players
    const { data: players } = await supabase
      .from('players')
      .select('id, name, group_name, category_id')
      .eq('tournament_id', t.id);

    console.log(`\n👥 Players: ${players?.length || 0}`);
    
    // Group by category
    const byCategory = new Map<string, any[]>();
    const noCategory: any[] = [];
    
    players?.forEach(p => {
      if (p.category_id) {
        if (!byCategory.has(p.category_id)) {
          byCategory.set(p.category_id, []);
        }
        byCategory.get(p.category_id)!.push(p);
      } else {
        noCategory.push(p);
      }
    });

    categories?.forEach(c => {
      const catPlayers = byCategory.get(c.id) || [];
      const withGroup = catPlayers.filter(p => p.group_name);
      const withoutGroup = catPlayers.filter(p => !p.group_name);
      console.log(`   Category "${c.name}": ${catPlayers.length} players (${withGroup.length} with group, ${withoutGroup.length} without group)`);
      catPlayers.forEach(p => {
        console.log(`      - ${p.name}: group_name=${p.group_name || 'NULL'}`);
      });
    });

    if (noCategory.length > 0) {
      console.log(`   ⚠️  NO CATEGORY: ${noCategory.length} players`);
      noCategory.forEach(p => {
        console.log(`      - ${p.name}: group_name=${p.group_name || 'NULL'}`);
      });
    }

    // Get matches
    const { data: matches } = await supabase
      .from('matches')
      .select('id, match_number, round, player1_individual_id, player2_individual_id, player3_individual_id, player4_individual_id')
      .eq('tournament_id', t.id)
      .order('match_number')
      .limit(10);

    console.log(`\n🎾 Matches (first 10): ${matches?.length || 0}`);
    matches?.forEach(m => {
      const hasTBD = !m.player1_individual_id || !m.player2_individual_id || !m.player3_individual_id || !m.player4_individual_id;
      const status = hasTBD ? '❌ TBD' : '✅ OK';
      console.log(`   #${m.match_number} ${m.round}: ${status}`);
      if (hasTBD) {
        console.log(`      p1=${m.player1_individual_id || 'NULL'}, p2=${m.player2_individual_id || 'NULL'}, p3=${m.player3_individual_id || 'NULL'}, p4=${m.player4_individual_id || 'NULL'}`);
      }
    });
  }
}

debug().catch(console.error);
