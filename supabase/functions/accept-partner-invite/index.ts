import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) throw new Error("Missing auth token");

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: authData } = await admin.auth.getUser(token);
    const userId = authData.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const { inviteId } = await req.json();
    if (!inviteId) throw new Error("Missing inviteId");

    const { data: invite, error: inviteError } = await admin
      .from("partner_match_invites")
      .select(`
        *,
        request:partner_match_requests(*),
        tournament:tournaments(id, name, registration_fee, user_id, registration_redirect_url),
        category:tournament_categories(id, name, registration_fee)
      `)
      .eq("id", inviteId)
      .maybeSingle();
    if (inviteError || !invite) throw new Error("Invite not found");
    if (invite.invitee_user_id !== userId) throw new Error("Forbidden");
    if (invite.status !== "pending") throw new Error("Invite is not pending");
    if (new Date(invite.expires_at).getTime() < Date.now()) throw new Error("Invite expired");

    const requesterId = invite.requester_player_account_id;
    const inviteeId = invite.invitee_player_account_id;
    const tournamentId = invite.tournament_id;
    const categoryId = invite.category_id;

    const { data: existingPlayers } = await admin
      .from("players")
      .select("id, player_account_id")
      .eq("tournament_id", tournamentId)
      .in("player_account_id", [requesterId, inviteeId]);
    if ((existingPlayers || []).length > 0) throw new Error("One of players is already registered");

    const { data: requesterAccount } = await admin
      .from("player_accounts")
      .select("id, name, email, phone_number")
      .eq("id", requesterId)
      .maybeSingle();
    const { data: inviteeAccount } = await admin
      .from("player_accounts")
      .select("id, name, email, phone_number")
      .eq("id", inviteeId)
      .maybeSingle();
    if (!requesterAccount || !inviteeAccount) throw new Error("Player account not found");

    const { data: p1, error: p1Err } = await admin
      .from("players")
      .insert({
        tournament_id: tournamentId,
        category_id: categoryId,
        player_account_id: requesterId,
        user_id: invite.requester_user_id,
        name: requesterAccount.name,
        phone_number: requesterAccount.phone_number || "",
      })
      .select("id")
      .single();
    if (p1Err || !p1) throw p1Err || new Error("Failed creating player 1");

    const { data: p2, error: p2Err } = await admin
      .from("players")
      .insert({
        tournament_id: tournamentId,
        category_id: categoryId,
        player_account_id: inviteeId,
        user_id: invite.invitee_user_id,
        name: inviteeAccount.name,
        phone_number: inviteeAccount.phone_number || "",
      })
      .select("id")
      .single();
    if (p2Err || !p2) throw p2Err || new Error("Failed creating player 2");

    const teamName = `${requesterAccount.name} / ${inviteeAccount.name}`;
    const { data: team, error: teamError } = await admin
      .from("teams")
      .insert({
        tournament_id: tournamentId,
        category_id: categoryId,
        name: teamName,
        player1_id: p1.id,
        player2_id: p2.id,
      })
      .select("id")
      .single();
    if (teamError || !team) throw teamError || new Error("Failed creating team");

    await admin
      .from("partner_match_invites")
      .update({ status: "accepted", accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", inviteId);
    await admin
      .from("partner_match_invites")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("request_id", invite.request_id)
      .eq("status", "pending")
      .neq("id", inviteId);
    await admin
      .from("partner_match_requests")
      .update({ status: "matched", updated_at: new Date().toISOString() })
      .eq("id", invite.request_id);

    const categoryFee = invite.category?.registration_fee;
    const tournamentFee = invite.tournament?.registration_fee;
    const effectiveFee = categoryFee != null ? Number(categoryFee) : Number(tournamentFee || 0);

    let checkoutUrl: string | null = null;
    if (effectiveFee > 0) {
      const checkoutResp = await fetch(`${supabaseUrl}/functions/v1/create-checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: anonKey || serviceKey,
        },
        body: JSON.stringify({
          tournamentId,
          categoryId,
          isIndividual: false,
          teamName,
          player1: {
            name: requesterAccount.name,
            email: requesterAccount.email || `${requesterAccount.id}@padel1.app`,
            phone: requesterAccount.phone_number || "",
          },
          player2: {
            name: inviteeAccount.name,
            email: inviteeAccount.email || `${inviteeAccount.id}@padel1.app`,
            phone: inviteeAccount.phone_number || "",
          },
          organizerUserId: invite.tournament?.user_id,
        }),
      });
      if (checkoutResp.ok) {
        const checkoutJson = await checkoutResp.json();
        checkoutUrl = checkoutJson?.url || null;
      }
    }

    const urlSuffix = checkoutUrl ? `?checkout=${encodeURIComponent(checkoutUrl)}` : "";
    for (const target of [
      { playerAccountId: requesterId, userId: invite.requester_user_id as string | null },
      { playerAccountId: inviteeId, userId: invite.invitee_user_id as string | null },
    ]) {
      const payload = {
        title: "Dupla confirmada",
        body: `A equipa ${teamName} foi inscrita em ${invite.tournament?.name || "torneio"}.`,
        url: `/?screen=compete&tournament=${tournamentId}${urlSuffix}`,
        tag: `partner-confirmed-${invite.request_id}`,
      };

      const byUserResp = target.userId
        ? await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceKey}`,
              apikey: anonKey || serviceKey,
            },
            body: JSON.stringify({ userId: target.userId, payload }),
          }).catch(() => null)
        : null;

      const byUserSent = byUserResp?.ok
        ? ((await byUserResp.json().catch(() => ({ sentCount: 0 })))?.sentCount ?? 0)
        : 0;

      if (byUserSent > 0) continue;

      await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: anonKey || serviceKey,
        },
        body: JSON.stringify({
          playerAccountId: target.playerAccountId,
          payload,
        }),
      }).catch(() => undefined);
    }

    return new Response(JSON.stringify({ success: true, teamId: team.id, checkoutUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

