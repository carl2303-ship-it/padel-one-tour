/**
 * Create knockout matches with immediate verification
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function create() {
  console.log('🎾 Creating knockout matches with verification...\n');

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

  // Get category
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

  console.log(`✅ Category: ${category.name}\n`);

  // Get last match number
  const { data: lastMatch } = await supabase
    .from('matches')
    .select('match_number')
    .eq('tournament_id', tournament.id)
    .order('match_number', { ascending: false })
    .limit(1)
    .single();

  let matchNumber = (lastMatch?.match_number || 0) + 1;
  console.log(`📌 Starting from match number: ${matchNumber}\n`);

  // Get last scheduled time
  const { data: lastScheduled } = await supabase
    .from('matches')
    .select('scheduled_time')
    .eq('tournament_id', tournament.id)
    .not('scheduled_time', 'is', null)
    .order('scheduled_time', { ascending: false })
    .limit(1)
    .single();

  const lastTime = lastScheduled?.scheduled_time 
    ? new Date(lastScheduled.scheduled_time)
    : new Date();

  let currentTime = new Date(lastTime.getTime() + 60 * 60000); // +60 min

  const knockoutMatches = [
    { round: 'semifinal', label: 'Semifinal 1' },
    { round: 'semifinal', label: 'Semifinal 2' },
    { round: 'final', label: 'Final' },
    { round: '3rd_place', label: '3º Lugar' },
  ];

  const createdIds: string[] = [];

  for (const ko of knockoutMatches) {
    console.log(`🔨 Creating ${ko.label}...`);

    const { data, error } = await supabase
      .from('matches')
      .insert({
        tournament_id: tournament.id,
        category_id: category.id,
        round: ko.round,
        match_number: matchNumber,
        team1_id: null,
        team2_id: null,
        scheduled_time: currentTime.toISOString(),
        court: '1',
        status: 'scheduled',
        team1_score_set1: 0,
        team2_score_set1: 0,
        team1_score_set2: 0,
        team2_score_set2: 0,
        team1_score_set3: 0,
        team2_score_set3: 0,
      })
      .select('id, match_number, round');

    if (error) {
      console.error(`   ❌ Error: ${error.message}`);
      if (error.details) console.error(`      Details: ${error.details}`);
      if (error.hint) console.error(`      Hint: ${error.hint}`);
    } else if (data && data.length > 0) {
      console.log(`   ✅ Created match #${data[0].match_number} (ID: ${data[0].id})`);
      createdIds.push(data[0].id);
    } else {
      console.log(`   ⚠️  No data returned`);
    }

    matchNumber++;
    currentTime = new Date(currentTime.getTime() + 60 * 60000);
  }

  console.log(`\n📊 Created ${createdIds.length} matches`);

  // Immediate verification
  console.log(`\n🔍 Immediate verification...`);
  
  for (const id of createdIds) {
    const { data: match, error } = await supabase
      .from('matches')
      .select('id, match_number, round')
      .eq('id', id)
      .single();

    if (error) {
      console.log(`   ❌ Match ${id} NOT FOUND: ${error.message}`);
    } else if (match) {
      console.log(`   ✅ Match #${match.match_number} (${match.round}) exists`);
    }
  }

  // Final count
  console.log(`\n📋 Final match count...`);
  const { count } = await supabase
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournament.id);

  console.log(`   Total matches: ${count}`);
}

create().catch(console.error);
