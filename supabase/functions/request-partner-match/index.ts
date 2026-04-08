import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { deliverWebPushNotifications } from "../_shared/deliverPush.ts";

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
      payload,
    });
    if (sentCount > 0) return { sent: sentCount, via: "user_id" };
  }

  if (params.inviteePlayerAccountId) {
    const { sentCount } = await deliverWebPushNotifications(admin, {
      vapidPublicKey,
      vapidPrivateKey,
      playerAccountId: params.inviteePlayerAccountId,
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

    let candidatesQuery = admin
      .from("player_accounts")
      .select("id, user_id, name, court_position")
      .not("user_id", "is", null)
      .neq("id", requester.id);
    if (followingIds) candidatesQuery = candidatesQuery.in("user_id", followingIds);
    const { data: candidates, error: candidatesError } = await candidatesQuery.limit(120);
    if (candidatesError) throw candidatesError;

    // `sidePreference` represents requester's side.
    // Partner should be complementary side (right <-> left), with `both` always compatible.
    const desiredPartnerSide = sidePreference === "right" ? "left" : "right";
    const compatible = (candidates || []).filter((c: any) => {
      if (!c.user_id || c.user_id === requester.user_id) return false;
      const pos = (c.court_position || "both") as string;
      return pos === "both" || pos === desiredPartnerSide;
    });

    const candidateIds = compatible.map((c: any) => c.id);
    const { data: alreadyPlayers } = candidateIds.length
      ? await admin
          .from("players")
          .select("player_account_id")
          .eq("tournament_id", tournamentId)
          .in("player_account_id", candidateIds)
      : { data: [] as any[] };
    const busySet = new Set((alreadyPlayers || []).map((p: any) => p.player_account_id));
    const finalCandidates = compatible.filter((c: any) => !busySet.has(c.id)).slice(0, 10);

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

    const inviteRows = finalCandidates.map((c: any) => ({
      request_id: requestRow.id,
      tournament_id: tournamentId,
      category_id: effectiveCategoryId,
      requester_user_id: requester.user_id,
      requester_player_account_id: requester.id,
      invitee_user_id: c.user_id,
      invitee_player_account_id: c.id,
    }));
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

