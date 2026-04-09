import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { deliverWebPushNotifications } from "../_shared/deliverPush.ts";
import {
  isPlayerEligibleForCategory,
  type TournamentCategoryEligibility,
} from "../_shared/categoryEligibility.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type SidePreference = "right" | "left";
type TargetMode = "any" | "following";

function isTeamTournament(format: string | null, roundRobinType: string | null): boolean {
  if (!format) return false;
  if (format === "round_robin") return roundRobinType !== "individual";
  return !["individual_groups_knockout", "mixed_american"].includes(format);
}

async function fetchAllCandidateAccounts(
  admin: SupabaseClient,
  requesterId: string,
  followingIds: string[] | null,
): Promise<any[]> {
  const pageSize = 1000;
  let from = 0;
  const allRows: any[] = [];

  while (true) {
    let q = admin
      .from("player_accounts")
      .select("id, user_id, name, court_position, player_category, level")
      .not("user_id", "is", null)
      .neq("id", requesterId)
      .range(from, from + pageSize - 1);
    if (followingIds) q = q.in("user_id", followingIds);

    const { data, error } = await q;
    if (error) throw error;

    const rows = data || [];
    allRows.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

async function sendPartnerInvitePush(
  admin: SupabaseClient,
  params: {
    inviteId: string;
    tournamentId: string;
    tournamentName: string;
    requesterName: string;
    inviteeUserId: string | null;
    inviteePlayerAccountId: string | null;
  },
): Promise<{ sent: number; via: "user_id" | "player_account_id" | "none" }> {
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!vapidPublicKey || !vapidPrivateKey) return { sent: 0, via: "none" };

  const payload = {
    title: "Novo convite de parceiro",
    body: `${params.requesterName} convidou-te para jogar ${params.tournamentName}.`,
    url: `/?screen=compete&tournament=${params.tournamentId}&partner_invite=${params.inviteId}`,
    tag: `partner-invite-${params.inviteId}`,
  };

  if (params.inviteeUserId) {
    const { sentCount } = await deliverWebPushNotifications(admin, {
      vapidPublicKey,
      vapidPrivateKey,
      userId: params.inviteeUserId,
      appSource: "tour",
      payload,
    });
    if (sentCount > 0) return { sent: sentCount, via: "user_id" };
  }

  if (params.inviteePlayerAccountId) {
    const { sentCount } = await deliverWebPushNotifications(admin, {
      vapidPublicKey,
      vapidPrivateKey,
      playerAccountId: params.inviteePlayerAccountId,
      appSource: "tour",
      payload,
    });
    if (sentCount > 0) return { sent: sentCount, via: "player_account_id" };
  }

  return { sent: 0, via: "none" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) throw new Error("Missing auth token");

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) throw new Error("Unauthorized");

    const body = await req.json();
    const tournamentId = body.tournamentId as string;
    const categoryId = (body.categoryId as string | null) ?? null;
    const sidePreference = (body.sidePreference as SidePreference) ?? "right";
    const targetMode = (body.targetMode as TargetMode) ?? "any";
    if (!tournamentId) throw new Error("Missing tournamentId");

    const userId = authData.user.id;
    const { data: requester, error: requesterError } = await admin
      .from("player_accounts")
      .select("id, user_id, name, player_category, level, court_position, email, phone_number")
      .eq("user_id", userId)
      .maybeSingle();
    if (requesterError || !requester) throw new Error("Requester player account not found");

    const { data: tournament, error: tournamentError } = await admin
      .from("tournaments")
      .select("id, name, format, round_robin_type, status")
      .eq("id", tournamentId)
      .maybeSingle();
    if (tournamentError || !tournament) throw new Error("Tournament not found");
    if (tournament.status !== "active") throw new Error("Tournament is not active");
    if (!isTeamTournament(tournament.format, tournament.round_robin_type)) {
      throw new Error("Partner matching only available for team formats");
    }

    let effectiveCategoryId = categoryId;
    if (!effectiveCategoryId) {
      const { data: categories } = await admin
        .from("tournament_categories")
        .select("id, accepted_levels")
        .eq("tournament_id", tournamentId);
      const byProfile = (categories || []).find((c: any) =>
        requester.player_category && Array.isArray(c.accepted_levels) && c.accepted_levels.includes(requester.player_category)
      );
      effectiveCategoryId = byProfile?.id ?? categories?.[0]?.id ?? null;
    }

    let categoryForInvitees: TournamentCategoryEligibility | null = null;
    if (effectiveCategoryId) {
      const { data: catRow, error: catErr } = await admin
        .from("tournament_categories")
        .select("id, name, accepted_levels, min_level, max_level")
        .eq("id", effectiveCategoryId)
        .maybeSingle();
      if (catErr) throw catErr;
      if (!catRow) throw new Error("Tournament category not found");
      categoryForInvitees = catRow as TournamentCategoryEligibility;
      if (
        !isPlayerEligibleForCategory(categoryForInvitees, {
          player_category: requester.player_category,
          level: requester.level,
        })
      ) {
        throw new Error("A tua categoria não é elegível para esta categoria do torneio");
      }
    }

    let followingIds: string[] | null = null;
    if (targetMode === "following") {
      const { data: follows } = await admin
        .from("follows")
        .select("following_id")
        .eq("follower_id", userId);
      followingIds = (follows || []).map((f: any) => f.following_id);
      if (!followingIds.length) {
        return new Response(JSON.stringify({ success: true, requestId: null, invitesSent: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const candidates = await fetchAllCandidateAccounts(admin, requester.id, followingIds);

    // `sidePreference` represents requester's side.
    // Partner should be complementary side (right <-> left), with `both` always compatible.
    const desiredPartnerSide = sidePreference === "right" ? "left" : "right";
    const compatible = (candidates || []).filter((c: any) => {
      if (!c.user_id || c.user_id === requester.user_id) return false;
      const pos = (c.court_position || "both") as string;
      if (!(pos === "both" || pos === desiredPartnerSide)) return false;
      if (categoryForInvitees) {
        if (
          !isPlayerEligibleForCategory(categoryForInvitees, {
            player_category: c.player_category,
            level: c.level,
          })
        ) {
          return false;
        }
      }
      return true;
    });

    // Uma linha por jogador (auth): vários player_accounts com o mesmo user_id → um convite; escolher id estável (menor UUID).
    const byInviteeUserId = new Map<string, any[]>();
    for (const c of compatible) {
      const uid = c.user_id as string;
      if (!byInviteeUserId.has(uid)) byInviteeUserId.set(uid, []);
      byInviteeUserId.get(uid)!.push(c);
    }
    const compatibleOnePerUser = Array.from(byInviteeUserId.values()).map((rows) =>
      rows.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[0],
    );

    const candidateIds = compatibleOnePerUser.map((c: any) => c.id);
    const { data: alreadyPlayers } = candidateIds.length
      ? await admin
          .from("players")
          .select("player_account_id")
          .eq("tournament_id", tournamentId)
          .in("player_account_id", candidateIds)
      : { data: [] as any[] };
    const busySet = new Set((alreadyPlayers || []).map((p: any) => p.player_account_id));
    const finalCandidates = compatibleOnePerUser.filter((c: any) => !busySet.has(c.id));

    const { data: requestRow, error: requestError } = await admin
      .from("partner_match_requests")
      .insert({
        tournament_id: tournamentId,
        category_id: effectiveCategoryId,
        requester_user_id: requester.user_id,
        requester_player_account_id: requester.id,
        side_preference: sidePreference,
        target_mode: targetMode,
      })
      .select("id")
      .single();
    if (requestError || !requestRow) throw requestError || new Error("Failed to create request");

    if (!finalCandidates.length) {
      return new Response(JSON.stringify({ success: true, requestId: requestRow.id, invitesSent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const paIds = finalCandidates.map((c: any) => c.id as string);
    const { data: paRows, error: paErr } = await admin
      .from("player_accounts")
      .select("id, user_id")
      .in("id", paIds);
    if (paErr) throw paErr;
    const uidByAccountId = new Map<string, string>();
    for (const r of paRows || []) {
      const row = r as { id: string; user_id: string | null };
      if (row.id && row.user_id) uidByAccountId.set(row.id, row.user_id);
    }

    const inviteRows: {
      request_id: string;
      tournament_id: string;
      category_id: string | null;
      requester_user_id: string;
      requester_player_account_id: string;
      invitee_user_id: string;
      invitee_player_account_id: string;
    }[] = [];

    for (const c of finalCandidates) {
      const cid = c.id as string;
      const inviteeUid = uidByAccountId.get(cid) || (c.user_id as string | null);
      if (!inviteeUid || inviteeUid === requester.user_id) continue;
      inviteRows.push({
        request_id: requestRow.id,
        tournament_id: tournamentId,
        category_id: effectiveCategoryId,
        requester_user_id: requester.user_id,
        requester_player_account_id: requester.id,
        invitee_user_id: inviteeUid,
        invitee_player_account_id: cid,
      });
    }

    if (!inviteRows.length) {
      return new Response(JSON.stringify({ success: true, requestId: requestRow.id, invitesSent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: invites, error: invitesError } = await admin
      .from("partner_match_invites")
      .insert(inviteRows)
      .select("id, invitee_player_account_id, invitee_user_id");
    if (invitesError) throw invitesError;

    let pushDelivered = 0;
    let pushByUserId = 0;
    let pushByPlayerAccount = 0;
    for (const inv of invites || []) {
      const pushResult = await sendPartnerInvitePush(admin, {
        inviteId: inv.id,
        tournamentId,
        tournamentName: tournament.name,
        requesterName: requester.name,
        inviteeUserId: inv.invitee_user_id ?? null,
        inviteePlayerAccountId: inv.invitee_player_account_id ?? null,
      });
      pushDelivered += pushResult.sent;
      if (pushResult.via === "user_id") pushByUserId += 1;
      if (pushResult.via === "player_account_id") pushByPlayerAccount += 1;
    }

    return new Response(
      JSON.stringify({
        success: true,
        requestId: requestRow.id,
        invitesSent: (invites || []).length,
        pushDelivered,
        pushByUserId,
        pushByPlayerAccount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

