import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

/**
 * Notify players about open games starting in the next hour.
 * Runs via cron every 15 minutes.
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
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

    // Fetch open games starting within the next hour
    const { data: upcomingGames, error: gamesError } = await supabase
      .from('open_games')
      .select('id, scheduled_at, club_id, court_id, creator_user_id')
      .in('status', ['open', 'full'])
      .gte('scheduled_at', now.toISOString())
      .lte('scheduled_at', oneHourFromNow.toISOString());

    if (gamesError) {
      console.error('Error fetching open games:', gamesError);
      throw gamesError;
    }

    if (!upcomingGames || upcomingGames.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No upcoming open games', notified: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const gameIds = upcomingGames.map(g => g.id);

    // Fetch all players in these games
    const { data: gamePlayers } = await supabase
      .from('open_game_players')
      .select('game_id, player_account_id')
      .in('game_id', gameIds)
      .eq('status', 'confirmed');

    // Fetch club names
    const clubIds = [...new Set(upcomingGames.map(g => g.club_id).filter(Boolean))];
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
      .in('game_id', gameIds)
      .eq('notification_type', 'reminder_1h');

    const sentSet = new Set(
      (alreadySent || []).map((s: any) => `${s.game_id}:${s.player_account_id}`)
    );

    let notifiedCount = 0;
    const errors: string[] = [];

    for (const game of upcomingGames) {
      const players = (gamePlayers || []).filter(p => p.game_id === game.id);
      const clubName = clubsMap[game.club_id] || 'Clube';
      const gameTime = new Date(game.scheduled_at);
      const timeStr = `${gameTime.getHours().toString().padStart(2, '0')}:${gameTime.getMinutes().toString().padStart(2, '0')}`;

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
                title: 'Jogo em breve! ⏰🎾',
                body: `O teu jogo às ${timeStr} em ${clubName} começa em menos de 1 hora.`,
                url: '/?screen=games',
                tag: `reminder-${game.id}`,
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
                notification_type: 'reminder_1h',
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
        gamesChecked: upcomingGames.length,
        notified: notifiedCount,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in notify-upcoming-open-games:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
