// Script para corrigir TODOS os emails de jogadores
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rqiwnxcexsccguruiteq.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaXdueGNleHNjY2d1cnVpdGVxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTc2NzkzNywiZXhwIjoyMDc1MzQzOTM3fQ._zCjHZa15WhZBcf7lmTGct1lcu0Qtf4OnnwUy2EsJTA';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function fixAllPlayerEmails() {
  console.log('='.repeat(80));
  console.log('CORREÇÃO DE EMAILS DE TODOS OS JOGADORES');
  console.log('='.repeat(80));

  // 1. Buscar todos os player_accounts com user_id
  const { data: playerAccounts, error: paError } = await supabase
    .from('player_accounts')
    .select('id, name, phone_number, email, user_id')
    .not('user_id', 'is', null);

  if (paError) {
    console.error('Erro ao buscar player_accounts:', paError);
    return;
  }

  console.log(`\nEncontrados ${playerAccounts.length} jogadores com conta\n`);

  let fixed = 0;
  let alreadyOk = 0;
  let errors = 0;

  for (const pa of playerAccounts) {
    // Buscar auth user
    const { data: authData, error: authError } = await supabase.auth.admin.getUserById(pa.user_id);

    if (authError || !authData?.user) {
      console.log(`❌ ${pa.name}: Auth user não encontrado (user_id: ${pa.user_id})`);
      errors++;
      continue;
    }

    const authEmail = authData.user.email;
    const paEmail = pa.email;

    if (authEmail === paEmail) {
      console.log(`✓ ${pa.name}: Email OK (${paEmail})`);
      alreadyOk++;
    } else {
      console.log(`⚠️ ${pa.name}: Email diferente`);
      console.log(`   player_accounts: ${paEmail}`);
      console.log(`   auth.users:      ${authEmail}`);
      
      // Corrigir
      const { error: updateError } = await supabase
        .from('player_accounts')
        .update({ email: authEmail })
        .eq('id', pa.id);

      if (updateError) {
        console.log(`   ❌ Erro ao corrigir: ${updateError.message}`);
        errors++;
      } else {
        console.log(`   ✅ CORRIGIDO!`);
        fixed++;
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('RESUMO:');
  console.log(`   Total jogadores: ${playerAccounts.length}`);
  console.log(`   ✅ Já estavam OK: ${alreadyOk}`);
  console.log(`   🔧 Corrigidos: ${fixed}`);
  console.log(`   ❌ Erros: ${errors}`);
  console.log('='.repeat(80));
}

fixAllPlayerEmails();
