// Script para corrigir email do jogador
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rqiwnxcexsccguruiteq.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaXdueGNleHNjY2d1cnVpdGVxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTc2NzkzNywiZXhwIjoyMDc1MzQzOTM3fQ._zCjHZa15WhZBcf7lmTGct1lcu0Qtf4OnnwUy2EsJTA';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function fixPlayerEmail() {
  const phoneNumber = '+351964289868';
  const correctEmail = '+351964289868@temp.player.com'; // Email que está no auth.users
  
  console.log('Corrigindo email do jogador Jeremy Coelho...');
  console.log('Telefone:', phoneNumber);
  console.log('Email correto:', correctEmail);

  // Atualizar player_accounts
  const { data, error } = await supabase
    .from('player_accounts')
    .update({ email: correctEmail })
    .eq('phone_number', phoneNumber)
    .select();

  if (error) {
    console.error('❌ Erro ao atualizar:', error);
  } else {
    console.log('✅ player_accounts atualizado:', data);
  }

  // Verificar resultado
  const { data: verify } = await supabase
    .from('player_accounts')
    .select('*')
    .eq('phone_number', phoneNumber)
    .single();

  console.log('\nVerificação final:');
  console.log('   Nome:', verify?.name);
  console.log('   Email:', verify?.email);
  console.log('   Tel:', verify?.phone_number);
  console.log('\n✅ Agora o Jeremy pode fazer login com telefone +351964289868');
}

fixPlayerEmail();
