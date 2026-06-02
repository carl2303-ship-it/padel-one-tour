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
 * Notify players when a new tournament becomes visible (status changes to active/draft with public visibility).
 * 
 * Can be called:
 * 1. Directly when a tournament is created/published (from Tour app)
 * 2. Via cron to catch any tournaments that became active recently
 *
 * Uses open_game_notifications_sent table with notification_type = 'new_tournament' to avoid duplicates.
 */

interface RequestBody {
  tournamentId?: string;
  mode?: "cron" | "direct";
}

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

    let body: RequestBody = {};
    try {
      body = await req.json();
    } catch {
      body = { mode: "cron" };
    }

    let tournamentsToNotify: any[] = [];

    if (body.tournamentId) {
      // Direct call: notify about a specific tournament
      const { data: tournament } = await admin
        .from("tournaments")
        .select("id, name, start_date, end_date, status, image_url, club_id, club_ids, visibility, format, gender, allow_public_registration")
        .eq("id", body.tournamentId)
        .maybeSingle();

      if (tournament) {
        tournamentsToNotify = [tournament];
      }
    } else {
      // Cron mode: find tournaments created/activated in the last 30 minutes that haven't been notified yet
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const today = new Date().toISOString().split("T")[0];

      const { data: recentTournaments } = await admin
        .from("tournaments")
        .select("id, name, start_date, end_date, status, image_url, club_id, club_ids, visibility, format, gender, allow_public_registration, created_at")
        .in("status", ["draft", "active", "in_progress"])
        .gte("end_date", today)
        .gte("created_at", thirtyMinAgo)
        .neq("visibility", "invite_only");

      tournamentsToNotify = recentTournaments || [];
    }

    if (tournamentsToNotify.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, notified: 0, reason: "no_new_tournaments" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let totalNotified = 0;

    for (const tournament of tournamentsToNotify) {
      // Skip invite-only tournaments
      if (tournament.visibility === "invite_only") continue;

      // Check if we already sent notification for this tournament
      const { data: alreadySent } = await admin
        .from("open_game_notifications_sent")
        .select("id")
        .eq("game_id", tournament.id)
        .eq("notification_type", "new_tournament")
        .limit(1);

      if (alreadySent && alreadySent.length > 0) continue;

      // Get club name(s) for the notification
      let clubName = "";
      const clubIds: string[] = [];
      if (tournament.club_ids) {
        const ids = Array.isArray(tournament.club_ids)
          ? tournament.club_ids
          : typeof tournament.club_ids === "string" && tournament.club_ids.startsWith("{")
            ? tournament.club_ids.slice(1, -1).split(",").map((s: string) => s.trim())
            : [];
        clubIds.push(...ids);
      }
      if (clubIds.length === 0 && tournament.club_id) {
        clubIds.push(tournament.club_id);
      }

      if (clubIds.length > 0) {
        const { data: clubs } = await admin
          .from("clubs")
          .select("name")
          .in("id", clubIds);
        if (clubs && clubs.length > 0) {
          clubName = clubs.map((c: any) => c.name).join(" · ");
        }
      }

      // Format dates
      const startDate = new Date(tournament.start_date);
      let dateStr: string;
      try {
        const dateFmt = new Intl.DateTimeFormat("pt-PT", {
          day: "2-digit",
          month: "short",
        });
        dateStr = dateFmt.format(startDate);
      } catch {
        dateStr = `${startDate.getDate()}/${startDate.getMonth() + 1}`;
      }

      // Build notification payload
      const formatLabels: Record<string, string> = {
        round_robin: "Round Robin",
        groups_knockout: "Grupos + Eliminatórias",
        knockout: "Eliminatórias",
        ladder: "Escada",
        individual_groups_knockout: "Individual",
        mixed_american: "Misto Americano",
        super_teams: "Super Equipas",
      };
      const formatLabel = formatLabels[tournament.format] || tournament.format || "";
      const locationPart = clubName ? ` · ${clubName}` : "";
      const formatPart = formatLabel ? ` · ${formatLabel}` : "";

      const payload = {
        title: `Novo torneio: ${tournament.name}`,
        body: `${dateStr}${locationPart}${formatPart}. Inscreve-te já!`,
        url: "/?screen=tournaments",
        tag: `new-tournament-${tournament.id}`,
      };

      // Send to ALL players with push subscriptions (public tournament = notify everyone)
      // For gender-specific tournaments, filter accordingly
      let query = admin
        .from("push_subscriptions")
        .select("player_account_id")
        .eq("app_source", "player")
        .not("player_account_id", "is", null);

      const { data: subscriptions } = await query;

      if (!subscriptions || subscriptions.length === 0) continue;

      // Deduplicate by player_account_id
      const uniquePlayerIds = [...new Set(subscriptions.map((s: any) => s.player_account_id).filter(Boolean))];

      // If tournament has gender restriction, filter players
      let targetPlayerIds = uniquePlayerIds;
      if (tournament.gender && tournament.gender !== "all" && tournament.gender !== "mixed") {
        const { data: players } = await admin
          .from("player_accounts")
          .select("id, gender, player_category")
          .in("id", uniquePlayerIds.slice(0, 500));

        if (players) {
          targetPlayerIds = players
            .filter((p: any) => {
              const playerGender =
                p.gender ||
                (p.player_category?.startsWith("M") ? "male" : null) ||
                (p.player_category?.startsWith("F") ? "female" : null);
              if (!playerGender) return true;
              return playerGender === tournament.gender;
            })
            .map((p: any) => p.id);
        }
      }

      // Cap at 500 to avoid timeout
      const targets = targetPlayerIds.slice(0, 500);
      console.log(`[notify-new-tournament] Sending notification for "${tournament.name}" to ${targets.length} players`);

      const results = await Promise.allSettled(
        targets.map(async (playerAccountId: string) => {
          return await deliverWebPushNotifications(admin, {
            vapidPublicKey,
            vapidPrivateKey,
            playerAccountId,
            payload,
            appSource: "player",
          });
        }),
      );

      let sentCount = 0;
      for (const r of results) {
        if (r.status === "fulfilled") {
          sentCount += r.value.sentCount;
        }
      }

      // Mark as sent to prevent duplicates (use first target as player_account_id reference)
      if (targets.length > 0) {
        await admin
          .from("open_game_notifications_sent")
          .insert({
            game_id: tournament.id,
            player_account_id: targets[0],
            notification_type: "new_tournament",
          });
      }

      totalNotified += sentCount;
      console.log(`[notify-new-tournament] Tournament "${tournament.name}": ${sentCount} push delivered to ${targets.length} targets`);
    }

    return new Response(
      JSON.stringify({ ok: true, tournaments: tournamentsToNotify.length, notified: totalNotified }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[notify-new-tournament] Error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
