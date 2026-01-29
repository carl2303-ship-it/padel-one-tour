import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface RequestBody {
  phone_number: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { phone_number }: RequestBody = await req.json();

    if (!phone_number) {
      return new Response(
        JSON.stringify({ error: 'phone_number is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let normalizedPhone = phone_number.replace(/[\s\-\(\)\.]/g, '');

    if (!normalizedPhone.startsWith('+')) {
      if (normalizedPhone.startsWith('00')) {
        normalizedPhone = '+' + normalizedPhone.substring(2);
      } else if (normalizedPhone.startsWith('9') && normalizedPhone.length === 9) {
        normalizedPhone = '+351' + normalizedPhone;
      } else if (normalizedPhone.startsWith('351')) {
        normalizedPhone = '+' + normalizedPhone;
      } else {
        normalizedPhone = '+' + normalizedPhone;
      }
    }

    // Get the player account
    const { data: playerAccount, error: accountError } = await supabaseAdmin
      .from('player_accounts')
      .select('user_id, email, phone_number')
      .eq('phone_number', normalizedPhone)
      .maybeSingle();

    if (accountError || !playerAccount) {
      return new Response(
        JSON.stringify({ error: 'Player account not found' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!playerAccount.user_id) {
      return new Response(
        JSON.stringify({ error: 'Player account has no user_id' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Generate the standard password
    const standardPassword = `Player${normalizedPhone.slice(-4)}!`;

    // Update the user's password using admin client
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      playerAccount.user_id,
      { password: standardPassword }
    );

    if (updateError) {
      console.error('Error updating password:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update password', details: updateError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Password reset successfully',
        phone_number: normalizedPhone,
        password: standardPassword,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in reset-player-password:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});