import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { deliverWebPushNotifications, type PushPayload } from "../_shared/deliverPush.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SendPushRequest {
  userId?: string;
  playerAccountId?: string;
  payload: PushPayload;
  appSource?: "tour" | "player" | "manager";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");

    if (!vapidPublicKey || !vapidPrivateKey) {
      console.log("VAPID keys not configured - push notifications disabled");
      return new Response(JSON.stringify({ success: true, message: "Push notifications not configured" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: SendPushRequest = await req.json();
    const { userId, playerAccountId, payload } = body;
    const appSource = body.appSource || "tour";

    if ((!userId && !playerAccountId) || !payload) {
      return new Response(JSON.stringify({ error: "userId or playerAccountId and payload are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { sentCount, totalSubscriptions } = await deliverWebPushNotifications(supabase, {
      vapidPublicKey,
      vapidPrivateKey,
      userId,
      playerAccountId,
      appSource,
      payload,
    });

    if (totalSubscriptions === 0) {
      return new Response(JSON.stringify({ success: true, message: "No subscriptions found", sentCount: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        sentCount,
        totalSubscriptions,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in send-push-notification:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
