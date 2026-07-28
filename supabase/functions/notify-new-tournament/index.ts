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
 * Notify players when a new tournament becomes visible.
 *
 * Can be called:
 * 1. Directly when a tournament is created/published (from Tour app)
 * 2. Via cron to catch any tournaments that became active recently
 *
 * Uses open_game_notifications_sent with notification_type = 'new_tournament' to avoid duplicates.
 */

interface RequestBody {
  tournamentId?: string;
  mode?: "cron" | "direct";
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Normalize phone for matching organizer_players ↔ player_accounts */
function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, "");
  if (cleaned.startsWith("+00")) cleaned = cleaned.slice(3);
  else if (cleaned.startsWith("+")) cleaned = cleaned.slice(1);
  else if (cleaned.startsWith("00")) cleaned = cleaned.slice(2);
  cleaned = cleaned.replace(/^351(?=[29]\d{8}$)/, "");
  if (cleaned.startsWith("0") && cleaned.length >= 9) cleaned = cleaned.slice(1);
  return cleaned;
}

function parseClubIds(tournament: Record<string, unknown>): string[] {
  const clubIds: string[] = [];
  const raw = tournament.club_ids;
  if (raw) {
    if (Array.isArray(raw)) {
      clubIds.push(...raw.filter(Boolean).map(String));
    } else if (typeof raw === "string") {
      if (raw.startsWith("{") && raw.endsWith("}")) {
        clubIds.push(...raw.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean));
      } else if (raw.length > 0) {
        clubIds.push(raw);
      }
    }
  }
  if (clubIds.length === 0 && tournament.club_id) {
    clubIds.push(String(tournament.club_id));
  }
  return clubIds;
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
      console.error("[notify-new-tournament] VAPID keys missing");
      return new Response(
        JSON.stringify({ ok: false, message: "VAPID not configured" }),
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
      const { data: tournament } = await admin
        .from("tournaments")
        .select("id, name, start_date, end_date, status, image_url, club_id, club_ids, visibility, format, gender, allow_public_registration, user_id, venue_lat, venue_lng, visibility_radius_km")
        .eq("id", body.tournamentId)
        .maybeSingle();

      if (tournament) {
        tournamentsToNotify = [tournament];
      }
    } else {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const today = new Date().toISOString().split("T")[0];

      const { data: recentTournaments } = await admin
        .from("tournaments")
        .select("id, name, start_date, end_date, status, image_url, club_id, club_ids, visibility, format, gender, allow_public_registration, created_at, user_id, venue_lat, venue_lng, visibility_radius_km")
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
    const details: Array<Record<string, unknown>> = [];

    for (const tournament of tournamentsToNotify) {
      if (tournament.visibility === "invite_only") {
        details.push({ id: tournament.id, skipped: "invite_only" });
        continue;
      }

      // Club/public tournaments must be open for registration to be useful
      if (tournament.allow_public_registration === false && tournament.visibility !== "invite_only") {
        details.push({ id: tournament.id, skipped: "registration_closed" });
        continue;
      }

      const { data: alreadySent } = await admin
        .from("open_game_notifications_sent")
        .select("id")
        .eq("game_id", tournament.id)
        .eq("notification_type", "new_tournament")
        .limit(1);

      if (alreadySent && alreadySent.length > 0) {
        details.push({ id: tournament.id, skipped: "already_sent" });
        continue;
      }

      let clubName = "";
      const clubIds = parseClubIds(tournament);

      if (clubIds.length > 0) {
        const { data: clubs } = await admin
          .from("clubs")
          .select("name")
          .in("id", clubIds);
        if (clubs && clubs.length > 0) {
          clubName = clubs.map((c: any) => c.name).join(" · ");
        }
      }

      const startDate = new Date(tournament.start_date);
      let dateStr: string;
      try {
        dateStr = new Intl.DateTimeFormat("pt-PT", {
          day: "2-digit",
          month: "short",
        }).format(startDate);
      } catch {
        dateStr = `${startDate.getDate()}/${startDate.getMonth() + 1}`;
      }

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
        url: `/?screen=tournaments&tournament=${tournament.id}`,
        tag: `new-tournament-${tournament.id}`,
      };

      let targetPlayerIds: string[] = [];
      const isIndependentTournament = clubIds.length === 0;

      if (isIndependentTournament) {
        const targetSet = new Set<string>();

        const { data: contacts } = await admin
          .from("organizer_players")
          .select("phone_number")
          .eq("organizer_id", tournament.user_id)
          .not("phone_number", "is", null);

        if (contacts && contacts.length > 0) {
          const phoneKeys = new Set(
            contacts.map((c: any) => normalizePhone(c.phone_number)).filter(Boolean),
          );
          if (phoneKeys.size > 0) {
            // Fetch candidate accounts and match normalized phones (exact IN fails across formats)
            const { data: accounts } = await admin
              .from("player_accounts")
              .select("id, phone_number")
              .not("phone_number", "is", null)
              .limit(5000);

            for (const a of accounts || []) {
              if (phoneKeys.has(normalizePhone(a.phone_number))) {
                targetSet.add(a.id);
              }
            }
          }
        }

        if (tournament.venue_lat && tournament.venue_lng) {
          const radius = tournament.visibility_radius_km || 50;
          const { data: nearbyPlayers } = await admin
            .from("player_accounts")
            .select("id, lat, lng")
            .not("lat", "is", null)
            .not("lng", "is", null);

          if (nearbyPlayers) {
            for (const p of nearbyPlayers) {
              const dist = haversineKm(tournament.venue_lat, tournament.venue_lng, p.lat, p.lng);
              if (dist <= radius) targetSet.add(p.id);
            }
          }
        }

        targetPlayerIds = [...targetSet];
      } else {
        // Club tournaments: notify players linked to the club(s)
        const { data: clubPlayers } = await admin
          .from("player_clubs")
          .select("player_account_id")
          .in("club_id", clubIds);

        const clubPlayerIds = [...new Set(
          (clubPlayers || []).map((r: any) => r.player_account_id).filter(Boolean),
        )];

        if (clubPlayerIds.length > 0) {
          targetPlayerIds = clubPlayerIds;
        } else {
          // Fallback: players with push who previously played at this club
          const { data: pastPlayers } = await admin
            .from("players")
            .select("player_account_id, tournament_id")
            .not("player_account_id", "is", null)
            .limit(2000);

          // Prefer push subscribers as last resort only for small clubs with no player_clubs
          const { data: subscriptions } = await admin
            .from("push_subscriptions")
            .select("player_account_id")
            .eq("app_source", "player")
            .not("player_account_id", "is", null);

          targetPlayerIds = [...new Set(
            (subscriptions || []).map((s: any) => s.player_account_id).filter(Boolean),
          )];
          console.log(
            `[notify-new-tournament] Club ${clubIds.join(",")} has no player_clubs; fallback to ${targetPlayerIds.length} push subscribers`,
          );
          void pastPlayers;
        }
      }

      if (targetPlayerIds.length === 0) {
        details.push({ id: tournament.id, skipped: "no_targets" });
        continue;
      }

      if (tournament.gender && tournament.gender !== "all" && tournament.gender !== "mixed") {
        const { data: players } = await admin
          .from("player_accounts")
          .select("id, gender, player_category")
          .in("id", targetPlayerIds.slice(0, 500));

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

      const targets = targetPlayerIds.slice(0, 500);
      console.log(`[notify-new-tournament] Sending for "${tournament.name}" to ${targets.length} players`);

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

      // Only dedupe when at least one push was delivered (allows retry if VAPID/subs fail)
      if (sentCount > 0) {
        await admin
          .from("open_game_notifications_sent")
          .insert({
            game_id: tournament.id,
            player_account_id: targets[0],
            notification_type: "new_tournament",
          });
      }

      totalNotified += sentCount;
      details.push({
        id: tournament.id,
        name: tournament.name,
        targets: targets.length,
        sent: sentCount,
      });
      console.log(`[notify-new-tournament] "${tournament.name}": ${sentCount} push to ${targets.length} targets`);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        tournaments: tournamentsToNotify.length,
        notified: totalNotified,
        details,
      }),
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
