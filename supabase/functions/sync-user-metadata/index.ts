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

    const { data: accounts, error: accountsError } = await supabaseAdmin
      .from("player_accounts")
      .select("user_id, phone_number, name")
      .not("user_id", "is", null);

    if (accountsError) {
      throw new Error(accountsError.message);
    }

    const uniqueUsers = new Map<string, { phone_number: string; name: string }>();
    for (const account of accounts || []) {
      if (!uniqueUsers.has(account.user_id)) {
        uniqueUsers.set(account.user_id, {
          phone_number: account.phone_number,
          name: account.name,
        });
      }
    }

    let updated = 0;
    let errors = 0;

    for (const [userId, data] of uniqueUsers) {
      try {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
          phone: data.phone_number,
          user_metadata: {
            display_name: data.name,
            phone_number: data.phone_number,
          },
        });

        if (error) {
          console.error(`Error updating user ${userId}:`, error.message);
          errors++;
        } else {
          updated++;
        }
      } catch (e) {
        console.error(`Exception updating user ${userId}:`, e.message);
        errors++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        totalAccounts: accounts?.length || 0,
        uniqueUsers: uniqueUsers.size,
        updated,
        errors,
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
