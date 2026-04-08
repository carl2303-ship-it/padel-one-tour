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
      .select("id, invitee_user_id, status")
      .eq("id", inviteId)
      .maybeSingle();
    if (!invite) throw new Error("Invite not found");
    if (invite.invitee_user_id !== userId) throw new Error("Forbidden");
    if (invite.status !== "pending") throw new Error("Invite is not pending");

    const { error } = await admin
      .from("partner_match_invites")
      .update({
        status: "declined",
        declined_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", inviteId);
    if (error) throw error;

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

