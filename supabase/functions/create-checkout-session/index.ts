import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizePhone } from "../_shared/phoneUtils.ts";

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
      .select("registration_fee, member_price, non_member_price, name, registration_redirect_url, club_id")
      .eq("id", tournamentId)
      .maybeSingle();

    if (!tournament) {
      throw new Error("Tournament not found");
    }

    let categoryName = tournament.name;
    let catRegFee = null;
    let catMemberPrice = null;
    let catNonMemberPrice = null;

    if (categoryId) {
      const { data: category } = await supabaseClient
        .from("tournament_categories")
        .select("registration_fee, member_price, non_member_price, name")
        .eq("id", categoryId)
        .maybeSingle();

      if (category) {
        catRegFee = category.registration_fee;
        catMemberPrice = category.member_price;
        catNonMemberPrice = category.non_member_price;
        categoryName = category.name;
      }
    }

    // Determine effective prices — category price 0 means "inherit from tournament"
    const mp = Number(catMemberPrice) || Number(tournament.member_price) || 0;
    const nmp = Number(catNonMemberPrice) || Number(tournament.non_member_price) || 0;
    const regFee = Number(catRegFee) || Number(tournament.registration_fee) || 0;

    // Check membership for each player to calculate per-player fee
    const checkIsMember = async (phone: string): Promise<boolean> => {
      if (!phone || !tournament.club_id) return false;
      const normalized = normalizePhone(phone);
      const { data: club } = await supabaseClient
        .from("clubs")
        .select("owner_id")
        .eq("id", tournament.club_id)
        .maybeSingle();
      if (!club) return false;
      const { data: membership } = await supabaseClient
        .from("member_subscriptions")
        .select("id")
        .eq("club_owner_id", club.owner_id)
        .eq("member_phone", normalized)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      return !!membership;
    };

    const getFeeForPlayer = (isMember: boolean): number => {
      if (isMember && mp) return mp;
      if (!isMember && nmp) return nmp;
      return nmp || mp || regFee || 0;
    };

    const p1Member = await checkIsMember(player1.phone);
    const p1Fee = getFeeForPlayer(p1Member);
    let totalFee = p1Fee;

    if (!isIndividual && player2?.phone) {
      const p2Member = await checkIsMember(player2.phone);
      const p2Fee = getFeeForPlayer(p2Member);
      totalFee += p2Fee;
    }

    if (totalFee > 0) {
      amount = Math.round(totalFee * 100);
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
    const defaultPlayerAppUrl = "https://padel1.app";
    const successRedirectUrl = tournament.registration_redirect_url || defaultPlayerAppUrl;

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
      success_url: `${successRedirectUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}?payment=cancelled`,
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