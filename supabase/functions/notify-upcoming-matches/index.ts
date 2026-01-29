import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

async function sendPushToPlayer(
  supabaseUrl: string,
  supabaseKey: string,
  playerAccountId: string,
  payload: { title: string; body: string; url?: string; tag?: string }
) {
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('player_account_id', playerAccountId);

  if (!subscriptions || subscriptions.length === 0) {
    return { success: false, reason: 'no_subscriptions' };
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({
      subscriptions,
      payload,
    }),
  });

  return response.json();
}

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
    const thirtyMinsFromNow = new Date(now.getTime() + 30 * 60 * 1000);

    const todayStr = now.toISOString().split('T')[0];
    const timeNowStr = now.toTimeString().slice(0, 5);
    const time30Str = thirtyMinsFromNow.toTimeString().slice(0, 5);
    const time60Str = oneHourFromNow.toTimeString().slice(0, 5);

    const { data: upcomingMatches, error: matchError } = await supabase
      .from('matches')
      .select(`
        id,
        scheduled_date,
        scheduled_time,
        court_number,
        team1_id,
        team2_id,
        player1_id,
        player2_id,
        player3_id,
        player4_id,
        tournament_id,
        tournaments!inner (
          id,
          name
        )
      `)
      .eq('scheduled_date', todayStr)
      .gte('scheduled_time', timeNowStr)
      .lte('scheduled_time', time60Str)
      .is('score_team1', null);

    if (matchError) {
      console.error('Error fetching matches:', matchError);
      throw matchError;
    }

    if (!upcomingMatches || upcomingMatches.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No upcoming matches found', notified: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let notifiedCount = 0;
    const errors: string[] = [];

    for (const match of upcomingMatches) {
      const tournament = match.tournaments as { id: string; name: string };
      const playerIds: string[] = [];

      if (match.team1_id) {
        const { data: team1Players } = await supabase
          .from('teams')
          .select('player1_name, player2_name')
          .eq('id', match.team1_id)
          .single();

        if (team1Players) {
          const { data: p1Account } = await supabase
            .from('player_accounts')
            .select('id')
            .ilike('name', team1Players.player1_name)
            .maybeSingle();
          if (p1Account) playerIds.push(p1Account.id);

          if (team1Players.player2_name) {
            const { data: p2Account } = await supabase
              .from('player_accounts')
              .select('id')
              .ilike('name', team1Players.player2_name)
              .maybeSingle();
            if (p2Account) playerIds.push(p2Account.id);
          }
        }
      }

      if (match.team2_id) {
        const { data: team2Players } = await supabase
          .from('teams')
          .select('player1_name, player2_name')
          .eq('id', match.team2_id)
          .single();

        if (team2Players) {
          const { data: p1Account } = await supabase
            .from('player_accounts')
            .select('id')
            .ilike('name', team2Players.player1_name)
            .maybeSingle();
          if (p1Account) playerIds.push(p1Account.id);

          if (team2Players.player2_name) {
            const { data: p2Account } = await supabase
              .from('player_accounts')
              .select('id')
              .ilike('name', team2Players.player2_name)
              .maybeSingle();
            if (p2Account) playerIds.push(p2Account.id);
          }
        }
      }

      if (match.player1_id) {
        const { data: player } = await supabase
          .from('players')
          .select('name')
          .eq('id', match.player1_id)
          .single();
        if (player) {
          const { data: account } = await supabase
            .from('player_accounts')
            .select('id')
            .ilike('name', player.name)
            .maybeSingle();
          if (account) playerIds.push(account.id);
        }
      }

      if (match.player2_id) {
        const { data: player } = await supabase
          .from('players')
          .select('name')
          .eq('id', match.player2_id)
          .single();
        if (player) {
          const { data: account } = await supabase
            .from('player_accounts')
            .select('id')
            .ilike('name', player.name)
            .maybeSingle();
          if (account) playerIds.push(account.id);
        }
      }

      if (match.player3_id) {
        const { data: player } = await supabase
          .from('players')
          .select('name')
          .eq('id', match.player3_id)
          .single();
        if (player) {
          const { data: account } = await supabase
            .from('player_accounts')
            .select('id')
            .ilike('name', player.name)
            .maybeSingle();
          if (account) playerIds.push(account.id);
        }
      }

      if (match.player4_id) {
        const { data: player } = await supabase
          .from('players')
          .select('name')
          .eq('id', match.player4_id)
          .single();
        if (player) {
          const { data: account } = await supabase
            .from('player_accounts')
            .select('id')
            .ilike('name', player.name)
            .maybeSingle();
          if (account) playerIds.push(account.id);
        }
      }

      const uniquePlayerIds = [...new Set(playerIds)];

      for (const playerId of uniquePlayerIds) {
        const { data: alreadySent } = await supabase
          .from('match_notifications_sent')
          .select('id')
          .eq('match_id', match.id)
          .eq('player_account_id', playerId)
          .eq('notification_type', 'reminder_1h')
          .maybeSingle();

        if (alreadySent) {
          continue;
        }

        const { data: subscriptions } = await supabase
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth')
          .eq('player_account_id', playerId);

        if (!subscriptions || subscriptions.length === 0) {
          continue;
        }

        const courtInfo = match.court_number ? ` - Campo ${match.court_number}` : '';
        const payload = {
          title: 'Jogo em breve!',
          body: `O seu jogo em ${tournament.name} comeca as ${match.scheduled_time}${courtInfo}`,
          url: `/live/${tournament.id}`,
          tag: `match-${match.id}`,
        };

        try {
          const response = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              playerAccountId: playerId,
              payload,
            }),
          });

          const result = await response.json();

          if (result.success || result.sentCount > 0) {
            await supabase
              .from('match_notifications_sent')
              .insert({
                match_id: match.id,
                player_account_id: playerId,
                notification_type: 'reminder_1h',
              });
            notifiedCount++;
          }
        } catch (err) {
          errors.push(`Failed to notify player ${playerId}: ${err}`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        matchesChecked: upcomingMatches.length,
        notified: notifiedCount,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in notify-upcoming-matches:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
