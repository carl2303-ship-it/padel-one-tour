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

    const appUrl = Deno.env.get('PLAYER_APP_URL') || 'https://padel1.app';

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
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">🎾 Bem-vindo ao Padel One!</h1>
              <p style="margin: 10px 0 0; color: #dbeafe; font-size: 15px;">A tua nova comunidade de padel</p>
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
              
              <h3 style="margin: 0 0 15px; color: #1f2937; font-size: 20px; font-weight: 700;">📱 Instala a App Padel One</h3>
              
              <p style="margin: 0 0 20px; color: #4b5563; font-size: 15px; line-height: 1.6;">
                Com a app <strong style="color: #1f2937;">Padel One</strong> instalada no teu telemóvel, vais poder:
              </p>
              
              <table role="presentation" style="width: 100%; margin: 0 0 24px;">
                <tr>
                  <td style="padding: 12px 16px; background-color: #f0fdf4; border-radius: 8px; margin-bottom: 8px;">
                    <p style="margin: 0; color: #166534; font-size: 15px; line-height: 1.5;">
                      <strong>📅 Horários dos jogos</strong><br>
                      <span style="color: #4b5563; font-size: 13px;">Consulta os horários e campos dos teus jogos no torneio <strong>${tournamentName}</strong></span>
                    </p>
                  </td>
                </tr>
                <tr><td style="height: 8px;"></td></tr>
                <tr>
                  <td style="padding: 12px 16px; background-color: #eff6ff; border-radius: 8px;">
                    <p style="margin: 0; color: #1e40af; font-size: 15px; line-height: 1.5;">
                      <strong>🏆 Próximos torneios</strong><br>
                      <span style="color: #4b5563; font-size: 13px;">Descobre e inscreve-te nos próximos torneios de padel perto de ti</span>
                    </p>
                  </td>
                </tr>
                <tr><td style="height: 8px;"></td></tr>
                <tr>
                  <td style="padding: 12px 16px; background-color: #fdf4ff; border-radius: 8px;">
                    <p style="margin: 0; color: #7e22ce; font-size: 15px; line-height: 1.5;">
                      <strong>🤝 Encontra parceiros</strong><br>
                      <span style="color: #4b5563; font-size: 13px;">Cria jogos e encontra novos parceiros do teu nível para jogar</span>
                    </p>
                  </td>
                </tr>
                <tr><td style="height: 8px;"></td></tr>
                <tr>
                  <td style="padding: 12px 16px; background-color: #fff7ed; border-radius: 8px;">
                    <p style="margin: 0; color: #c2410c; font-size: 15px; line-height: 1.5;">
                      <strong>👥 Comunidade</strong><br>
                      <span style="color: #4b5563; font-size: 13px;">Faz parte da comunidade Padel One e acompanha a tua evolução</span>
                    </p>
                  </td>
                </tr>
              </table>
              
              <table role="presentation" style="width: 100%; margin: 0 0 30px;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${appUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 10px; font-weight: 700; font-size: 17px; letter-spacing: 0.3px;">Abrir Padel One</a>
                  </td>
                </tr>
              </table>
              
              <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin: 0 0 20px;">
                <h4 style="margin: 0 0 15px; color: #1f2937; font-size: 16px; font-weight: 600;">💡 Instala no telemóvel em 30 segundos</h4>
                
                <p style="margin: 0 0 12px; color: #4b5563; font-size: 14px; line-height: 1.6;">
                  <strong style="color: #1f2937;">iPhone/iPad (Safari):</strong><br>
                  1. Abre o link acima no Safari<br>
                  2. Toca no botão de partilha <span style="background-color: #e5e7eb; padding: 2px 6px; border-radius: 4px;">⬆️</span><br>
                  3. Escolhe "Adicionar ao Ecrã Principal"<br>
                  4. Faz login com as credenciais acima
                </p>
                
                <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.6;">
                  <strong style="color: #1f2937;">Android (Chrome):</strong><br>
                  1. Abre o link acima no Chrome<br>
                  2. Toca no menu <span style="background-color: #e5e7eb; padding: 2px 6px; border-radius: 4px;">⋮</span> (três pontos)<br>
                  3. Escolhe "Instalar aplicação" ou "Adicionar ao ecrã inicial"<br>
                  4. Faz login com as credenciais acima
                </p>
              </div>
              
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 4px; margin: 0 0 20px;">
                <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.6;">
                  <strong>⚠️ Importante:</strong> Utiliza o teu número de telefone e a password fornecidos acima para aceder.
                </p>
              </div>
              
              <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                Se tiveres alguma dúvida, contacta o organizador do torneio.
              </p>
            </td>
          </tr>
          
          <tr>
            <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-radius: 0 0 12px 12px;">
              <p style="margin: 0 0 8px; color: #4b5563; font-size: 15px; font-weight: 600;">
                Padel One — A tua app de padel
              </p>
              <p style="margin: 0; color: #9ca3af; font-size: 13px;">
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