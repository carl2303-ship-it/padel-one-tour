import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

/**
 * Notify players about open games that have ended and need result entry.
 * Runs via cron every 15 minutes.
 * Sends notification 30 minutes after the game ends (scheduled_at + duration).
 * Uses open_game_notifications_sent to avoid duplicate notifications.
 */

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();
    // Look for games that ended in the last 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // Fetch recently completed/full games
    const { data: recentGames, error: gamesError } = await supabase
      .from('open_games')
      .select('id, scheduled_at, duration_minutes, club_id, status')
      .in('status', ['full', 'completed'])
      .gte('scheduled_at', twoHoursAgo.toISOString())
      .lte('scheduled_at', now.toISOString());

    if (gamesError) {
      console.error('Error fetching games:', gamesError);
      throw gamesError;
    }

    if (!recentGames || recentGames.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No recently ended games', notified: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter games whose end time has passed (scheduled_at + duration)
    const endedGames = recentGames.filter(g => {
      const endTime = new Date(new Date(g.scheduled_at).getTime() + (g.duration_minutes || 90) * 60000);
      return endTime <= now;
    });

    if (endedGames.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No games have ended yet', notified: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const gameIds = endedGames.map(g => g.id);

    // Check which games already have results submitted
    const { data: existingResults } = await supabase
      .from('open_game_results')
      .select('game_id')
      .in('game_id', gameIds);

    const gamesWithResults = new Set((existingResults || []).map(r => r.game_id));

    // Only notify for games WITHOUT results
    const gamesNeedingResults = endedGames.filter(g => !gamesWithResults.has(g.id));

    if (gamesNeedingResults.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'All ended games already have results', notified: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const targetGameIds = gamesNeedingResults.map(g => g.id);

    // Fetch all confirmed players in these games
    const { data: gamePlayers } = await supabase
      .from('open_game_players')
      .select('game_id, player_account_id')
      .in('game_id', targetGameIds)
      .eq('status', 'confirmed');

    // Fetch club names
    const clubIds = [...new Set(gamesNeedingResults.map(g => g.club_id).filter(Boolean))];
    const clubsMap: Record<string, string> = {};
    if (clubIds.length > 0) {
      const { data: clubs } = await supabase
        .from('clubs')
        .select('id, name')
        .in('id', clubIds);
      if (clubs) {
        clubs.forEach((c: any) => { clubsMap[c.id] = c.name; });
      }
    }

    // Check which notifications were already sent
    const { data: alreadySent } = await supabase
      .from('open_game_notifications_sent')
      .select('game_id, player_account_id')
      .in('game_id', targetGameIds)
      .eq('notification_type', 'result_needed');

    const sentSet = new Set(
      (alreadySent || []).map((s: any) => `${s.game_id}:${s.player_account_id}`)
    );

    let notifiedCount = 0;
    const errors: string[] = [];

    for (const game of gamesNeedingResults) {
      const players = (gamePlayers || []).filter(p => p.game_id === game.id);
      const clubName = clubsMap[game.club_id] || 'Clube';

      for (const player of players) {
        if (!player.player_account_id) continue;

        const key = `${game.id}:${player.player_account_id}`;
        if (sentSet.has(key)) continue;

        try {
          const response = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              playerAccountId: player.player_account_id,
              payload: {
                title: 'Introduz o resultado! 📊',
                body: `O teu jogo em ${clubName} terminou. Introduz o resultado para atualizar o teu nível.`,
                url: '/',
                tag: `result-needed-${game.id}`,
              },
            }),
          });

          const result = await response.json();

          if (result.success || result.sentCount > 0) {
            // Mark as sent
            await supabase
              .from('open_game_notifications_sent')
              .insert({
                game_id: game.id,
                player_account_id: player.player_account_id,
                notification_type: 'result_needed',
              });
            notifiedCount++;
          }
        } catch (err) {
          errors.push(`Failed to notify ${player.player_account_id}: ${err}`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        gamesChecked: endedGames.length,
        gamesNeedingResults: gamesNeedingResults.length,
        notified: notifiedCount,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in notify-game-ended:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
