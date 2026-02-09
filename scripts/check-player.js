import { createClient } from '@supabase/supabase-js'
const supabase = createClient('https://rqiwnxcexsccguruiteq.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaXdueGNleHNjY2d1cnVpdGVxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTc2NzkzNywiZXhwIjoyMDc1MzQzOTM3fQ._zCjHZa15WhZBcf7lmTGct1lcu0Qtf4OnnwUy2EsJTA')

const PA_ID = 'fb238544-a99c-4199-9a04-dfa22868e084'

async function main() {
  // 1. Check player account
  const { data: pa } = await supabase.from('player_accounts').select('*').eq('id', PA_ID).single()
  console.log('Player Account:', pa?.name, '| phone:', pa?.phone_number, '| user_id:', pa?.user_id)

  // 2. Check league_standings with this player_account_id
  const { data: byPaId } = await supabase.from('league_standings').select('id, entity_name, league_id, player_account_id, entity_id, leagues(name)').eq('player_account_id', PA_ID)
  console.log('\nStandings by player_account_id:', byPaId?.length ?? 0)
  byPaId?.forEach(s => console.log(`  ${s.entity_name} | league: ${s.leagues?.name}`))

  // 3. Check by entity_name (maybe different name format)
  if (pa?.name) {
    const { data: byName } = await supabase.from('league_standings').select('id, entity_name, league_id, player_account_id, entity_id, leagues(name)').ilike('entity_name', `%${pa.name.trim()}%`)
    console.log('\nStandings by name match:', byName?.length ?? 0)
    byName?.forEach(s => console.log(`  ${s.entity_name} | league: ${s.leagues?.name} | pa_id: ${s.player_account_id}`))
  }

  // 4. Check players table for this person
  const { data: players } = await supabase.from('players').select('id, name, phone_number, tournament_id').or(`phone_number.eq.${pa?.phone_number},name.ilike.${pa?.name}`)
  console.log('\nPlayers table matches:', players?.length ?? 0)
  players?.slice(0, 5).forEach(p => console.log(`  ${p.name} | phone: ${p.phone_number} | player_id: ${p.id}`))

  // 5. Check if any of these player IDs match entity_id in league_standings
  if (players?.length) {
    const pids = players.map(p => p.id)
    const { data: byEntityId } = await supabase.from('league_standings').select('id, entity_name, entity_id, player_account_id, leagues(name)').in('entity_id', pids)
    console.log('\nStandings by entity_id:', byEntityId?.length ?? 0)
    byEntityId?.forEach(s => console.log(`  ${s.entity_name} | league: ${s.leagues?.name} | pa_id: ${s.player_account_id} | entity: ${s.entity_id}`))
    
    // 6. Fix: update player_account_id for these standings
    if (byEntityId?.length) {
      console.log('\n--- FIXING: Setting player_account_id for these standings ---')
      for (const s of byEntityId) {
        if (s.player_account_id !== PA_ID) {
          const { error } = await supabase.from('league_standings').update({ player_account_id: PA_ID }).eq('id', s.id)
          console.log(`  Updated ${s.entity_name} (${s.leagues?.name}): ${error ? 'ERROR: ' + error.message : 'OK'}`)
        }
      }
    }
  }
}
main().catch(console.error)
