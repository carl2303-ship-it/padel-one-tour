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

    console.log('[DEBUG] Looking up phone:', normalizedPhone);
    console.log('[DEBUG] Phone length:', normalizedPhone.length);
    console.log('[DEBUG] Phone char codes:', [...normalizedPhone].map(c => c.charCodeAt(0)));

    const { data: playerAccount, error: accountError } = await supabaseAdmin
      .from('player_accounts')
      .select('user_id, phone_number, email')
      .eq('phone_number', normalizedPhone)
      .maybeSingle();

    console.log('[DEBUG] Query result - playerAccount:', JSON.stringify(playerAccount));
    console.log('[DEBUG] Query result - accountError:', JSON.stringify(accountError));

    if (accountError || !playerAccount) {
      const { data: allAccounts } = await supabaseAdmin
        .from('player_accounts')
        .select('phone_number')
        .ilike('phone_number', '%' + normalizedPhone.slice(-9) + '%');
      console.log('[DEBUG] Similar accounts found:', JSON.stringify(allAccounts));

      return new Response(
        JSON.stringify({ error: 'Player account not found', debug: { normalizedPhone, accountError } }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let playerEmail = playerAccount.email;

    if (!playerEmail) {
      const phoneDigits = normalizedPhone.replace(/[^\d]/g, '');
      playerEmail = `${phoneDigits}@boostpadel.app`;

      console.log('[DEBUG] No email found, generated:', playerEmail);

      await supabaseAdmin
        .from('player_accounts')
        .update({ email: playerEmail })
        .eq('phone_number', normalizedPhone);

      console.log('[DEBUG] Updated player_account with generated email');
    }

    if (!playerAccount.user_id) {
      console.log('[DEBUG] Player account has no user_id, creating auth user...');

      const last4Digits = normalizedPhone.slice(-4);
      const defaultPassword = `Player${last4Digits}!`;

      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: playerEmail,
        password: defaultPassword,
        email_confirm: true,
        user_metadata: {
          display_name: playerAccount.name || 'Player',
          phone_number: normalizedPhone,
        },
      });

      if (createError) {
        console.error('[DEBUG] Error creating auth user:', createError);
        return new Response(
          JSON.stringify({ error: 'Could not create auth user', details: createError.message }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      if (newUser?.user?.id) {
        await supabaseAdmin
          .from('player_accounts')
          .update({ user_id: newUser.user.id })
          .eq('id', playerAccount.id);

        await supabaseAdmin
          .from('user_logo_settings')
          .upsert({ user_id: newUser.user.id, role: 'player', logo_url: null });

        console.log('[DEBUG] Created auth user and updated player_account with user_id:', newUser.user.id);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        email: playerEmail,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in get-player-login-email:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});