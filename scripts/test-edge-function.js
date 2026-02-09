// Testar a Edge Function diretamente
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://rqiwnxcexsccguruiteq.supabase.co'
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaXdueGNleHNjY2d1cnVpdGVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3Njc5MzcsImV4cCI6MjA3NTM0MzkzN30.Dl05zPQDtPVpmvn_Y-JokT3wDq0Oh9uF3op5xcHZpkY'

const supabase = createClient(supabaseUrl, anonKey)

async function main() {
  // Login with a test user - need to get a valid session
  // Use service role to find a user
  const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaXdueGNleHNjY2d1cnVpdGVxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTc2NzkzNywiZXhwIjoyMDc1MzQzOTM3fQ._zCjHZa15WhZBcf7lmTGct1lcu0Qtf4OnnwUy2EsJTA'
  const admin = createClient(supabaseUrl, serviceRoleKey)

  // Find a player_account that has leagues
  const { data: pa } = await admin
    .from('league_standings')
    .select('player_account_id, entity_name')
    .not('player_account_id', 'is', null)
    .limit(1)
  
  if (!pa?.length) {
    console.log('No standings with player_account_id found')
    return
  }
  
  const paId = pa[0].player_account_id
  console.log('Testing with player_account:', paId, pa[0].entity_name)

  // Get user_id from player_account
  const { data: account } = await admin
    .from('player_accounts')
    .select('user_id, name')
    .eq('id', paId)
    .single()
  
  console.log('Player account:', account?.name, 'user_id:', account?.user_id)

  // Generate a token for this user
  const { data: { user }, error: userErr } = await admin.auth.admin.getUserById(account.user_id)
  console.log('User:', user?.email, 'Error:', userErr)

  // Call Edge Function via fetch (simulating what the client does)
  console.log('\nCalling Edge Function...')
  const startTime = Date.now()
  
  try {
    // Use admin to generate a JWT for the user
    const { data: tokenData } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email,
    })
    
    // Just test directly with service role calling the function
    const resp = await fetch(
      `${supabaseUrl}/functions/v1/get-player-dashboard`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': anonKey,
        },
      }
    )
    
    console.log('Status:', resp.status, 'Time:', Date.now() - startTime, 'ms')
    const text = await resp.text()
    try {
      const data = JSON.parse(text)
      console.log('Response keys:', Object.keys(data))
      console.log('leagueStandings:', data.leagueStandings?.length ?? 'none')
      console.log('pastTournaments:', data.pastTournaments?.length ?? 'none')
      console.log('pastTournamentDetails:', data.pastTournamentDetails ? Object.keys(data.pastTournamentDetails).length : 'none')
      if (data.error) console.log('ERROR:', data.error)
    } catch {
      console.log('Raw response:', text.substring(0, 500))
    }
  } catch (err) {
    console.error('Fetch error:', err)
  }
  
  console.log('\nTotal time:', Date.now() - startTime, 'ms')
}

main().catch(console.error)
