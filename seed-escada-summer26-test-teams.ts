/**
 * Preenche o torneio escada "Summer 26" com equipas de teste em todas as categorias.
 * Remove antes equipas/jogadores com prefixo [TEST S26] nesse torneio (reexecução segura).
 *
 * Uso: npx tsx seed-escada-summer26-test-teams.ts
 *       npx tsx seed-escada-summer26-test-teams.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env') })

const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessários no .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey)
const DRY_RUN = process.argv.includes('--dry-run')

const TEAMS_PER_CATEGORY = 6

function matchesEscadaSummer26(name: string): boolean {
  const n = name.toLowerCase()
  if (!n.includes('escada')) return false
  const hasSummer = n.includes('summer') || n.includes('verão') || n.includes('verao')
  const has26 = n.includes('26') || n.includes('2026')
  return hasSummer && has26
}

async function main() {
  const { data: ladders, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, format, updated_at, created_at')
    .eq('format', 'ladder')
    .order('updated_at', { ascending: false, nullsFirst: false })

  if (tErr) {
    console.error('❌ Erro ao listar torneios:', tErr.message)
    process.exit(1)
  }

  const tournament = (ladders || []).find((t) => matchesEscadaSummer26(t.name))
  if (!tournament) {
    console.error(
      '❌ Nenhum torneio com format=ladder cujo nome sugira "escada" + summer/verão + 26/2026.'
    )
    process.exit(1)
  }

  console.log(`🎯 Torneio: "${tournament.name}" (${tournament.id})\n`)

  const { data: categories, error: cErr } = await supabase
    .from('tournament_categories')
    .select('id, name')
    .eq('tournament_id', tournament.id)
    .order('name')

  if (cErr || !categories?.length) {
    console.error('❌ Sem categorias neste torneio:', cErr?.message)
    process.exit(1)
  }

  if (DRY_RUN) {
    for (const c of categories) {
      console.log(`  [DRY-RUN] ${c.name}: ${TEAMS_PER_CATEGORY} equipas (${TEAMS_PER_CATEGORY * 2} jogadores)`)
    }
    console.log('\n⚠️  --dry-run: nada foi alterado.')
    return
  }

  const { error: delTeamsErr } = await supabase
    .from('teams')
    .delete()
    .eq('tournament_id', tournament.id)
    .like('name', '[TEST S26]%')

  if (delTeamsErr) {
    console.error('❌ Erro ao remover equipas de teste antigas:', delTeamsErr.message)
    process.exit(1)
  }

  for (const col of ['name', 'email'] as const) {
    const pattern = col === 'name' ? '[TEST S26]%' : '%test-s26-%@example.invalid'
    const { error: delPlayersErr } = await supabase
      .from('players')
      .delete()
      .eq('tournament_id', tournament.id)
      .like(col, pattern)

    if (delPlayersErr) {
      console.error(`❌ Erro ao remover jogadores de teste (${col}):`, delPlayersErr.message)
      process.exit(1)
    }
  }

  let teams = 0
  let players = 0

  for (const cat of categories) {
    for (let i = 1; i <= TEAMS_PER_CATEGORY; i++) {
      const suffix = crypto.randomUUID().replace(/-/g, '')
      const email1 = `test-s26-${cat.id.slice(0, 8)}-${i}-j1-${suffix}@example.invalid`
      const email2 = `test-s26-${cat.id.slice(0, 8)}-${i}-j2-${suffix}@example.invalid`

      const { data: p1, error: e1 } = await supabase
        .from('players')
        .insert({
          name: `[TEST S26] ${cat.name} E${i} J1`,
          email: email1,
          tournament_id: tournament.id,
          category_id: cat.id,
          payment_status: 'exempt',
        })
        .select('id')
        .single()

      if (e1 || !p1) {
        console.error(`❌ Jogador 1 (${cat.name} E${i}):`, e1?.message)
        continue
      }
      players++

      const { data: p2, error: e2 } = await supabase
        .from('players')
        .insert({
          name: `[TEST S26] ${cat.name} E${i} J2`,
          email: email2,
          tournament_id: tournament.id,
          category_id: cat.id,
          payment_status: 'exempt',
        })
        .select('id')
        .single()

      if (e2 || !p2) {
        console.error(`❌ Jogador 2 (${cat.name} E${i}):`, e2?.message)
        continue
      }
      players++

      const { error: te } = await supabase.from('teams').insert({
        tournament_id: tournament.id,
        category_id: cat.id,
        name: `[TEST S26] ${cat.name} — Equipa ${i}`,
        player1_id: p1.id,
        player2_id: p2.id,
        seed: i,
      })

      if (te) {
        console.error(`❌ Equipa (${cat.name} #${i}):`, te.message)
      } else {
        teams++
      }
    }
    console.log(`✅ ${cat.name}: ${TEAMS_PER_CATEGORY} equipas`)
  }

  console.log(`\n📊 Total: ${teams} equipas, ${players} jogadores.`)
  console.log(
    '💡 Se a escada já estiver publicada (active) com positions, usa na UI «Sincronizar novas equipas» por categoria.'
  )
}

main().catch(console.error)
