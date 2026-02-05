/**
 * Check exact round values for knockout matches
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function debug() {
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id')
    .ilike('name', '%TEST2026%Grupos+eliminatorias teams%')
    .single();

  if (!tournament) {
    console.log('❌ Tournament not found');
    return;
  }

  const { data: matches } = await supabase
    .from('matches')
    .select('match_number, round, team1_id, team2_id, scheduled_time, status, category_id')
    .eq('tournament_id', tournament.id)
    .order('match_number');

  console.log('\n📋 ALL MATCHES:\n');
  matches?.forEach(m => {
    console.log(`Match #${m.match_number}: round="${m.round}", team1=${m.team1_id ? '✓' : 'null'}, team2=${m.team2_id ? '✓' : 'null'}, category=${m.category_id || 'null'}`);
  });
}

debug().catch(console.error);
