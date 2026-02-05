/**
 * Check matches using authenticated user (not service role)
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing env vars');
  process.exit(1);
}

// Use anon key like the frontend does
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
  console.log('🔍 Checking matches using ANON key (like frontend)...\n');

  const { data: tournament, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, allow_public_registration')
    .ilike('name', '%TEST2026%Grupos+eliminatorias teams%')
    .single();

  if (tErr) {
    console.error('❌ Error fetching tournament:', tErr.message);
    return;
  }

  if (!tournament) {
    console.log('❌ Tournament not found');
    return;
  }

  console.log(`✅ Tournament: ${tournament.name}`);
  console.log(`   ID: ${tournament.id}`);
  console.log(`   Public Registration: ${tournament.allow_public_registration}`);
  console.log();

  // Try to fetch matches like the frontend does
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id, match_number, round, team1_id, team2_id, category_id')
    .eq('tournament_id', tournament.id)
    .order('match_number');

  if (mErr) {
    console.error('❌ Error fetching matches:', mErr.message);
    return;
  }

  console.log(`📋 Matches returned: ${matches?.length || 0}`);
  
  if (matches && matches.length > 0) {
    const byRound = new Map<string, number>();
    matches.forEach(m => {
      byRound.set(m.round, (byRound.get(m.round) || 0) + 1);
    });
    
    console.log('\nBy round:');
    byRound.forEach((count, round) => {
      console.log(`   - ${round}: ${count} matches`);
    });

    const knockoutMatches = matches.filter(m =>
      m.round === 'semifinal' ||
      m.round === 'final' ||
      m.round === '3rd_place'
    );

    console.log(`\n🏆 Knockout matches visible: ${knockoutMatches.length}`);
    knockoutMatches.forEach(m => {
      console.log(`   - Match #${m.match_number} (${m.round}), category_id=${m.category_id || 'null'}`);
    });
  }
}

check().catch(console.error);
