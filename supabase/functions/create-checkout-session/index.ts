import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { tournamentId, categoryId, isIndividual, teamName, player1, player2, organizerUserId } = await req.json();

    if (!tournamentId || !organizerUserId) {
      throw new Error("Missing required fields");
    }

    if (!isIndividual && (!teamName || !player2)) {
      throw new Error("Team registrations require team name and two players");
    }

    const { data: stripeSettings } = await supabaseClient
      .from("user_stripe_settings")
      .select("secret_key")
      .eq("user_id", organizerUserId)
      .maybeSingle();

    if (!stripeSettings?.secret_key) {
      throw new Error("Tournament organizer has not configured Stripe");
    }

    let amount = 0;
    let description = isIndividual ? player1.name : teamName;

    const { data: tournament } = await supabaseClient
      .from("tournaments")
      .select("registration_fee, name, registration_redirect_url")
      .eq("id", tournamentId)
      .maybeSingle();

    if (!tournament) {
      throw new Error("Tournament not found");
    }

    let effectiveFee = tournament.registration_fee;
    let categoryName = tournament.name;

    if (categoryId) {
      const { data: category } = await supabaseClient
        .from("tournament_categories")
        .select("registration_fee, name")
        .eq("id", categoryId)
        .maybeSingle();

      if (category) {
        if (category.registration_fee !== undefined && category.registration_fee !== null) {
          effectiveFee = category.registration_fee;
        }
        categoryName = category.name;
      }
    }

    if (effectiveFee && Number(effectiveFee) > 0) {
      amount = Math.round(Number(effectiveFee) * 100);
      description = isIndividual ? `${player1.name} - ${categoryName}` : `${teamName} - ${categoryName}`;
    }

    if (amount === 0) {
      return new Response(
        JSON.stringify({ 
          success: true,
          freeRegistration: true,
          message: "No payment required" 
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const stripe = (await import("npm:stripe@14")).default(stripeSettings.secret_key);

    const origin = req.headers.get("origin") || "http://localhost:5173";
    const redirectUrl = tournament.registration_redirect_url || origin;

    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Tournament Registration",
              description: description,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${redirectUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${redirectUrl}?payment=cancelled`,
      metadata: {
        tournamentId,
        categoryId: categoryId || "",
        isIndividual: isIndividual ? "true" : "false",
        teamName: teamName || "",
        player1Name: player1.name,
        player1Email: player1.email,
        player1Phone: player1.phone || "",
        player2Name: player2?.name || "",
        player2Email: player2?.email || "",
        player2Phone: player2?.phone || "",
        organizerUserId,
      },
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        sessionId: session.id,
        url: session.url 
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});