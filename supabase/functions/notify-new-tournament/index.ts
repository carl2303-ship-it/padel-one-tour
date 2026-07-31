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
 * Notify players when a tournament becomes active (or on manual resend).
 *
 * Body:
 * - tournamentId?: string
 * - forceResend?: boolean  — bypass already_sent, use update copy, filter by category levels
 * - mode?: "cron" | "direct"
 *
 * Skips draft / cancelled. Cron only looks at recently activated tournaments.
 */

interface RequestBody {
  tournamentId?: string;
  forceResend?: boolean;
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

function playerLevelMatches(
  level: number | null | undefined,
  ranges: Array<{ min: number | null; max: number | null; accepted: string[] | null }>,
): boolean {
  if (!ranges.length) return true; // no category constraints → all levels
  if (level == null || Number.isNaN(level)) return true; // unknown level: include

  return ranges.some((r) => {
    if (r.accepted && r.accepted.length > 0) {
      const levelStr = String(level);
      const levelOneDecimal = level.toFixed(1);
      const levelInt = String(Math.floor(level));
      if (
        r.accepted.includes(levelStr) ||
        r.accepted.includes(levelOneDecimal) ||
        r.accepted.includes(levelInt)
      ) {
        return true;
      }
    }
    const minOk = r.min == null || level >= Number(r.min);
    const maxOk = r.max == null || level <= Number(r.max);
    // If only accepted_levels was set (no min/max), don't match via range
    if (r.min == null && r.max == null && r.accepted && r.accepted.length > 0) {
      return false;
    }
    return minOk && maxOk;
  });
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

    const forceResend = !!body.forceResend;
    let tournamentsToNotify: any[] = [];

    if (body.tournamentId) {
      const { data: tournament } = await admin
        .from("tournaments")
        .select(
          "id, name, start_date, end_date, status, image_url, club_id, club_ids, visibility, format, gender, allow_public_registration, user_id, venue_lat, venue_lng, visibility_radius_km, updated_at",
        )
        .eq("id", body.tournamentId)
        .maybeSingle();

      if (tournament) {
        tournamentsToNotify = [tournament];
      }
    } else {
      // Cron: only recently activated tournaments (not drafts)
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const today = new Date().toISOString().split("T")[0];

      const { data: recentTournaments } = await admin
        .from("tournaments")
        .select(
          "id, name, start_date, end_date, status, image_url, club_id, club_ids, visibility, format, gender, allow_public_registration, created_at, updated_at, user_id, venue_lat, venue_lng, visibility_radius_km",
        )
        .eq("status", "active")
        .gte("end_date", today)
        .gte("updated_at", thirtyMinAgo)
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
      if (tournament.status !== "active" && tournament.status !== "in_progress") {
        details.push({ id: tournament.id, skipped: "not_active", status: tournament.status });
        continue;
      }

      if (tournament.visibility === "invite_only") {
        details.push({ id: tournament.id, skipped: "invite_only" });
        continue;
      }

      if (tournament.allow_public_registration === false) {
        details.push({ id: tournament.id, skipped: "registration_closed" });
        continue;
      }

      if (!forceResend) {
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

      // Load category level ranges for filtering (always useful; required intent on resend)
      const { data: categories } = await admin
        .from("tournament_categories")
        .select("min_level, max_level, accepted_levels, name")
        .eq("tournament_id", tournament.id);

      const levelRanges = (categories || []).map((c: any) => ({
        min: c.min_level != null ? Number(c.min_level) : null,
        max: c.max_level != null ? Number(c.max_level) : null,
        accepted: Array.isArray(c.accepted_levels) ? c.accepted_levels.map(String) : null,
      }));
      const hasLevelConstraints = levelRanges.some(
        (r) => r.min != null || r.max != null || (r.accepted && r.accepted.length > 0),
      );

      const categoryNames = (categories || [])
        .map((c: any) => c.name)
        .filter(Boolean)
        .slice(0, 3)
        .join(", ");

      const payload = forceResend
        ? {
          title: `Atualização: ${tournament.name}`,
          body: `${dateStr}${locationPart}${formatPart}${categoryNames ? ` · ${categoryNames}` : ""}. Vê as novidades e inscreve-te!`,
          url: `/?screen=tournaments&tournament=${tournament.id}`,
          tag: `tournament-update-${tournament.id}-${Date.now()}`,
        }
        : {
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
        }
      }

      if (targetPlayerIds.length === 0) {
        details.push({ id: tournament.id, skipped: "no_targets" });
        continue;
      }

      // Gender + level filter in batches
      const filteredIds: string[] = [];
      for (let i = 0; i < targetPlayerIds.length; i += 500) {
        const batch = targetPlayerIds.slice(i, i + 500);
        const { data: players } = await admin
          .from("player_accounts")
          .select("id, gender, player_category, level")
          .in("id", batch);

        for (const p of players || []) {
          if (tournament.gender && tournament.gender !== "all" && tournament.gender !== "mixed") {
            const playerGender =
              p.gender ||
              (p.player_category?.startsWith("M") ? "male" : null) ||
              (p.player_category?.startsWith("F") ? "female" : null);
            if (playerGender && playerGender !== tournament.gender) continue;
          }

          // On forceResend always apply level filter when categories have constraints.
          // On first notify also apply if constraints exist (avoid irrelevant levels).
          if (hasLevelConstraints) {
            const lvl = p.level != null ? Number(p.level) : null;
            if (!playerLevelMatches(lvl, levelRanges)) continue;
          }

          filteredIds.push(p.id);
        }
      }
      targetPlayerIds = filteredIds;

      if (targetPlayerIds.length === 0) {
        details.push({ id: tournament.id, skipped: "no_targets_after_filter" });
        continue;
      }

      const targets = targetPlayerIds.slice(0, 500);
      console.log(
        `[notify-new-tournament] ${forceResend ? "Resend" : "New"} for "${tournament.name}" to ${targets.length} players (levelFilter=${hasLevelConstraints})`,
      );

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

      // Mark first activation notify as sent (resend bypasses this check via forceResend)
      if (sentCount > 0 && !forceResend) {
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
        forceResend,
        levelFilter: hasLevelConstraints,
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
