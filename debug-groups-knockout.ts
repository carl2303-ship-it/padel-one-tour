/**
 * Debug script: Check TEST2026 Grupos+eliminatorias teams tournament state
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function debug() {
  console.log('🔍 Checking TEST2026 Grupos+eliminatorias teams...\n');

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('*')
    .ilike('name', '%TEST2026%Grupos+eliminatorias teams%')
    .single();

  if (!tournament) {
    console.log('❌ Tournament not found. Available tournaments:');
    const { data: all } = await supabase
      .from('tournaments')
      .select('id, name')
      .like('name', 'TEST2026%');
    all?.forEach(t => console.log(`  - ${t.name}`));
    return;
  }

  console.log(`✅ Tournament: ${tournament.name}`);
  console.log(`   ID: ${tournament.id}`);
  console.log(`   Format: ${tournament.format}`);
  console.log();

  const { data: categories } = await supabase
    .from('tournament_categories')
    .select('*')
    .eq('tournament_id', tournament.id);

  console.log(`📋 Categories: ${categories?.length || 0}`);
  categories?.forEach(cat => {
    console.log(`   - ${cat.name}: format=${cat.format}, max_teams=${cat.max_teams}, groups=${cat.number_of_groups}, knockout_stage=${cat.knockout_stage}`);
  });
  console.log();

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, group_name, category_id')
    .eq('tournament_id', tournament.id);

  console.log(`👥 Teams: ${teams?.length || 0}`);
  const byGroup = new Map<string, number>();
  teams?.forEach(t => {
    const key = `${t.group_name || 'NO_GROUP'}`;
    byGroup.set(key, (byGroup.get(key) || 0) + 1);
  });
  byGroup.forEach((count, group) => {
    console.log(`   Group ${group}: ${count} teams`);
  });
  console.log();

  const { data: matches } = await supabase
    .from('matches')
    .select('id, round, match_number, team1_id, team2_id, scheduled_time, status')
    .eq('tournament_id', tournament.id)
    .order('match_number');

  console.log(`🎾 Matches: ${matches?.length || 0}`);
  const byRound = new Map<string, number>();
  const scheduledByRound = new Map<string, number>();
  matches?.forEach(m => {
    byRound.set(m.round, (byRound.get(m.round) || 0) + 1);
    if (m.scheduled_time) {
      scheduledByRound.set(m.round, (scheduledByRound.get(m.round) || 0) + 1);
    }
  });
  
  console.log('   By round:');
  byRound.forEach((count, round) => {
    const scheduled = scheduledByRound.get(round) || 0;
    console.log(`   - ${round}: ${count} matches (${scheduled} scheduled)`);
  });
  console.log();

  const knockoutMatches = matches?.filter(m => 
    m.round === 'semifinal' || 
    m.round === 'final' || 
    m.round === '3rd_place' ||
    m.round === 'quarterfinal'
  );

  console.log(`🏆 Knockout matches: ${knockoutMatches?.length || 0}`);
  knockoutMatches?.forEach(m => {
    const hasTeams = m.team1_id && m.team2_id;
    const hasTime = m.scheduled_time;
    console.log(`   ${m.round} (#${m.match_number}): teams=${hasTeams ? '✅' : '❌'}, time=${hasTime ? '✅' : '❌'}, status=${m.status}`);
  });
}

debug().catch(console.error);
