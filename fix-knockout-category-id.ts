/**
 * Fix: Assign category_id to knockout matches
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function fix() {
  console.log('🔧 Fixing category_id for knockout matches...\n');

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name')
    .ilike('name', '%TEST2026%Grupos+eliminatorias teams%')
    .single();

  if (!tournament) {
    console.log('❌ Tournament not found');
    return;
  }

  console.log(`✅ Tournament: ${tournament.name} (${tournament.id})\n`);

  // Get the first category for this tournament
  const { data: category } = await supabase
    .from('tournament_categories')
    .select('id, name')
    .eq('tournament_id', tournament.id)
    .limit(1)
    .single();

  if (!category) {
    console.log('❌ No category found');
    return;
  }

  console.log(`✅ Category: ${category.name} (${category.id})\n`);

  // Update knockout matches to have category_id
  const { data: knockoutMatches } = await supabase
    .from('matches')
    .select('id, match_number, round')
    .eq('tournament_id', tournament.id)
    .in('round', ['semifinal', 'final', '3rd_place'])
    .is('category_id', null);

  if (!knockoutMatches || knockoutMatches.length === 0) {
    console.log('⏭️  No knockout matches without category_id found');
    return;
  }

  console.log(`📋 Found ${knockoutMatches.length} knockout matches without category_id:`);
  knockoutMatches.forEach(m => console.log(`   - Match #${m.match_number} (${m.round})`));

  const { error } = await supabase
    .from('matches')
    .update({ category_id: category.id })
    .eq('tournament_id', tournament.id)
    .in('round', ['semifinal', 'final', '3rd_place'])
    .is('category_id', null);

  if (error) {
    console.error(`\n❌ Error updating category_id:`, error.message);
    return;
  }

  console.log(`\n✅ Successfully updated ${knockoutMatches.length} matches with category_id`);
}

fix().catch(console.error);
