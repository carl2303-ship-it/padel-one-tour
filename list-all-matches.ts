/**
 * List ALL matches in tournament (service role)
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function list() {
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name')
    .ilike('name', '%TEST2026%Grupos+eliminatorias teams%')
    .single();

  if (!tournament) {
    console.log('❌ Tournament not found');
    return;
  }

  console.log(`✅ Tournament: ${tournament.name}\n`);

  // Get count first
  const { count } = await supabase
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournament.id);

  console.log(`📊 Total matches in database: ${count}\n`);

  // Get all matches without any filters
  const { data: matches, error } = await supabase
    .from('matches')
    .select('match_number, round, team1_id, team2_id, category_id, created_at')
    .eq('tournament_id', tournament.id)
    .order('match_number');

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  console.log('📋 ALL MATCHES:\n');
  matches?.forEach(m => {
    const time = new Date(m.created_at).toLocaleTimeString('pt-PT');
    console.log(`#${String(m.match_number).padStart(2, '0')} | ${m.round.padEnd(15)} | team1=${m.team1_id ? '✓' : 'null'} | team2=${m.team2_id ? '✓' : 'null'} | category=${m.category_id ? '✓' : 'null'} | created_at=${time}`);
  });
}

list().catch(console.error);
