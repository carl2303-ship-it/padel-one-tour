import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
}

/**
 * Create a Stripe Checkout session for an open game payment.
 * 
 * Expects JSON body:
 * {
 *   gameId: string,
 *   paymentType: 'per_player' | 'full_court',
 *   playerAccountId: string,
 *   successUrl: string,
 *   cancelUrl: string,
 * }
 */

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { gameId, paymentType, playerAccountId, successUrl, cancelUrl } = await req.json()

    if (!gameId || !paymentType || !playerAccountId) {
      throw new Error('Missing required fields: gameId, paymentType, playerAccountId')
    }

    // 1. Get game details
    const { data: game, error: gameErr } = await supabase
      .from('open_games')
      .select('id, club_id, price_per_player, max_players, scheduled_at, duration_minutes')
      .eq('id', gameId)
      .single()

    if (gameErr || !game) {
      throw new Error('Game not found')
    }

    // 2. Get club details + Stripe keys
    const { data: club, error: clubErr } = await supabase
      .from('clubs')
      .select('id, name, stripe_secret_key, stripe_publishable_key, payment_method')
      .eq('id', game.club_id)
      .single()

    if (clubErr || !club) {
      throw new Error('Club not found')
    }

    if (!club.stripe_secret_key) {
      throw new Error('Club has not configured Stripe payments')
    }

    // 3. Get player details
    const { data: playerAccount } = await supabase
      .from('player_accounts')
      .select('id, name, user_id')
      .eq('id', playerAccountId)
      .single()

    if (!playerAccount) {
      throw new Error('Player account not found')
    }

    // 4. Calculate amount
    const pricePerPlayer = parseFloat(game.price_per_player) || 0
    if (pricePerPlayer <= 0) {
      return new Response(
        JSON.stringify({ success: true, freeGame: true, message: 'No payment required' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let amount: number
    let description: string

    if (paymentType === 'full_court') {
      amount = Math.round(pricePerPlayer * (game.max_players || 4) * 100) // in cents
      description = `Campo inteiro - ${club.name}`
    } else {
      amount = Math.round(pricePerPlayer * 100)
      description = `Jogo - ${club.name} (por jogador)`
    }

    // 5. Create Stripe checkout session using club's Stripe key
    const stripe = (await import('npm:stripe@14')).default(club.stripe_secret_key)

    const gameDate = new Date(game.scheduled_at)
    const dateStr = gameDate.toLocaleDateString('pt-PT')
    const timeStr = `${gameDate.getHours().toString().padStart(2, '0')}:${gameDate.getMinutes().toString().padStart(2, '0')}`

    const origin = successUrl || 'https://www.padel1.app'
    const cancelOrigin = cancelUrl || origin

    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: paymentType === 'full_court' ? 'Reserva de Campo' : 'Jogo de Padel',
              description: `${club.name} - ${dateStr} às ${timeStr} (${game.duration_minutes}min)`,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${origin}?payment=success&game_id=${gameId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${cancelOrigin}?payment=cancelled&game_id=${gameId}`,
      metadata: {
        type: 'open_game',
        gameId,
        paymentType,
        playerAccountId,
        userId: playerAccount.user_id || '',
        clubId: club.id,
      },
    })

    // 6. Create payment record
    await supabase
      .from('open_game_payments')
      .insert({
        game_id: gameId,
        player_account_id: playerAccountId,
        user_id: playerAccount.user_id || null,
        stripe_session_id: session.id,
        amount: amount / 100,
        currency: 'eur',
        payment_type: paymentType,
        status: 'pending',
      })

    return new Response(
      JSON.stringify({
        success: true,
        sessionId: session.id,
        url: session.url,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error creating game checkout:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
