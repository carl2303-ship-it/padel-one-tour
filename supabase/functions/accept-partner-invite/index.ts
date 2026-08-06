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
        id, request_id, tournament_id, requester_user_id, requester_player_account_id,
        invitee_user_id, invitee_player_account_id, status, expires_at,
        request:partner_match_requests(id, status),
        tournament:tournaments(id, name)
      `)
      .eq("id", inviteId)
      .maybeSingle();
    if (inviteError || !invite) throw new Error("Invite not found");
    const { data: inviteePa } = await admin
      .from("player_accounts")
      .select("user_id")
      .eq("id", invite.invitee_player_account_id)
      .maybeSingle();
    const inviteeOwnerId = inviteePa?.user_id as string | undefined;
    if (inviteeOwnerId !== userId && invite.invitee_user_id !== userId) {
      throw new Error("Forbidden");
    }
    if (invite.status === "accepted") {
      return new Response(JSON.stringify({
        success: true,
        status: "accepted",
        awaitingConfirmation: invite.request?.status === "open",
        confirmed: invite.request?.status === "matched",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (invite.status !== "pending") throw new Error("Invite is not pending");
    if (invite.request?.status !== "open") throw new Error("Partner request is not open");
    if (new Date(invite.expires_at).getTime() < Date.now()) throw new Error("Invite expired");

    const now = new Date().toISOString();
    const { data: accepted, error: acceptError } = await admin
      .from("partner_match_invites")
      .update({ status: "accepted", accepted_at: now, updated_at: now })
      .eq("id", inviteId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (acceptError) throw acceptError;
    if (!accepted) throw new Error("Invite is no longer pending");

    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    if (vapidPublicKey && vapidPrivateKey) {
      const tournamentName = invite.tournament?.name || "o torneio";
      await Promise.all([
        deliverWebPushNotifications(admin, {
          vapidPublicKey,
          vapidPrivateKey,
          userId: invite.requester_user_id,
          appSource: "player",
          payload: {
            title: "Parceiro aceitou",
            body: `O jogador convidado aceitou o convite para ${tournamentName}. Confirma agora a inscrição.`,
            url: `/?screen=compete&tournament=${invite.tournament_id}&partner_invite=${invite.id}`,
            tag: `partner-accepted-${invite.id}`,
          },
        }),
        deliverWebPushNotifications(admin, {
          vapidPublicKey,
          vapidPrivateKey,
          userId: inviteeOwnerId ?? invite.invitee_user_id,
          appSource: "player",
          payload: {
            title: "Convite aceite",
            body: `Aceitaste o convite para ${tournamentName}. Aguarda a confirmação do parceiro.`,
            url: `/?screen=compete&tournament=${invite.tournament_id}&partner_invite=${invite.id}`,
            tag: `partner-awaiting-confirmation-${invite.id}`,
          },
        }),
      ]);
    }

    return new Response(JSON.stringify({ success: true, status: "accepted", awaitingConfirmation: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

