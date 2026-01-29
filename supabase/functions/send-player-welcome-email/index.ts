import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface WelcomeEmailRequest {
  email: string;
  tournamentName: string;
  categoryName?: string;
  // Dados opcionais para envio direto sem precisar de player_account
  playerName?: string;
  phoneNumber?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: WelcomeEmailRequest = await req.json();
    const { email, tournamentName, categoryName, playerName, phoneNumber } = body;

    if (!email || !tournamentName) {
      return new Response(
        JSON.stringify({ error: 'email and tournamentName are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Tentar encontrar o player_account pelo email
    const { data: playerAccount } = await supabase
      .from('player_accounts')
      .select('email, name, phone_number, user_id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    // Se não encontrar pelo email, tentar pelo telefone se fornecido
    let finalAccount = playerAccount;
    if (!finalAccount && phoneNumber) {
      const normalizedPhone = phoneNumber.replace(/\s+/g, '');
      const { data: accountByPhone } = await supabase
        .from('player_accounts')
        .select('email, name, phone_number, user_id')
        .eq('phone_number', normalizedPhone)
        .maybeSingle();
      finalAccount = accountByPhone;
    }

    // Usar dados do player_account ou os dados fornecidos diretamente
    const finalName = finalAccount?.name || playerName || 'Jogador';
    const finalPhone = finalAccount?.phone_number || phoneNumber;
    const finalEmail = finalAccount?.email || normalizedEmail;

    if (!finalPhone) {
      return new Response(
        JSON.stringify({ error: 'Phone number is required. Please provide phoneNumber parameter or ensure the player has a phone number in their account.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const normalizedPhone = finalPhone.replace(/\s+/g, '');
    const standardPassword = `Player${normalizedPhone.slice(-4)}!`;

    const appUrl = Deno.env.get('APP_URL') || supabaseUrl;

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bem-vindo ao ${tournamentName}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">🎾 Bem-vindo!</h1>
            </td>
          </tr>
          
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px; color: #1f2937; font-size: 22px; font-weight: 600;">Olá ${finalName}!</h2>
              
              <p style="margin: 0 0 20px; color: #4b5563; font-size: 16px; line-height: 1.6;">
                Foi inscrito no torneio <strong style="color: #1f2937;">${tournamentName}</strong>${categoryName ? ` na categoria <strong style="color: #1f2937;">${categoryName}</strong>` : ''}.
              </p>
              
              <p style="margin: 0 0 30px; color: #4b5563; font-size: 16px; line-height: 1.6;">
                Para aceder à aplicação e acompanhar o torneio, utilize as seguintes credenciais:
              </p>
              
              <div style="background-color: #f9fafb; border: 2px solid #e5e7eb; border-radius: 8px; padding: 24px; margin: 0 0 30px;">
                <div style="margin-bottom: 16px;">
                  <p style="margin: 0 0 6px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Número de Telefone</p>
                  <p style="margin: 0; color: #1f2937; font-size: 18px; font-weight: 600; font-family: 'Courier New', monospace;">${normalizedPhone}</p>
                </div>
                <div>
                  <p style="margin: 0 0 6px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Password</p>
                  <p style="margin: 0; color: #1f2937; font-size: 18px; font-weight: 600; font-family: 'Courier New', monospace;">${standardPassword}</p>
                </div>
              </div>
              
              <div style="border-top: 1px solid #e5e7eb; margin: 30px 0;"></div>
              
              <h3 style="margin: 0 0 15px; color: #1f2937; font-size: 18px; font-weight: 600;">📱 Aceda à Aplicação</h3>
              
              <table role="presentation" style="margin: 0 0 30px;">
                <tr>
                  <td>
                    <a href="${appUrl}" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Abrir Aplicação</a>
                  </td>
                </tr>
              </table>
              
              <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin: 0 0 20px;">
                <h4 style="margin: 0 0 15px; color: #1f2937; font-size: 16px; font-weight: 600;">💡 Instale no seu telemóvel</h4>
                
                <p style="margin: 0 0 12px; color: #4b5563; font-size: 14px; line-height: 1.6;">
                  <strong style="color: #1f2937;">iPhone/iPad (Safari):</strong><br>
                  1. Abra o link acima no Safari<br>
                  2. Toque no botão de partilha <span style="background-color: #e5e7eb; padding: 2px 6px; border-radius: 4px;">⬆️</span><br>
                  3. Escolha "Adicionar ao Ecrã Principal"<br>
                  4. Faça login com modo "Jogador" usando as credenciais acima
                </p>
                
                <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.6;">
                  <strong style="color: #1f2937;">Android (Chrome):</strong><br>
                  1. Abra o link acima no Chrome<br>
                  2. Toque no menu <span style="background-color: #e5e7eb; padding: 2px 6px; border-radius: 4px;">⋮</span> (três pontos)<br>
                  3. Escolha "Instalar aplicação" ou "Adicionar ao ecrã inicial"<br>
                  4. Faça login com modo "Jogador" usando as credenciais acima
                </p>
              </div>
              
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 4px; margin: 0 0 20px;">
                <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.6;">
                  <strong>⚠️ Importante:</strong> Ao fazer login, escolha o modo <strong>"Jogador"</strong> e utilize o seu número de telefone e password fornecidos acima.
                </p>
              </div>
              
              <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                Se tiver alguma dúvida ou precisar de redefinir a sua password, contacte o organizador do torneio.
              </p>
            </td>
          </tr>
          
          <tr>
            <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-radius: 0 0 12px 12px;">
              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                Este email foi enviado porque foi inscrito num torneio.<br>
                Se não solicitou esta inscrição, ignore este email.
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

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: 'Padel Tournaments <noreply@boostpadel.store>',
        to: [finalEmail],
        subject: `Bem-vindo ao ${tournamentName}! 🎾`,
        html: emailHtml,
      }),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error('Resend error:', resendData);
      throw new Error(`Failed to send email: ${JSON.stringify(resendData)}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Welcome email sent successfully',
        emailId: resendData.id,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (error) {
    console.error('Error in send-player-welcome-email:', error);
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