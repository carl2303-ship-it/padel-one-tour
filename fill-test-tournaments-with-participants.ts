/**
 * Inscreve equipas/jogadores de teste em todas as vagas disponíveis
 * nos torneios TEST2026. Nomes com prefixo "Test" para fácil remoção na DB.
 *
 * Uso: npx tsx fill-test-tournaments-with-participants.ts
 * Opções: --dry-run (apenas mostra o que faria, sem inserir)
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Variáveis VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY necessárias no .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const DRY_RUN = process.argv.includes('--dry-run');

type TournamentRow = {
  id: string;
  name: string;
  format: string;
  round_robin_type: string | null;
};

type CategoryRow = {
  id: string;
  tournament_id: string;
  name: string;
  format: string;
  max_teams: number;
};

async function main() {
  console.log('🎾 A inscrever participantes de teste em torneios TEST2026...\n');
  if (DRY_RUN) console.log('⚠️  Modo --dry-run: nenhum dado será inserido.\n');

  const { data: tournaments, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, format, round_robin_type')
    .like('name', 'TEST2026%') as { data: TournamentRow[] | null; error: any };

  if (tErr || !tournaments?.length) {
    console.error('❌ Nenhum torneio TEST2026 encontrado.');
    process.exit(1);
  }

  const { data: allCategories, error: cErr } = await supabase
    .from('tournament_categories')
    .select('id, tournament_id, name, format, max_teams')
    .in('tournament_id', tournaments.map((t) => t.id)) as { data: CategoryRow[] | null; error: any };

  if (cErr) {
    console.error('❌ Erro ao carregar categorias:', cErr.message);
    process.exit(1);
  }

  const categoriesByTournament = new Map<string, CategoryRow[]>();
  for (const c of allCategories || []) {
    if (!categoriesByTournament.has(c.tournament_id)) {
      categoriesByTournament.set(c.tournament_id, []);
    }
    categoriesByTournament.get(c.tournament_id)!.push(c);
  }

  let totalPlayers = 0;
  let totalTeams = 0;
  let totalSuperTeams = 0;
  let errors = 0;

  for (const t of tournaments) {
    const categories = categoriesByTournament.get(t.id) || [];
    const isIndividual =
      t.format === 'individual_groups_knockout' ||
      t.format === 'crossed_playoffs' ||
      t.format === 'mixed_gender' ||
      (t.format === 'round_robin' && t.round_robin_type === 'individual');

    if (t.format === 'super_teams') {
      for (const cat of categories) {
        const n = cat.max_teams || 8;
        const shortName = cat.name.replace(/\s+/g, '').slice(0, 6);
        if (DRY_RUN) {
          console.log(`  [DRY-RUN] ${t.name} / ${cat.name}: ${n} super equipas x 4 jogadores`);
          totalSuperTeams += n;
          continue;
        }
        for (let i = 1; i <= n; i++) {
          const { data: superTeam, error: stErr } = await supabase
            .from('super_teams')
            .insert({
              tournament_id: t.id,
              category_id: cat.id,
              name: `Test ${shortName} Super ${i}`,
            })
            .select('id')
            .single();
          if (stErr) {
            console.error(`❌ Super team ${t.name} / ${cat.name} #${i}:`, stErr.message);
            errors++;
            continue;
          }
          for (let p = 1; p <= 4; p++) {
            const { error: spErr } = await supabase.from('super_team_players').insert({
              super_team_id: superTeam.id,
              name: `Test ${shortName}${i} P${p}`,
              is_captain: p === 1,
              player_order: p,
            });
            if (spErr) {
              console.error(`❌ Super team player:`, spErr.message);
              errors++;
            }
          }
          totalSuperTeams++;
        }
        console.log(`✅ ${t.name} / ${cat.name}: ${n} super equipas (4 jogadores cada)`);
      }
      continue;
    }

    if (isIndividual) {
      for (const cat of categories) {
        const n = cat.max_teams || 16;
        const shortName = cat.name.replace(/\s+/g, '').slice(0, 8);
        if (DRY_RUN) {
          console.log(`  [DRY-RUN] ${t.name} / ${cat.name}: ${n} jogadores`);
          totalPlayers += n;
          continue;
        }
        const toInsert = Array.from({ length: n }, (_, i) => ({
          tournament_id: t.id,
          category_id: cat.id,
          name: `Test ${shortName} ${i + 1}`,
          email: null,
          phone_number: null,
          payment_status: 'exempt',
        }));
        const { error: pErr } = await supabase.from('players').insert(toInsert);
        if (pErr) {
          console.error(`❌ ${t.name} / ${cat.name} jogadores:`, pErr.message);
          errors++;
          continue;
        }
        totalPlayers += n;
        console.log(`✅ ${t.name} / ${cat.name}: ${n} jogadores`);
      }
      continue;
    }

    // Team-based: round_robin (teams), groups_knockout, single_elimination
    for (const cat of categories) {
      const n = cat.max_teams || 12;
      const shortName = cat.name.replace(/\s+/g, '').slice(0, 6);
      if (DRY_RUN) {
        console.log(`  [DRY-RUN] ${t.name} / ${cat.name}: ${n} equipas (${2 * n} jogadores)`);
        totalTeams += n;
        totalPlayers += 2 * n;
        continue;
      }
      const playerInserts = Array.from({ length: 2 * n }, (_, i) => ({
        tournament_id: t.id,
        category_id: cat.id,
        name: `Test ${shortName} P${i + 1}`,
        email: null,
        phone_number: null,
        payment_status: 'exempt',
      }));
      const { data: insertedPlayers, error: pErr } = await supabase
        .from('players')
        .insert(playerInserts)
        .select('id');
      if (pErr) {
        console.error(`❌ ${t.name} / ${cat.name} jogadores:`, pErr.message);
        errors++;
        continue;
      }
      const ids = (insertedPlayers || []).map((r: { id: string }) => r.id);
      for (let i = 0; i < n; i++) {
        const p1 = ids[2 * i];
        const p2 = ids[2 * i + 1];
        if (!p1 || !p2) continue;
        const { error: teamErr } = await supabase.from('teams').insert({
          tournament_id: t.id,
          category_id: cat.id,
          name: `Test ${shortName} Team ${i + 1}`,
          player1_id: p1,
          player2_id: p2,
        });
        if (teamErr) {
          console.error(`❌ Team ${t.name} / ${cat.name} #${i + 1}:`, teamErr.message);
          errors++;
        } else {
          totalTeams++;
        }
      }
      totalPlayers += 2 * n;
      console.log(`✅ ${t.name} / ${cat.name}: ${n} equipas (${2 * n} jogadores)`);
    }
  }

  console.log('\n📊 Resumo:');
  console.log(`   Jogadores (individual/equipas): ${totalPlayers}`);
  console.log(`   Equipas (duplas): ${totalTeams}`);
  console.log(`   Super equipas: ${totalSuperTeams}`);
  if (errors) console.log(`   ❌ Erros: ${errors}`);
  console.log('\n🎉 Concluído! (Nomes com "Test" para fácil remoção na DB)');
}

main().catch(console.error);
