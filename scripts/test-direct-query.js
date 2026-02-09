// Testar queries diretas para torneios (simular o que o player app faz)
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://rqiwnxcexsccguruiteq.supabase.co'
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaXdueGNleHNjY2d1cnVpdGVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3Njc5MzcsImV4cCI6MjA3NTM0MzkzN30.Dl05zPQDtPVpmvn_Y-JokT3wDq0Oh9uF3op5xcHZpkY'

const supabase = createClient(supabaseUrl, anonKey)

async function main() {
  // Buscar um torneio completed
  const { data: tournaments, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, status')
    .eq('status', 'completed')
    .limit(3)
  
  console.log('Completed tournaments:', tournaments?.length, 'error:', tErr)
  tournaments?.forEach(t => console.log(`  ${t.name} (${t.id})`))

  if (!tournaments?.length) return

  const tournamentId = tournaments[0].id
  console.log('\nTesting tournament:', tournaments[0].name)

  // Simular fetchTournamentStandingsAndMatches
  const [matchesRes, teamsRes, playersRes] = await Promise.all([
    supabase.from('matches').select('id, team1_id, team2_id, team1_score_set1, team2_score_set1, status').eq('tournament_id', tournamentId).eq('status', 'completed'),
    supabase.from('teams').select('id, name').eq('tournament_id', tournamentId),
    supabase.from('players').select('id, name').eq('tournament_id', tournamentId),
  ])

  console.log('Matches:', matchesRes.data?.length ?? 0, 'error:', matchesRes.error)
  console.log('Teams:', teamsRes.data?.length ?? 0, 'error:', teamsRes.error)
  console.log('Players:', playersRes.data?.length ?? 0, 'error:', playersRes.error)

  // Testar league_standings com anon key
  console.log('\n--- League Standings with anon key ---')
  const { data: allStandings, error: lsErr } = await supabase
    .from('league_standings')
    .select('id, entity_name, total_points, player_account_id, leagues!inner(id, name)')
    .limit(5)
  
  console.log('League standings (anon):', allStandings?.length ?? 0, 'error:', lsErr)
  allStandings?.forEach(s => console.log(`  ${s.entity_name} | pts: ${s.total_points} | pa: ${s.player_account_id}`))
}

main().catch(console.error)
