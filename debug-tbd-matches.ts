/**
 * Find all tournaments with TBD matches
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function debug() {
  console.log('🔍 Finding tournaments with TBD matches...\n');

  // Find matches with null players
  const { data: tbdMatches } = await supabase
    .from('matches')
    .select('tournament_id, round')
    .or('player1_individual_id.is.null,player2_individual_id.is.null,player3_individual_id.is.null,player4_individual_id.is.null')
    .not('round', 'ilike', 'final%')
    .not('round', 'ilike', '%semifinal%')
    .not('round', 'ilike', '%place%')
    .not('round', 'ilike', 'crossed_%');

  if (!tbdMatches || tbdMatches.length === 0) {
    console.log('✅ No TBD group matches found!');
    return;
  }

  // Group by tournament
  const byTournament = new Map<string, number>();
  tbdMatches.forEach(m => {
    byTournament.set(m.tournament_id, (byTournament.get(m.tournament_id) || 0) + 1);
  });

  console.log(`Found ${tbdMatches.length} TBD matches in ${byTournament.size} tournaments:\n`);

  for (const [tournamentId, count] of byTournament.entries()) {
    const { data: t } = await supabase
      .from('tournaments')
      .select('name, format')
      .eq('id', tournamentId)
      .single();

    if (t) {
      console.log(`📌 ${t.name} (${t.format}): ${count} TBD matches`);
    }
  }
}

debug().catch(console.error);
