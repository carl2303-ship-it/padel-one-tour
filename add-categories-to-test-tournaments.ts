/**
 * Script para adicionar categorias aos torneios TEST2026 existentes.
 * A estrutura do torneio (grupos, eliminatórias, etc.) é definida nas categorias.
 * Os torneios foram criados sem categorias - este script corrige isso.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Variáveis VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

// Mapear nome do torneio -> categorias a criar
// O format da categoria deve ser um dos permitidos: single_elimination, round_robin, groups_knockout, individual_groups_knockout, super_teams
const tournamentCategoryConfig: Record<string, { format: string; categories: { name: string; maxTeams: number; number_of_groups?: number; qualified_per_group?: number; knockout_stage?: string }[] }> = {
  'TEST2026 - Super Teams': {
    format: 'super_teams',
    categories: [{ name: 'Categoria A', maxTeams: 8, number_of_groups: 2, qualified_per_group: 2, knockout_stage: 'semifinals' }],
  },
  'TEST2026 - Americano Individual': {
    format: 'round_robin',
    categories: [{ name: 'Categoria A', maxTeams: 16 }],
  },
  'TEST2026 - Americano Equipas': {
    format: 'round_robin',
    categories: [{ name: 'Categoria A', maxTeams: 12 }],
  },
  'TEST2026 - Grupos Individuais + Eliminatórias': {
    format: 'individual_groups_knockout',
    categories: [{ name: 'Categoria A', maxTeams: 16, number_of_groups: 2, qualified_per_group: 2, knockout_stage: 'semifinals' }],
  },
  'TEST2026 - Grupos + Eliminatórias': {
    format: 'groups_knockout',
    categories: [{ name: 'Categoria A', maxTeams: 12, number_of_groups: 2, qualified_per_group: 2, knockout_stage: 'semifinals' }],
  },
  'TEST2026 - Eliminação Directa': {
    format: 'single_elimination',
    categories: [{ name: 'Categoria A', maxTeams: 16 }],
  },
  'TEST2026 - Playoffs Cruzados': {
    format: 'crossed_playoffs',
    categories: [
      { name: 'M3', maxTeams: 4, number_of_groups: 1, qualified_per_group: 2, knockout_stage: 'semifinals' },
      { name: 'M4', maxTeams: 4, number_of_groups: 1, qualified_per_group: 2, knockout_stage: 'semifinals' },
      { name: 'M5', maxTeams: 4, number_of_groups: 1, qualified_per_group: 2, knockout_stage: 'semifinals' },
    ],
  },
  'TEST2026 - Misto Homens/Mulheres': {
    format: 'mixed_gender',
    categories: [
      { name: 'Homens', maxTeams: 12, number_of_groups: 2, qualified_per_group: 2, knockout_stage: 'semifinals' },
      { name: 'Mulheres', maxTeams: 12, number_of_groups: 2, qualified_per_group: 2, knockout_stage: 'semifinals' },
    ],
  },
};

async function main() {
  console.log('🎾 A adicionar categorias aos torneios TEST2026...\n');

  const { data: tournaments, error: fetchErr } = await supabase
    .from('tournaments')
    .select('id, name')
    .like('name', 'TEST2026%');

  if (fetchErr || !tournaments?.length) {
    console.error('❌ Nenhum torneio TEST2026 encontrado.');
    process.exit(1);
  }

  let addedCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const t of tournaments) {
    const config = tournamentCategoryConfig[t.name];
    if (!config) {
      console.warn(`⚠️  Sem config para: ${t.name}`);
      skipCount++;
      continue;
    }

    // Verificar se já tem categorias (--replace para forçar substituição)
    const forceReplace = process.argv.includes('--replace');
    const { data: existing } = await supabase
      .from('tournament_categories')
      .select('id')
      .eq('tournament_id', t.id);

    if (existing && existing.length > 0 && !forceReplace) {
      console.log(`⏭️  ${t.name} já tem ${existing.length} categoria(s), a saltar (use --replace para substituir)`);
      skipCount++;
      continue;
    }

    if (forceReplace && existing && existing.length > 0) {
      const { error: delErr } = await supabase.from('tournament_categories').delete().eq('tournament_id', t.id);
      if (delErr) {
        console.error(`❌ Erro ao remover categorias de ${t.name}: ${delErr.message}`);
        errorCount++;
        continue;
      }
      console.log(`🗑️  ${t.name}: categorias antigas removidas`);
    }

    for (const cat of config.categories) {
      const insertData: Record<string, unknown> = {
        tournament_id: t.id,
        name: cat.name,
        format: config.format,
        max_teams: cat.maxTeams,
        number_of_groups: cat.number_of_groups ?? 0,
        qualified_per_group: cat.qualified_per_group ?? null,
        knockout_stage: cat.knockout_stage ?? null,
      };

      // game_format só se a coluna existir (evitar erro)
      const { error } = await supabase.from('tournament_categories').insert(insertData);

      if (error) {
        // Tentar sem game_format se falhar (coluna pode não existir)
        if (error.message.includes('game_format')) {
          const { error: retryErr } = await supabase.from('tournament_categories').insert(insertData);
          if (retryErr) {
            console.error(`❌ ${t.name} / ${cat.name}: ${retryErr.message}`);
            errorCount++;
            continue;
          }
        } else {
          console.error(`❌ ${t.name} / ${cat.name}: ${error.message}`);
          errorCount++;
          continue;
        }
      }

      console.log(`✅ ${t.name} → ${cat.name}`);
      addedCount++;
    }
  }

  console.log(`\n📊 Resumo:`);
  console.log(`   ✅ Categorias adicionadas: ${addedCount}`);
  console.log(`   ⏭️  Torneios já com categorias: ${skipCount}`);
  console.log(`   ❌ Erros: ${errorCount}`);
  console.log(`\n🎉 Concluído!`);
}

main().catch(console.error);
