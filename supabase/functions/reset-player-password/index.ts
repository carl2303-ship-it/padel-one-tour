import { createClient } from 'npm:@supabase/supabase-js@2';
import { normalizePhone } from '../_shared/phoneUtils.ts';
import { isProtectedAuthUser } from '../_shared/protectedAuthUsers.ts';

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

    // ── Autenticação: organizador, dono de clube ou super-admin ───────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
    const callerId = callerData?.user?.id;

    if (callerError || !callerId) {
      return new Response(
        JSON.stringify({ error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const [{ data: organizerRow }, { data: clubRow }, { data: superAdminRow }] = await Promise.all([
      supabaseAdmin.from('organizers').select('id').eq('user_id', callerId).maybeSingle(),
      supabaseAdmin.from('clubs').select('id').eq('owner_id', callerId).maybeSingle(),
      supabaseAdmin.from('super_admins').select('id').eq('user_id', callerId).maybeSingle(),
    ]);

    const isSuperAdmin = !!superAdminRow;
    const canReset = isSuperAdmin || !!organizerRow || !!clubRow;

    if (!canReset) {
      return new Response(
        JSON.stringify({ error: 'Only organizers, club owners or super-admins can reset player passwords' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

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

    const normalizedPhone = normalizePhone(phone_number);

    console.log('[DEBUG] Input phone:', phone_number);
    console.log('[DEBUG] Normalized phone:', normalizedPhone);
    console.log('[DEBUG] Caller:', callerId, { isSuperAdmin, organizer: !!organizerRow, club: !!clubRow });

    let { data: playerAccount, error: accountError } = await supabaseAdmin
      .from('player_accounts')
      .select('id, user_id, email, phone_number, name')
      .eq('phone_number', normalizedPhone)
      .maybeSingle();

    console.log('[DEBUG] Exact match result:', JSON.stringify(playerAccount));

    if (!playerAccount) {
      const last9Digits = normalizedPhone.slice(-9);
      console.log('[DEBUG] Trying last 9 digits fallback:', last9Digits);
      const { data: accountLast9 } = await supabaseAdmin
        .from('player_accounts')
        .select('id, user_id, email, phone_number, name')
        .ilike('phone_number', `%${last9Digits}`)
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
          debug: { normalizedPhone },
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

    // Super-admins can reset any player. Others must own the contact/registration.
    if (!isSuperAdmin) {
      const phoneVariants = Array.from(
        new Set(
          [playerAccount.phone_number, normalizedPhone, phone_number]
            .filter(Boolean)
            .map((p) => String(p)),
        ),
      );
      const last9 = normalizedPhone.slice(-9);

      const [{ data: ownContact }, { data: ownRegistration }, { data: ownByPhone }] =
        await Promise.all([
          supabaseAdmin
            .from('organizer_players')
            .select('id')
            .eq('organizer_id', callerId)
            .in('phone_number', phoneVariants)
            .limit(1)
            .maybeSingle(),
          supabaseAdmin
            .from('players')
            .select('id, tournaments!inner(user_id)')
            .eq('player_account_id', playerAccount.id)
            .eq('tournaments.user_id', callerId)
            .limit(1)
            .maybeSingle(),
          supabaseAdmin
            .from('players')
            .select('id, tournaments!inner(user_id)')
            .eq('tournaments.user_id', callerId)
            .or(
              phoneVariants
                .map((p) => `phone_number.eq.${p}`)
                .concat(last9 ? [`phone_number.ilike.%${last9}`] : [])
                .join(','),
            )
            .limit(1)
            .maybeSingle(),
        ]);

      if (!ownContact && !ownRegistration && !ownByPhone) {
        console.log('[DEBUG] Ownership check failed for caller', callerId);
        return new Response(
          JSON.stringify({
            error:
              'Este jogador não está ligado à sua conta de organizador (contacto ou inscrição num torneio seu).',
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    } else {
      console.log('[DEBUG] Super-admin bypass ownership check');
    }

    if (!playerAccount.user_id) {
      return new Response(
        JSON.stringify({
          error: 'Player account has no user_id. The player needs to login first to create their auth account.',
          hint: 'Tell the player to try logging in first with their phone number. The system will create their account automatically.',
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
          details: userError?.message,
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

    // Never reset passwords for club owners / organizers / super-admins.
    // Mis-linked player_accounts would otherwise overwrite the organizer login.
    const protection = await isProtectedAuthUser(supabaseAdmin, playerAccount.user_id);
    if (protection.protected) {
      console.error('[DEBUG] Refusing password reset for protected auth user:', protection.reason);
      await supabaseAdmin
        .from('player_accounts')
        .update({ user_id: null })
        .eq('id', playerAccount.id);

      return new Response(
        JSON.stringify({
          error: 'Player account was incorrectly linked to an organizer/club owner account. Link cleared — ask the player to log in again to create a separate auth user.',
          reason: protection.reason,
          hint: 'Do not reuse club-owner emails for player accounts.',
        }),
        {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

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

    const finalEmail = authEmail || playerAccount.email;
    console.log('[DEBUG] Login should use email:', finalEmail);

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
