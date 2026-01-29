import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface UpdateEmailRequest {
  userId: string;
  newEmail: string;
  phoneNumber: string;
  playerName?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization header required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: requestingUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !requestingUser) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: UpdateEmailRequest = await req.json();
    const { userId, newEmail, phoneNumber, playerName } = body;

    if (!userId || !newEmail || !phoneNumber) {
      return new Response(
        JSON.stringify({ error: 'userId, newEmail, and phoneNumber are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (requestingUser.id !== userId) {
      return new Response(
        JSON.stringify({ error: 'You can only update your own email' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: updateData, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { email: newEmail, email_confirm: true }
    );

    if (updateError) {
      console.error('Error updating user email:', updateError);
      return new Response(
        JSON.stringify({ error: updateError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: normalizedResult } = await supabaseAdmin
      .rpc('normalize_portuguese_phone', { phone: phoneNumber });

    const normalizedPhone = normalizedResult || phoneNumber.replace(/\s+/g, '');

    console.log('Updating player_accounts with phone:', normalizedPhone, 'to email:', newEmail);

    const { data: updatePlayerData, error: playerAccountError } = await supabaseAdmin
      .from('player_accounts')
      .update({ email: newEmail })
      .eq('phone_number', normalizedPhone)
      .select();

    if (playerAccountError) {
      console.error('Error updating player_accounts email:', playerAccountError);
    } else if (!updatePlayerData || updatePlayerData.length === 0) {
      console.warn('No player_account found with phone:', normalizedPhone);
    } else {
      console.log('Successfully updated player_account:', updatePlayerData[0].id);
    }

    if (resendApiKey) {
      const standardPassword = `Player${normalizedPhone.slice(-4)}!`;
      const appUrl = Deno.env.get('APP_URL') || 'https://boostpadel.store';
      const displayName = playerName || 'Jogador';

      const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Padel App - Instrucoes de Instalacao</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">Padel App</h1>
              <p style="margin: 10px 0 0; color: #bfdbfe; font-size: 16px;">Instrucoes de Acesso</p>
            </td>
          </tr>
          
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px; color: #1f2937; font-size: 22px; font-weight: 600;">Ola ${displayName}!</h2>
              
              <p style="margin: 0 0 20px; color: #4b5563; font-size: 16px; line-height: 1.6;">
                O seu email foi atualizado com sucesso. Utilize as credenciais abaixo para aceder a aplicacao:
              </p>
              
              <div style="background-color: #f9fafb; border: 2px solid #e5e7eb; border-radius: 8px; padding: 24px; margin: 0 0 30px;">
                <div style="margin-bottom: 16px;">
                  <p style="margin: 0 0 6px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Numero de Telefone</p>
                  <p style="margin: 0; color: #1f2937; font-size: 18px; font-weight: 600; font-family: 'Courier New', monospace;">${normalizedPhone}</p>
                </div>
                <div>
                  <p style="margin: 0 0 6px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Password</p>
                  <p style="margin: 0; color: #1f2937; font-size: 18px; font-weight: 600; font-family: 'Courier New', monospace;">${standardPassword}</p>
                </div>
              </div>
              
              <div style="border-top: 1px solid #e5e7eb; margin: 30px 0;"></div>
              
              <h3 style="margin: 0 0 15px; color: #1f2937; font-size: 18px; font-weight: 600;">Aceda a Aplicacao</h3>
              
              <table role="presentation" style="margin: 0 0 30px;">
                <tr>
                  <td>
                    <a href="${appUrl}" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Abrir Aplicacao</a>
                  </td>
                </tr>
              </table>
              
              <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin: 0 0 20px;">
                <h4 style="margin: 0 0 15px; color: #1f2937; font-size: 16px; font-weight: 600;">Instale no seu telemovel</h4>
                
                <p style="margin: 0 0 12px; color: #4b5563; font-size: 14px; line-height: 1.6;">
                  <strong style="color: #1f2937;">iPhone/iPad (Safari):</strong><br>
                  1. Abra o link acima no Safari<br>
                  2. Toque no botao de partilha (quadrado com seta para cima)<br>
                  3. Escolha "Adicionar ao Ecra Principal"<br>
                  4. Faca login com modo "Jogador" usando as credenciais acima
                </p>
                
                <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.6;">
                  <strong style="color: #1f2937;">Android (Chrome):</strong><br>
                  1. Abra o link acima no Chrome<br>
                  2. Toque no menu (tres pontos)<br>
                  3. Escolha "Instalar aplicacao" ou "Adicionar ao ecra inicial"<br>
                  4. Faca login com modo "Jogador" usando as credenciais acima
                </p>
              </div>
              
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 4px; margin: 0 0 20px;">
                <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.6;">
                  <strong>Importante:</strong> Ao fazer login, escolha o modo <strong>"Jogador"</strong> e utilize o seu numero de telefone e password fornecidos acima.
                </p>
              </div>
              
              <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                Se tiver alguma duvida ou precisar de redefinir a sua password, contacte o organizador do torneio.
              </p>
            </td>
          </tr>
          
          <tr>
            <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-radius: 0 0 12px 12px;">
              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                Este email foi enviado porque atualizou o seu endereco de email.<br>
                Se nao solicitou esta alteracao, contacte o suporte.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `;

      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: 'Padel App <noreply@boostpadel.store>',
            to: [newEmail],
            subject: 'Padel App - Instrucoes de Acesso',
            html: emailHtml,
          }),
        });
      } catch (emailError) {
        console.error('Failed to send installation email:', emailError);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Email updated successfully',
        user: updateData.user,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (error) {
    console.error('Error in update-player-email:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});