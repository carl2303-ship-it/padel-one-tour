/**
 * Compare group stage vs knockout match fields
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function compare() {
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id')
    .ilike('name', '%TEST2026%Grupos+eliminatorias teams%')
    .single();

  if (!tournament) {
    console.log('❌ Tournament not found');
    return;
  }

  const { data: allMatches } = await supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournament.id)
    .order('match_number');

  if (!allMatches || allMatches.length === 0) {
    console.log('❌ No matches found');
    return;
  }

  const groupMatch = allMatches.find(m => m.round === 'group_stage');
  const knockoutMatch = allMatches.find(m => m.round === 'semifinal' || m.round === 'final');

  console.log('📊 COMPARING FIELDS:\n');
  console.log('=' . repeat(80));
  console.log('GROUP STAGE MATCH (#1):');
  console.log('=' . repeat(80));
  if (groupMatch) {
    Object.entries(groupMatch).forEach(([key, value]) => {
      const display = value === null ? 'NULL' : (typeof value === 'string' && value.length > 50 ? value.substring(0, 47) + '...' : value);
      console.log(`   ${key.padEnd(25)}: ${display}`);
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('KNOCKOUT MATCH (semifinal/final):');
  console.log('='.repeat(80));
  if (knockoutMatch) {
    Object.entries(knockoutMatch).forEach(([key, value]) => {
      const display = value === null ? 'NULL' : (typeof value === 'string' && value.length > 50 ? value.substring(0, 47) + '...' : value);
      const groupValue = groupMatch ? groupMatch[key] : undefined;
      const isDifferent = groupValue !== value;
      const marker = isDifferent ? ' ⚠️ DIFFERENT' : '';
      console.log(`   ${key.padEnd(25)}: ${display}${marker}`);
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('KEY DIFFERENCES:');
  console.log('='.repeat(80));
  
  if (groupMatch && knockoutMatch) {
    Object.keys(groupMatch).forEach(key => {
      if (groupMatch[key] !== knockoutMatch[key]) {
        console.log(`   ${key}:`);
        console.log(`      Group: ${groupMatch[key]}`);
        console.log(`      Knockout: ${knockoutMatch[key]}`);
      }
    });
  }
}

compare().catch(console.error);
