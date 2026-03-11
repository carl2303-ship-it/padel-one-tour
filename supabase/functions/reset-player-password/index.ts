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

    console.log('[DEBUG] Input phone:', phone_number);
    console.log('[DEBUG] Normalized phone:', normalizedPhone);

    // Get the player account - INCLUDE id in select!
    let { data: playerAccount, error: accountError } = await supabaseAdmin
      .from('player_accounts')
      .select('id, user_id, email, phone_number, name')
      .eq('phone_number', normalizedPhone)
      .maybeSingle();

    console.log('[DEBUG] Exact match result:', JSON.stringify(playerAccount));

    // If not found, try without the + sign
    if (!playerAccount) {
      const phoneWithoutPlus = normalizedPhone.replace('+', '');
      console.log('[DEBUG] Trying without +:', phoneWithoutPlus);
      const { data: accountWithoutPlus } = await supabaseAdmin
        .from('player_accounts')
        .select('id, user_id, email, phone_number, name')
        .eq('phone_number', phoneWithoutPlus)
        .maybeSingle();
      
      if (accountWithoutPlus) {
        playerAccount = accountWithoutPlus;
        accountError = null;
        console.log('[DEBUG] Found account without +:', JSON.stringify(accountWithoutPlus));
      }
    }

    // If still not found, try with just the last 9 digits (Portuguese mobile format)
    if (!playerAccount) {
      const last9Digits = normalizedPhone.slice(-9);
      console.log('[DEBUG] Trying last 9 digits:', last9Digits);
      const { data: accountLast9 } = await supabaseAdmin
        .from('player_accounts')
        .select('id, user_id, email, phone_number, name')
        .or(`phone_number.eq.+351${last9Digits},phone_number.eq.${last9Digits},phone_number.ilike.%${last9Digits}`)
        .maybeSingle();
      
      if (accountLast9) {
        playerAccount = accountLast9;
        accountError = null;
        console.log('[DEBUG] Found account with last 9 digits:', JSON.stringify(accountLast9));
      }
    }

    if (!playerAccount) {
      return new Response(
        JSON.stringify({ 
          error: 'Player account not found', 
          debug: { 
            normalizedPhone, 
            searchedVariations: [normalizedPhone, normalizedPhone.replace('+', ''), normalizedPhone.slice(-9)] 
          } 
        }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log('[DEBUG] Found player_account id:', playerAccount.id);
    console.log('[DEBUG] Found player_account user_id:', playerAccount.user_id);
    console.log('[DEBUG] Found player_account email:', playerAccount.email);
    console.log('[DEBUG] Found player_account phone:', playerAccount.phone_number);

    if (!playerAccount.user_id) {
      return new Response(
        JSON.stringify({ 
          error: 'Player account has no user_id. The player needs to login first to create their auth account.',
          hint: 'Tell the player to try logging in first with their phone number. The system will create their account automatically.'
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Get the auth user to verify it exists and get the actual email
    const { data: authUser, error: userError } = await supabaseAdmin.auth.admin.getUserById(
      playerAccount.user_id
    );

    if (userError || !authUser?.user) {
      console.error('[DEBUG] Auth user not found:', userError);
      return new Response(
        JSON.stringify({ 
          error: 'User not found in auth system',
          hint: 'The auth user may have been deleted. Tell the player to try logging in first.',
          details: userError?.message
        }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const authEmail = authUser.user.email;
    console.log('[DEBUG] Auth user email:', authEmail);
    console.log('[DEBUG] Player account email:', playerAccount.email);

    // Sync email between player_accounts and auth if needed
    if (authEmail && playerAccount.email !== authEmail) {
      console.log('[DEBUG] Syncing email: player_accounts had', playerAccount.email, '-> updating to', authEmail);
      await supabaseAdmin
        .from('player_accounts')
        .update({ email: authEmail })
        .eq('id', playerAccount.id);
    }

    // Generate the standard password using the actual phone number from the database
    const accountPhone = playerAccount.phone_number || normalizedPhone;
    const last4Digits = accountPhone.replace(/[^\d]/g, '').slice(-4);
    const standardPassword = `Player${last4Digits}!`;
    
    console.log('[DEBUG] Account phone:', accountPhone);
    console.log('[DEBUG] Last 4 digits:', last4Digits);
    console.log('[DEBUG] Generated password:', standardPassword);
    console.log('[DEBUG] User ID:', playerAccount.user_id);

    // Update the user's password using admin client
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      playerAccount.user_id,
      { password: standardPassword }
    );

    if (updateError) {
      console.error('[DEBUG] Error updating password:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update password', details: updateError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log('[DEBUG] Password updated successfully');
    
    // Double-check: verify that signInWithPassword would work
    // by confirming the email matches
    const finalEmail = authEmail || playerAccount.email;
    console.log('[DEBUG] Login should use email:', finalEmail);
    console.log('[DEBUG] Login should use password:', standardPassword);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Password reset successfully',
        phone_number: accountPhone,
        email: finalEmail,
        password: standardPassword,
        last4Digits: last4Digits,
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
