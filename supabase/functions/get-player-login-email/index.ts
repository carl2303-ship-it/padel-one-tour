import { createClient } from 'npm:@supabase/supabase-js@2';
import { normalizePhone, phoneLookupCandidates, normalizePhoneKey } from '../_shared/phoneUtils.ts';
import { findPlayerAccountUsingAuthUser, isProtectedAuthUser } from '../_shared/protectedAuthUsers.ts';

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

    const normalizedPhone = normalizePhone(phone_number);
    const candidates = phoneLookupCandidates(phone_number);

    console.log('[DEBUG] Input phone:', phone_number);
    console.log('[DEBUG] Normalized phone:', normalizedPhone);
    console.log('[DEBUG] Candidates:', candidates);

    let playerAccount: {
      id: string;
      user_id: string | null;
      phone_number: string | null;
      email: string | null;
      name: string | null;
    } | null = null;
    let accountError: { message?: string } | null = null;

    for (const candidate of candidates) {
      const { data, error } = await supabaseAdmin
        .from('player_accounts')
        .select('id, user_id, phone_number, email, name')
        .eq('phone_number', candidate)
        .maybeSingle();
      accountError = error;
      if (data) {
        playerAccount = data;
        console.log('[DEBUG] Exact match via candidate', candidate, JSON.stringify(data));
        break;
      }
    }

    if (!playerAccount) {
      const key = normalizePhoneKey(phone_number);
      const last9Digits = (key || normalizedPhone || phone_number).replace(/\D/g, '').slice(-9);
      console.log('[DEBUG] Trying last 9 digits fallback:', last9Digits);
      if (last9Digits.length >= 9) {
        const { data: suffixMatches } = await supabaseAdmin
          .from('player_accounts')
          .select('id, user_id, phone_number, email, name')
          .ilike('phone_number', `%${last9Digits}`)
          .limit(20);

        const rows = suffixMatches || [];
        const byNational = rows.filter((r) => normalizePhoneKey(r.phone_number) === key);
        const pick = byNational[0] || rows[0] || null;
        if (pick) {
          playerAccount = pick;
          accountError = null;
          console.log('[DEBUG] Found account with last 9 digits:', JSON.stringify(pick));
        }
      }
    }

    if (!playerAccount) {
      return new Response(
        JSON.stringify({ 
          error: 'Player account not found', 
          debug: { normalizedPhone } 
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

    // Use the actual phone number from the database
    const accountPhone = playerAccount.phone_number || normalizedPhone;
    
    // PRIORITY: If user_id exists, ALWAYS get the email from auth.users
    // This is the email that will be used for signInWithPassword
    let playerEmail: string | null = null;

    if (playerAccount.user_id) {
      console.log('[DEBUG] Player has user_id, getting email from auth system...');

      const protection = await isProtectedAuthUser(supabaseAdmin, playerAccount.user_id);
      if (protection.protected) {
        console.error('[DEBUG] Clearing mis-linked protected auth user:', protection.reason);
        await supabaseAdmin
          .from('player_accounts')
          .update({ user_id: null })
          .eq('id', playerAccount.id);
        playerAccount.user_id = null;
        // Keep player_accounts.email only if it is not the organizer email
        playerEmail = playerAccount.email;
      } else {
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(
          playerAccount.user_id
        );

        if (authUser?.user?.email) {
          playerEmail = authUser.user.email;
          console.log('[DEBUG] Got email from auth.users:', playerEmail);

          // Sync email to player_accounts if different
          if (playerAccount.email !== playerEmail) {
            console.log('[DEBUG] Syncing email to player_accounts (was:', playerAccount.email, ', now:', playerEmail, ')');
            await supabaseAdmin
              .from('player_accounts')
              .update({ email: playerEmail })
              .eq('id', playerAccount.id);
          }
        } else {
          console.log('[DEBUG] Auth user not found or has no email:', authError?.message);
          // Auth user might be deleted/corrupt - use player_accounts email or generate
          playerEmail = playerAccount.email;
        }
      }
    } else {
      // No user_id yet - use email from player_accounts
      playerEmail = playerAccount.email;
    }

    // If still no email, generate one
    if (!playerEmail) {
      const phoneDigits = accountPhone.replace(/[^\d]/g, '');
      playerEmail = `${phoneDigits}@boostpadel.app`;
      console.log('[DEBUG] Generated email:', playerEmail);

      await supabaseAdmin
        .from('player_accounts')
        .update({ email: playerEmail })
        .eq('id', playerAccount.id);
      
      console.log('[DEBUG] Updated player_account with generated email');
    }
    
    console.log('[DEBUG] Final email to return:', playerEmail);

    // If no user_id, create an auth user
    if (!playerAccount.user_id) {
      console.log('[DEBUG] Player account has no user_id, creating auth user...');

      const last4Digits = accountPhone.replace(/[^\d]/g, '').slice(-4);
      const defaultPassword = `Player${last4Digits}!`;

      console.log('[DEBUG] Account phone:', accountPhone);

      // Check if an auth user with this email already exists
      const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
      const existingUser = existingUsers?.users?.find(u => u.email === playerEmail);

      const existingProtection = existingUser
        ? await isProtectedAuthUser(supabaseAdmin, existingUser.id)
        : { protected: false };
      const existingOwner = existingUser
        ? await findPlayerAccountUsingAuthUser(
          supabaseAdmin,
          existingUser.id,
          playerAccount.id,
        )
        : null;

      if (existingUser && !existingProtection.protected && !existingOwner) {
        console.log('[DEBUG] Auth user already exists with this email:', existingUser.id);

        // Link the existing user
        await supabaseAdmin
          .from('player_accounts')
          .update({ user_id: existingUser.id })
          .eq('id', playerAccount.id);

        // Reset password to standard format
        await supabaseAdmin.auth.admin.updateUserById(
          existingUser.id,
          { password: defaultPassword }
        );

        console.log('[DEBUG] Linked existing auth user and reset password');
      } else {
        if (existingProtection.protected || existingOwner) {
          // Do not hijack club-owner emails or an auth user already tied to another player
          const phoneDigits = accountPhone.replace(/[^\d]/g, '');
          playerEmail = `${phoneDigits}@boostpadel.app`;
          console.log(
            '[DEBUG] Email/auth unavailable (protected=',
            !!existingProtection.protected,
            ' alreadyLinked=',
            existingOwner?.id || null,
            '), using generated email:',
            playerEmail,
          );
          await supabaseAdmin
            .from('player_accounts')
            .update({ email: playerEmail })
            .eq('id', playerAccount.id);
        }

        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: playerEmail,
          password: defaultPassword,
          email_confirm: true,
          user_metadata: {
            display_name: playerAccount.name || 'Player',
            phone_number: accountPhone,
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
            .upsert({ user_id: newUser.user.id, role: 'player', logo_url: null }, { onConflict: 'user_id' });

          console.log('[DEBUG] Created auth user:', newUser.user.id);
        }
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
