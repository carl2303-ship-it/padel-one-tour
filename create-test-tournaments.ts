import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

// Carregar variáveis de ambiente do .env
config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Erro: Variáveis VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias no .env');
  process.exit(1);
}

// Service Role bypassa RLS - permite criar torneios para qualquer utilizador
const supabase = createClient(supabaseUrl, serviceRoleKey);

// Obter o primeiro user_id e club_id da base de dados
async function getFirstUserAndClub() {
  const { data: tournaments, error: tErr } = await supabase
    .from('tournaments')
    .select('user_id, club_id')
    .limit(1)
    .single();

  if (!tErr && tournaments?.user_id && tournaments?.club_id) {
    return { userId: tournaments.user_id, clubId: tournaments.club_id };
  }

  const { data: clubs, error: cErr } = await supabase
    .from('clubs')
    .select('id, user_id')
    .limit(1)
    .single();

  if (cErr || !clubs) {
    console.error('❌ Erro: Nenhum clube encontrado na base de dados. Crie um clube primeiro na app.');
    process.exit(1);
  }

  return { userId: clubs.user_id, clubId: clubs.id };
}

// Obter nomes dos campos do clube (court_names)
async function getClubCourtNames(clubId: string): Promise<string[]> {
  try {
    const { data: courts, error } = await supabase
      .from('courts')
      .select('name')
      .eq('club_id', clubId);
    
    if (!error && courts && courts.length > 0) {
      return courts.map(c => (c as any).name || 'Campo').filter(Boolean);
    }
  } catch (_) {}
  return ['Campo 1'];
}

// Formatos de torneio disponíveis
const tournamentFormats = [
  {
    format: 'super_teams',
    name: 'TEST2026 - Super Teams',
    description: 'Torneio de teste Super Teams com 4 jogadores por equipa',
  },
  {
    format: 'round_robin_individual',
    name: 'TEST2026 - Americano Individual',
    description: 'Torneio de teste Americano Individual com parceiros rotativos',
  },
  {
    format: 'round_robin_teams',
    name: 'TEST2026 - Americano Equipas',
    description: 'Torneio de teste Americano com equipas fixas',
  },
  {
    format: 'individual_groups_knockout',
    name: 'TEST2026 - Grupos Individuais + Eliminatórias',
    description: 'Torneio de teste com jogadores individuais em grupos e fase final',
  },
  {
    format: 'groups_knockout',
    name: 'TEST2026 - Grupos + Eliminatórias',
    description: 'Torneio de teste com equipas em grupos e fase final',
  },
  {
    format: 'single_elimination',
    name: 'TEST2026 - Eliminação Directa',
    description: 'Torneio de teste com eliminação directa',
  },
  {
    format: 'crossed_playoffs',
    name: 'TEST2026 - Playoffs Cruzados',
    description: 'Torneio de teste com 3 categorias e playoffs cruzados',
  },
  {
    format: 'mixed_gender',
    name: 'TEST2026 - Misto Homens/Mulheres',
    description: 'Torneio de teste com grupos separados por género',
  },
];

async function createTestTournaments() {
  console.log('🎾 A criar torneios de teste...\n');

  const { userId, clubId } = await getFirstUserAndClub();
  console.log(`✅ User ID: ${userId}`);
  console.log(`✅ Clube ID: ${clubId}`);

  const courtNames = await getClubCourtNames(clubId);
  console.log(`✅ Campos: ${courtNames.join(', ')}\n`);

  // Datas para os torneios (próximo mês)
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 30); // Daqui a 30 dias
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 2); // 2 dias de duração

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  let createdCount = 0;
  let errorCount = 0;

  for (const format of tournamentFormats) {
    try {
      // Mapear format para o que a DB espera (round_robin usa round_robin_type)
      const dbFormat = (format.format === 'round_robin_individual' || format.format === 'round_robin_teams')
        ? 'round_robin' : format.format;
      const roundRobinType = format.format === 'round_robin_individual' ? 'individual'
        : format.format === 'round_robin_teams' ? 'teams' : null;

      const { data: tournament, error: tournamentError } = await supabase
        .from('tournaments')
        .insert({
          name: format.name,
          description: format.description,
          start_date: startDateStr,
          end_date: endDateStr,
          start_time: '09:00',
          end_time: '21:00',
          daily_start_time: '09:00',
          daily_end_time: '21:00',
          format: dbFormat,
          round_robin_type: roundRobinType,
          user_id: userId,
          club_id: clubId || null,
          match_duration_minutes: 60,
          number_of_courts: courtNames.length,
          court_names: courtNames,
          status: 'draft',
          registration_fee: 0,
          allow_public_registration: false,
          max_teams: 999,
        })
        .select()
        .single();

      if (tournamentError) {
        console.error(`❌ Erro ao criar ${format.name}: ${tournamentError.message}`);
        errorCount++;
        continue;
      }

      // Criar categorias para o torneio (estrutura definida nas categorias!)
      // O format da categoria deve ser um dos permitidos na DB: single_elimination, round_robin, groups_knockout, individual_groups_knockout, super_teams
      const categoryFormat = (format.format === 'round_robin_individual' || format.format === 'round_robin_teams')
        ? 'round_robin' : format.format;
      const categoriesToCreate = format.format === 'crossed_playoffs'
        ? [{ name: 'M3', maxTeams: 4 }, { name: 'M4', maxTeams: 4 }, { name: 'M5', maxTeams: 4 }]
        : [{ name: 'Categoria A', maxTeams: format.format.includes('individual') ? 16 : 12 }];

      for (const cat of categoriesToCreate) {
        const isGroupsFormat = (categoryFormat === 'groups_knockout' || categoryFormat === 'individual_groups_knockout' || categoryFormat === 'super_teams');
        const { error: categoryError } = await supabase
          .from('tournament_categories')
          .insert({
            tournament_id: tournament.id,
            name: cat.name,
            format: categoryFormat,
            max_teams: cat.maxTeams,
            number_of_groups: isGroupsFormat ? 2 : 0,
            qualified_per_group: isGroupsFormat ? 2 : null,
            knockout_stage: isGroupsFormat ? 'semifinals' : null,
          });

        if (categoryError) {
          console.warn(`⚠️  Aviso: Erro ao criar categoria ${cat.name} para ${format.name}: ${categoryError.message}`);
        }
      }

      console.log(`✅ ${format.name} criado com sucesso (ID: ${tournament.id})`);
      createdCount++;

    } catch (err) {
      console.error(`❌ Erro inesperado ao criar ${format.name}:`, err);
      errorCount++;
    }
  }

  console.log(`\n📊 Resumo:`);
  console.log(`   ✅ Criados: ${createdCount}`);
  console.log(`   ❌ Erros: ${errorCount}`);
  console.log(`\n🎉 Processo concluído!`);
}

// Executar
createTestTournaments().catch(console.error);
