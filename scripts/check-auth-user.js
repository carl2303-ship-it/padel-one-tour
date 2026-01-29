// Script para verificar utilizador auth (usa service role key)
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rqiwnxcexsccguruiteq.supabase.co';
// Service Role Key - permite acesso admin
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaXdueGNleHNjY2d1cnVpdGVxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTc2NzkzNywiZXhwIjoyMDc1MzQzOTM3fQ._zCjHZa15WhZBcf7lmTGct1lcu0Qtf4OnnwUy2EsJTA';

const supabase = createClient(supabaseUrl, serviceRoleKey);

const phoneNumber = process.argv[2] || '+351964289868';
const normalizedPhone = phoneNumber.replace(/\s+/g, '').replace('+', '');

// Email gerado a partir do telefone (padrão do sistema)
const generatedEmail = `${normalizedPhone}@boostpadel.app`;

async function checkAuthUser() {
  console.log('='.repeat(80));
  console.log('VERIFICAÇÃO DE UTILIZADOR AUTH');
  console.log('Telefone:', phoneNumber);
  console.log('Email esperado:', generatedEmail);
  console.log('='.repeat(80));

  // 1. Buscar player_account
  const { data: playerAccount } = await supabase
    .from('player_accounts')
    .select('*')
    .ilike('phone_number', `%${normalizedPhone.slice(-9)}%`)
    .single();

  console.log('\n📋 1. PLAYER_ACCOUNT:');
  if (playerAccount) {
    console.log('   Nome:', playerAccount.name);
    console.log('   Tel:', playerAccount.phone_number);
    console.log('   Email:', playerAccount.email);
    console.log('   User ID:', playerAccount.user_id);
  } else {
    console.log('   ❌ Não encontrado');
  }

  // 2. Buscar utilizador auth pelo user_id
  if (playerAccount?.user_id) {
    console.log('\n📋 2. AUTH USER (por user_id):');
    
    const { data: authUser, error } = await supabase.auth.admin.getUserById(
      playerAccount.user_id
    );

    if (error) {
      console.log('   ❌ Erro:', error.message);
    } else if (authUser?.user) {
      console.log('   ID:', authUser.user.id);
      console.log('   Email:', authUser.user.email);
      console.log('   Phone:', authUser.user.phone);
      console.log('   Criado em:', authUser.user.created_at);
      console.log('   Último login:', authUser.user.last_sign_in_at);
      console.log('   Email confirmado:', authUser.user.email_confirmed_at ? 'Sim' : 'Não');
    } else {
      console.log('   ❌ Utilizador não encontrado no auth');
    }
  }

  // 3. Buscar por email gerado
  console.log('\n📋 3. AUTH USER (por email gerado):');
  
  const { data: userList, error: listError } = await supabase.auth.admin.listUsers();
  
  if (listError) {
    console.log('   ❌ Erro ao listar:', listError.message);
  } else {
    const matchingUsers = userList.users.filter(u => 
      u.email?.includes(normalizedPhone.slice(-9)) ||
      u.phone?.includes(normalizedPhone.slice(-9))
    );

    if (matchingUsers.length > 0) {
      console.log(`   Encontrados ${matchingUsers.length} utilizador(es):`);
      matchingUsers.forEach(u => {
        console.log(`\n   - ID: ${u.id}`);
        console.log(`     Email: ${u.email}`);
        console.log(`     Phone: ${u.phone || 'N/A'}`);
        console.log(`     Criado: ${u.created_at}`);
        console.log(`     Último login: ${u.last_sign_in_at || 'Nunca'}`);
        console.log(`     Email confirmado: ${u.email_confirmed_at ? 'Sim' : 'Não'}`);
      });
    } else {
      console.log('   ❌ Nenhum utilizador encontrado com este telefone/email');
    }
  }

  // 4. Diagnóstico
  console.log('\n' + '='.repeat(80));
  console.log('DIAGNÓSTICO:');
  
  if (!playerAccount) {
    console.log('❌ Não existe player_account para este telefone');
    console.log('   O jogador precisa se registar primeiro num torneio');
  } else if (!playerAccount.user_id) {
    console.log('⚠️ player_account existe mas sem user_id');
    console.log('   Conta incompleta - precisa criar password');
  } else {
    console.log('✅ Conta existe. Para fazer login:');
    console.log(`   Telefone: ${playerAccount.phone_number}`);
    console.log(`   (Sistema usa email interno: ${playerAccount.email})`);
    console.log('\n   Se password incorreta, opções:');
    console.log('   1. Usar "Esqueci password" na app');
    console.log('   2. Resetar password manualmente (admin)');
  }
  console.log('='.repeat(80));
}

checkAuthUser();
