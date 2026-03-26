import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

/**
 * Notify players about upcoming events starting in the next hour:
 * 1. Open games (open_games) → notify confirmed players
 * 2. Classes (club_classes) → notify enrolled students
 * 3. Tournament matches (matches) → handled by notify-upcoming-matches
 * 
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

    let totalNotified = 0;
    const allErrors: string[] = [];

    // =============================================
    // PART 1: Open Games (existing logic)
    // =============================================
    const { data: upcomingGames, error: gamesError } = await supabase
      .from('open_games')
      .select('id, scheduled_at, club_id, court_id, creator_user_id')
      .in('status', ['open', 'full'])
      .gte('scheduled_at', now.toISOString())
      .lte('scheduled_at', oneHourFromNow.toISOString());

    if (gamesError) {
      console.error('Error fetching open games:', gamesError);
    }

    if (upcomingGames && upcomingGames.length > 0) {
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
              await supabase
                .from('open_game_notifications_sent')
                .insert({
                  game_id: game.id,
                  player_account_id: player.player_account_id,
                  notification_type: 'reminder_1h',
                });
              totalNotified++;
            }
          } catch (err) {
            allErrors.push(`[Game] Failed to notify ${player.player_account_id}: ${err}`);
          }
        }
      }
    }

    // =============================================
    // PART 2: Classes (NEW - 1h before class)
    // =============================================
    const { data: upcomingClasses, error: classesError } = await supabase
      .from('club_classes')
      .select('id, scheduled_at, club_owner_id, class_type_id, coach_id')
      .eq('status', 'scheduled')
      .gte('scheduled_at', now.toISOString())
      .lte('scheduled_at', oneHourFromNow.toISOString());

    if (classesError) {
      console.error('Error fetching upcoming classes:', classesError);
    }

    if (upcomingClasses && upcomingClasses.length > 0) {
      const classIds = upcomingClasses.map(c => c.id);

      // Fetch enrolled students with their player_account_id
      const { data: enrollments } = await supabase
        .from('class_enrollments')
        .select('class_id, player_account_id, student_id, student_name')
        .in('class_id', classIds)
        .in('status', ['enrolled', 'attended']);

      // Fetch class type names
      const classTypeIds = [...new Set(upcomingClasses.map(c => c.class_type_id).filter(Boolean))];
      const classTypesMap: Record<string, string> = {};
      if (classTypeIds.length > 0) {
        const { data: classTypes } = await supabase
          .from('class_types')
          .select('id, name')
          .in('id', classTypeIds);
        if (classTypes) {
          classTypes.forEach((ct: any) => { classTypesMap[ct.id] = ct.name; });
        }
      }

      // Fetch club names via owner_id
      const ownerIds = [...new Set(upcomingClasses.map(c => c.club_owner_id).filter(Boolean))];
      const classClubsMap: Record<string, string> = {};
      if (ownerIds.length > 0) {
        const { data: clubs } = await supabase
          .from('clubs')
          .select('owner_id, name')
          .in('owner_id', ownerIds);
        if (clubs) {
          clubs.forEach((c: any) => { classClubsMap[c.owner_id] = c.name; });
        }
      }

      // Check which class notifications were already sent
      const { data: classAlreadySent } = await supabase
        .from('open_game_notifications_sent')
        .select('game_id, player_account_id')
        .in('game_id', classIds)
        .eq('notification_type', 'class_reminder_1h');

      const classSentSet = new Set(
        (classAlreadySent || []).map((s: any) => `${s.game_id}:${s.player_account_id}`)
      );

      for (const cls of upcomingClasses) {
        const students = (enrollments || []).filter(e => e.class_id === cls.id);
        const clubName = classClubsMap[cls.club_owner_id] || 'Clube';
        const className = classTypesMap[cls.class_type_id] || 'Aula';
        const classTime = new Date(cls.scheduled_at);
        const timeStr = `${classTime.getHours().toString().padStart(2, '0')}:${classTime.getMinutes().toString().padStart(2, '0')}`;

        for (const student of students) {
          // Get the player_account_id (directly or via student_id)
          let playerAccountId = student.player_account_id;

          if (!playerAccountId && student.student_id) {
            // Try to find player_account by user_id
            const { data: pa } = await supabase
              .from('player_accounts')
              .select('id')
              .eq('user_id', student.student_id)
              .maybeSingle();
            if (pa) playerAccountId = pa.id;
          }

          if (!playerAccountId) continue;

          const key = `${cls.id}:${playerAccountId}`;
          if (classSentSet.has(key)) continue;

          try {
            const response = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                playerAccountId: playerAccountId,
                payload: {
                  title: 'Aula em breve! ⏰📚',
                  body: `A tua aula "${className}" às ${timeStr} em ${clubName} começa em menos de 1 hora.`,
                  url: '/?screen=learn',
                  tag: `class-reminder-${cls.id}`,
                },
              }),
            });

            const result = await response.json();

            if (result.success || result.sentCount > 0) {
              // Reuse open_game_notifications_sent table (game_id = class_id)
              await supabase
                .from('open_game_notifications_sent')
                .insert({
                  game_id: cls.id,
                  player_account_id: playerAccountId,
                  notification_type: 'class_reminder_1h',
                });
              totalNotified++;
            }
          } catch (err) {
            allErrors.push(`[Class] Failed to notify ${playerAccountId}: ${err}`);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        gamesChecked: upcomingGames?.length || 0,
        classesChecked: upcomingClasses?.length || 0,
        notified: totalNotified,
        errors: allErrors.length > 0 ? allErrors : undefined,
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
