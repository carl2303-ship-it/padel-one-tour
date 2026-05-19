import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { deliverWebPushNotifications } from "../_shared/deliverPush.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

/**
 * Escalated reminders for open games that are NOT full yet.
 * Sends push notifications to matching players at these intervals before the game:
 * 24h, 16h, 8h, 4h, 2h, 1h
 *
 * Runs via cron every 15 minutes.
 * Uses open_game_notifications_sent to avoid duplicates (notification_type per threshold).
 */

const REMINDER_THRESHOLDS = [
  { hours: 24, type: "fill_reminder_24h", label: "24 horas" },
  { hours: 16, type: "fill_reminder_16h", label: "16 horas" },
  { hours: 8, type: "fill_reminder_8h", label: "8 horas" },
  { hours: 4, type: "fill_reminder_4h", label: "4 horas" },
  { hours: 2, type: "fill_reminder_2h", label: "2 horas" },
  { hours: 1, type: "fill_reminder_1h", label: "1 hora" },
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");

    if (!vapidPublicKey || !vapidPrivateKey) {
      return new Response(
        JSON.stringify({ ok: true, message: "VAPID not configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const now = new Date();
    let totalNotified = 0;
    const errors: string[] = [];

    // Find open (not full) games within the next 24 hours
    const twentyFourHoursLater = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const { data: openGames, error: gamesErr } = await admin
      .from("open_games")
      .select("id, scheduled_at, club_id, level_min, level_max, gender, game_type, creator_user_id")
      .eq("status", "open")
      .gte("scheduled_at", now.toISOString())
      .lte("scheduled_at", twentyFourHoursLater.toISOString());

    if (gamesErr) {
      console.error("[open-game-reminders] Error fetching games:", gamesErr);
      throw gamesErr;
    }

    if (!openGames || openGames.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, notified: 0, reason: "no_open_games" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[open-game-reminders] Found ${openGames.length} open (not full) games in next 24h`);

    // For each game, determine which reminder thresholds apply
    for (const game of openGames) {
      const gameTime = new Date(game.scheduled_at);
      const hoursUntilGame = (gameTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Find the applicable reminder (the closest threshold that just passed)
      const applicableReminder = REMINDER_THRESHOLDS.find((t) => {
        const windowStart = t.hours;
        const windowEnd = t.hours - 0.25; // 15-min cron window
        return hoursUntilGame <= windowStart && hoursUntilGame > windowEnd;
      });

      if (!applicableReminder) continue;

      // Check how many players are confirmed
      const { count: playerCount } = await admin
        .from("open_game_players")
        .select("id", { count: "exact", head: true })
        .eq("game_id", game.id)
        .eq("status", "confirmed");

      const confirmed = playerCount || 0;
      if (confirmed >= 4) continue; // Game is effectively full

      const spotsLeft = 4 - confirmed;

      // Check if this specific reminder was already sent for this game
      const { data: alreadySent } = await admin
        .from("open_game_notifications_sent")
        .select("id")
        .eq("game_id", game.id)
        .eq("notification_type", applicableReminder.type)
        .limit(1);

      if (alreadySent && alreadySent.length > 0) continue;

      // Get club info
      let clubName = "Clube";
      let clubTimezone = "Europe/Lisbon";
      if (game.club_id) {
        const { data: club } = await admin
          .from("clubs")
          .select("name, timezone")
          .eq("id", game.club_id)
          .maybeSingle();
        if (club?.name) clubName = club.name;
        if (club?.timezone) clubTimezone = club.timezone;
      }

      // Format time in club timezone
      let timeStr: string;
      let dateStr: string;
      try {
        const timeFmt = new Intl.DateTimeFormat("pt-PT", {
          timeZone: clubTimezone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        const dateFmt = new Intl.DateTimeFormat("pt-PT", {
          timeZone: clubTimezone,
          day: "2-digit",
          month: "2-digit",
        });
        timeStr = timeFmt.format(gameTime);
        dateStr = dateFmt.format(gameTime);
      } catch {
        timeStr = `${gameTime.getUTCHours().toString().padStart(2, "0")}:${gameTime.getUTCMinutes().toString().padStart(2, "0")}`;
        dateStr = `${gameTime.getUTCDate().toString().padStart(2, "0")}/${(gameTime.getUTCMonth() + 1).toString().padStart(2, "0")}`;
      }

      // Find matching players (same logic as notify-new-open-game)
      const widerLevelMin = Math.max(0.5, (game.level_min || 1) - 0.5);
      const widerLevelMax = (game.level_max || 10) + 0.5;

      const { data: candidates } = await admin
        .from("player_accounts")
        .select("id, user_id, gender, level, player_category, preferred_time")
        .not("user_id", "is", null)
        .gte("level", widerLevelMin)
        .lte("level", widerLevelMax);

      const { data: nullLevelCandidates } = await admin
        .from("player_accounts")
        .select("id, user_id, gender, level, player_category, preferred_time")
        .not("user_id", "is", null)
        .is("level", null);

      const seenIds = new Set<string>();
      const allCandidates = [...(candidates || []), ...(nullLevelCandidates || [])].filter((p) => {
        if (seenIds.has(p.id)) return false;
        seenIds.add(p.id);
        return true;
      });

      // Exclude creator and already-joined players
      const { data: existingPlayers } = await admin
        .from("open_game_players")
        .select("player_account_id")
        .eq("game_id", game.id);

      const joinedIds = new Set((existingPlayers || []).map((p: any) => p.player_account_id));

      const filtered = allCandidates.filter((p) => {
        if (p.user_id === game.creator_user_id) return false;
        if (joinedIds.has(p.id)) return false;
        // Gender filter
        if (game.gender && game.gender !== "all" && game.gender !== "mixed") {
          const playerGender =
            p.gender ||
            (p.player_category?.startsWith("M") ? "male" : null) ||
            (p.player_category?.startsWith("F") ? "female" : null);
          if (playerGender && playerGender !== game.gender) return false;
        }
        return true;
      });

      if (filtered.length === 0) continue;

      const spotsText = spotsLeft === 1 ? "Falta 1 jogador" : `Faltam ${spotsLeft} jogadores`;
      const payload = {
        title: `${spotsText} para o jogo!`,
        body: `${clubName} · ${dateStr} às ${timeStr} · Começa em ${applicableReminder.label}. Junta-te!`,
        url: "/?screen=findGame",
        tag: `fill-reminder-${game.id}-${applicableReminder.type}`,
      };

      // Send to matching players (cap at 200)
      const targets = filtered.slice(0, 200);
      let sentForGame = 0;

      const results = await Promise.allSettled(
        targets.map(async (p) => {
          return await deliverWebPushNotifications(admin, {
            vapidPublicKey,
            vapidPrivateKey,
            playerAccountId: p.id,
            payload,
            appSource: "player",
          });
        }),
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          sentForGame += r.value.sentCount;
        }
      }

      // Mark this reminder as sent (use a single record to track per-game, not per-player)
      await admin
        .from("open_game_notifications_sent")
        .insert({
          game_id: game.id,
          player_account_id: (existingPlayers && existingPlayers[0]?.player_account_id) || targets[0].id,
          notification_type: applicableReminder.type,
        });

      totalNotified += sentForGame;
      console.log(`[open-game-reminders] Game ${game.id}: sent ${applicableReminder.type} to ${targets.length} players (${sentForGame} delivered)`);
    }

    return new Response(
      JSON.stringify({ ok: true, gamesChecked: openGames.length, notified: totalNotified, errors: errors.length > 0 ? errors : undefined }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[open-game-reminders] Error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
