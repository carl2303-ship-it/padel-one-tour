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
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) throw new Error("Missing auth token");

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: authData } = await admin.auth.getUser(token);
    const userId = authData.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const { inviteId } = await req.json();
    if (!inviteId) throw new Error("Missing inviteId");

    const { data: invite } = await admin
      .from("partner_match_invites")
      .select("id, tournament_id, requester_user_id, invitee_user_id, invitee_player_account_id, status, tournament:tournaments(name)")
      .eq("id", inviteId)
      .maybeSingle();
    if (!invite) throw new Error("Invite not found");
    const { data: inviteePa } = await admin
      .from("player_accounts")
      .select("user_id")
      .eq("id", invite.invitee_player_account_id)
      .maybeSingle();
    const inviteeOwnerId = inviteePa?.user_id as string | undefined;
    if (inviteeOwnerId !== userId && invite.invitee_user_id !== userId) {
      throw new Error("Forbidden");
    }
    if (invite.status !== "pending") throw new Error("Invite is not pending");

    const { data: declined, error } = await admin
      .from("partner_match_invites")
      .update({
        status: "declined",
        declined_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", inviteId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!declined) throw new Error("Invite is no longer pending");

    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    if (vapidPublicKey && vapidPrivateKey) {
      await deliverWebPushNotifications(admin, {
        vapidPublicKey,
        vapidPrivateKey,
        userId: invite.requester_user_id,
        appSource: "player",
        payload: {
          title: "Convite recusado",
          body: `O jogador convidado recusou o convite para ${invite.tournament?.name || "o torneio"}.`,
          url: `/?screen=compete&tournament=${invite.tournament_id}`,
          tag: `partner-declined-${invite.id}`,
        },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

