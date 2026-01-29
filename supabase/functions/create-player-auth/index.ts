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
    const { email, password, phone_number, name } = await req.json();

    if (!email || !password || !phone_number || !name) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { data: existingAccount } = await supabaseAdmin
      .from("player_accounts")
      .select("*")
      .eq("phone_number", phone_number)
      .maybeSingle();

    if (existingAccount) {
      return new Response(
        JSON.stringify({
          success: true,
          account: existingAccount,
          isNew: false,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: existingUser } = await supabaseAdmin.auth.admin.listUsers();
    const userWithEmail = existingUser?.users?.find((u) => u.email === email);

    let userId: string | null = null;

    if (userWithEmail) {
      userId = userWithEmail.id;
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        phone: phone_number,
        user_metadata: {
          display_name: name,
          phone_number: phone_number,
        },
      });
    } else {
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        phone: phone_number,
        email_confirm: true,
        user_metadata: {
          display_name: name,
          phone_number: phone_number,
        },
      });

      if (createError) {
        return new Response(
          JSON.stringify({ success: false, error: createError.message }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      userId = newUser?.user?.id || null;
    }

    const { data: newAccount, error: accountError } = await supabaseAdmin
      .from("player_accounts")
      .insert({
        phone_number,
        user_id: userId,
        name,
        email: email.includes("@temp.player.com") ? null : email,
      })
      .select()
      .single();

    if (accountError) {
      return new Response(
        JSON.stringify({ success: false, error: accountError.message }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (userId) {
      const { data: existingRole } = await supabaseAdmin
        .from("user_logo_settings")
        .select("id, role")
        .eq("user_id", userId)
        .maybeSingle();

      if (!existingRole) {
        await supabaseAdmin
          .from("user_logo_settings")
          .insert({ user_id: userId, role: "player", logo_url: null });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        account: newAccount,
        isNew: true,
        userId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
