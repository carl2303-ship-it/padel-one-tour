/**
 * Fix crossed_playoffs and mixed_gender matches - delete old and create new with correct logic
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, serviceRoleKey);

// Generate American format combinations for any number of players
function generateAmericanCombinations(players: { id: string; name: string }[]): Array<{ p1: string; p2: string; p3: string; p4: string }> {
  const n = players.length;
  if (n < 4) return [];
  
  const combinations: Array<{ p1: string; p2: string; p3: string; p4: string }> = [];
  const usedPartnerships = new Set<string>();
  
  const getPartnershipKey = (id1: string, id2: string): string => {
    return [id1, id2].sort().join('+');
  };
  
  // Generate all possible pairs
  const allPairs: Array<{ p1: string; p2: string; key: string }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const key = getPartnershipKey(players[i].id, players[j].id);
      allPairs.push({ p1: players[i].id, p2: players[j].id, key });
    }
  }
  
  console.log(`  Total pairs possible: ${allPairs.length}`);
  
  // Shuffle pairs for variety
  const shuffledPairs = [...allPairs].sort(() => Math.random() - 0.5);
  
  // Try to create matches using unique partnerships
  for (let i = 0; i < shuffledPairs.length; i++) {
    const pair1 = shuffledPairs[i];
    if (usedPartnerships.has(pair1.key)) continue;
    
    for (let j = i + 1; j < shuffledPairs.length; j++) {
      const pair2 = shuffledPairs[j];
      if (usedPartnerships.has(pair2.key)) continue;
      
      // Check that all 4 players are different
      const allFour = new Set([pair1.p1, pair1.p2, pair2.p1, pair2.p2]);
      if (allFour.size !== 4) continue;
      
      // Mark partnerships as used
      usedPartnerships.add(pair1.key);
      usedPartnerships.add(pair2.key);
      
      combinations.push({
        p1: pair1.p1,
        p2: pair1.p2,
        p3: pair2.p1,
        p4: pair2.p2
      });
      break;
    }
  }
  
  return combinations;
}

async function fix() {
  console.log('🔧 Fixing crossed_playoffs and mixed_gender matches...\n');

  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('id, name, format, start_date, daily_start_time, match_duration_minutes, number_of_courts')
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

    // Delete old matches
    const { error: deleteError } = await supabase
      .from('matches')
      .delete()
      .eq('tournament_id', t.id);

    if (deleteError) {
      console.error('❌ Error deleting matches:', deleteError.message);
      continue;
    }
    console.log('🗑️  Deleted old matches');

    // Get categories
    const { data: categories } = await supabase
      .from('tournament_categories')
      .select('id, name')
      .eq('tournament_id', t.id)
      .order('name');

    if (!categories || categories.length === 0) {
      console.log('❌ No categories found');
      continue;
    }

    // Get players by category
    const { data: allPlayers } = await supabase
      .from('players')
      .select('id, name, category_id, group_name')
      .eq('tournament_id', t.id);

    if (!allPlayers || allPlayers.length === 0) {
      console.log('❌ No players found');
      continue;
    }

    const startDate = t.start_date || new Date().toISOString().split('T')[0];
    const startTime = t.daily_start_time || '09:00';
    const matchDuration = t.match_duration_minutes || 60;
    const numberOfCourts = t.number_of_courts || 2;
    
    let matchNumber = 1;
    let currentTime = new Date(`${startDate}T${startTime}:00`);
    const matchesToInsert: any[] = [];

    const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));

    for (let catIdx = 0; catIdx < sortedCategories.length; catIdx++) {
      const category = sortedCategories[catIdx];
      const categoryPlayers = allPlayers.filter(p => p.category_id === category.id);
      const groupName = String.fromCharCode(65 + catIdx); // A, B, C

      console.log(`\n📋 Category "${category.name}" (Group ${groupName}): ${categoryPlayers.length} players`);

      if (categoryPlayers.length < 4) {
        console.log('   ⚠️  Fewer than 4 players, skipping');
        continue;
      }

      // Generate American combinations
      const combinations = generateAmericanCombinations(categoryPlayers);
      console.log(`   Generated ${combinations.length} matches`);

      for (let i = 0; i < combinations.length; i++) {
        const combo = combinations[i];
        const court = ((i % numberOfCourts) + 1).toString();

        matchesToInsert.push({
          tournament_id: t.id,
          category_id: category.id,
          round: `group_${groupName}`,
          match_number: matchNumber++,
          player1_individual_id: combo.p1,
          player2_individual_id: combo.p2,
          player3_individual_id: combo.p3,
          player4_individual_id: combo.p4,
          scheduled_time: currentTime.toISOString(),
          court: court,
          status: 'scheduled',
          team1_score_set1: 0,
          team2_score_set1: 0,
          team1_score_set2: 0,
          team2_score_set2: 0,
          team1_score_set3: 0,
          team2_score_set3: 0,
        });

        // Advance time every X matches (based on number of courts)
        if ((i + 1) % numberOfCourts === 0) {
          currentTime = new Date(currentTime.getTime() + matchDuration * 60000);
        }
      }
    }

    // Insert new matches
    if (matchesToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('matches')
        .insert(matchesToInsert);

      if (insertError) {
        console.error('❌ Error inserting matches:', insertError.message);
      } else {
        console.log(`\n✅ Inserted ${matchesToInsert.length} matches total`);
      }
    }
  }

  console.log('\n🎉 Done!');
}

fix().catch(console.error);
