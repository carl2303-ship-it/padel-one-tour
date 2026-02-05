/**
 * Check RLS policies on matches table
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function check() {
  console.log('🔍 Checking RLS policies on matches table...\n');

  const { data, error } = await supabase
    .rpc('exec_sql', {
      sql: `
        SELECT 
          polname AS policy_name,
          polcmd AS command,
          polpermissive AS permissive,
          polroles::regrole[] AS roles,
          pg_get_expr(polqual, polrelid) AS using_expression,
          pg_get_expr(polwithcheck, polrelid) AS with_check_expression
        FROM pg_policy
        WHERE polrelid = 'matches'::regclass
        ORDER BY polname;
      `
    });

  if (error) {
    console.error('❌ Error:', error.message);
    
    // Try alternative method
    console.log('\n🔄 Trying alternative query...\n');
    
    const { data: policies } = await supabase
      .from('pg_policies')
      .select('*')
      .eq('tablename', 'matches');

    if (policies) {
      console.log(`Found ${policies.length} policies:`);
      policies.forEach((p: any) => {
        console.log(`\n📜 ${p.policyname}`);
        console.log(`   Command: ${p.cmd}`);
        console.log(`   Roles: ${p.roles}`);
        console.log(`   Using: ${p.qual || '(none)'}`);
        console.log(`   With Check: ${p.with_check || '(none)'}`);
      });
    }
    return;
  }

  console.log(data);
}

check().catch(console.error);
