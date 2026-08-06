import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { deliverWebPushNotifications } from "../_shared/deliverPush.ts";

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
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) throw new Error("Missing auth token");

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) throw new Error("Unauthorized");

    const { inviteId } = await req.json();
    if (!inviteId) throw new Error("Missing inviteId");

    const { data: invite, error: inviteError } = await admin
      .from("partner_match_invites")
      .select(`
        id, tournament_id, category_id, requester_user_id, requester_player_account_id,
        invitee_user_id, invitee_player_account_id, status,
        request:partner_match_requests(id, status),
        tournament:tournaments(id, name, user_id, registration_fee, member_price, non_member_price),
        category:tournament_categories(id, registration_fee, member_price, non_member_price)
      `)
      .eq("id", inviteId)
      .maybeSingle();
    if (inviteError || !invite) throw new Error("Invite not found");
    if (invite.requester_user_id !== authData.user.id) {
      throw new Error("Only the requester can confirm this invite");
    }

    const { data: accounts, error: accountsError } = await admin
      .from("player_accounts")
      .select("id, user_id, name, email, phone_number")
      .in("id", [invite.requester_player_account_id, invite.invitee_player_account_id]);
    if (accountsError) throw accountsError;
    const requester = (accounts || []).find((account) => account.id === invite.requester_player_account_id);
    const invitee = (accounts || []).find((account) => account.id === invite.invitee_player_account_id);
    if (!requester || !invitee) throw new Error("Player account not found");

    const { data: confirmation, error: confirmationError } = await admin.rpc(
      "confirm_partner_match_invite",
      {
        p_invite_id: inviteId,
        p_requester_user_id: authData.user.id,
      },
    );
    if (confirmationError) throw confirmationError;
    const teamId = Array.isArray(confirmation)
      ? confirmation[0]?.team_id
      : (confirmation as { team_id?: string } | null)?.team_id;
    if (!teamId) throw new Error("Confirmation did not return a team");

    const category = invite.category;
    const tournament = invite.tournament;
    const hasPaidPrice = [
      category?.registration_fee,
      category?.member_price,
      category?.non_member_price,
      tournament?.registration_fee,
      tournament?.member_price,
      tournament?.non_member_price,
    ].some((value) => Number(value || 0) > 0);

    let checkoutUrl: string | null = null;
    if (hasPaidPrice) {
      const checkoutResponse = await fetch(`${supabaseUrl}/functions/v1/create-checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: anonKey || serviceKey,
        },
        body: JSON.stringify({
          tournamentId: invite.tournament_id,
          categoryId: invite.category_id,
          isIndividual: false,
          teamName: `${requester.name} / ${invitee.name}`,
          player1: {
            name: requester.name,
            email: requester.email || `${requester.id}@padel1.app`,
            phone: requester.phone_number || "",
          },
          player2: {
            name: invitee.name,
            email: invitee.email || `${invitee.id}@padel1.app`,
            phone: invitee.phone_number || "",
          },
          organizerUserId: tournament?.user_id,
          existingTeamId: teamId,
          checkoutIdempotencyKey: `partner-invite-${inviteId}`,
        }),
      });
      const checkout = await checkoutResponse.json().catch(() => ({}));
      if (!checkoutResponse.ok || checkout?.success === false) {
        throw new Error(checkout?.error || "Failed to create checkout");
      }
      checkoutUrl = checkout?.url || null;
    }

    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    if (vapidPublicKey && vapidPrivateKey) {
      const urlSuffix = checkoutUrl ? `&checkout=${encodeURIComponent(checkoutUrl)}` : "";
      const payload = {
        title: "Inscrição confirmada",
        body: `A equipa ${requester.name} / ${invitee.name} foi inscrita em ${tournament?.name || "o torneio"}.`,
        url: `/?screen=compete&tournament=${invite.tournament_id}${urlSuffix}`,
        tag: `partner-confirmed-${inviteId}`,
      };
      await Promise.all([
        deliverWebPushNotifications(admin, {
          vapidPublicKey,
          vapidPrivateKey,
          userId: invite.requester_user_id,
          appSource: "player",
          payload,
        }),
        deliverWebPushNotifications(admin, {
          vapidPublicKey,
          vapidPrivateKey,
          userId: invitee.user_id || invite.invitee_user_id,
          appSource: "player",
          payload,
        }),
      ]);
    }

    return new Response(JSON.stringify({ success: true, teamId, checkoutUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
