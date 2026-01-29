import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface TestEmailRequest {
  email: string;
  testType?: 'welcome' | 'credentials';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY not configured');
    }

    const body: TestEmailRequest = await req.json();
    const { email, testType = 'welcome' } = body;

    if (!email) {
      return new Response(
        JSON.stringify({ error: 'email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const appUrl = Deno.env.get('APP_URL') || 'https://boostpadel.store';
    const testPhone = '+351912345678';
    const testPassword = 'Player5678!';

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Teste de Email - BoostPadel</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">🎾 Teste de Email</h1>
              <p style="margin: 10px 0 0; color: #bfdbfe; font-size: 16px;">BoostPadel - Sistema de Torneios</p>
            </td>
          </tr>
          
          <tr>
            <td style="padding: 40px 30px;">
              <div style="background-color: #d1fae5; border-left: 4px solid #10b981; padding: 16px; border-radius: 4px; margin: 0 0 30px;">
                <p style="margin: 0; color: #065f46; font-size: 16px; font-weight: 600;">
                  ✅ O sistema de envio de emails está a funcionar corretamente!
                </p>
              </div>

              <h2 style="margin: 0 0 20px; color: #1f2937; font-size: 22px; font-weight: 600;">Olá!</h2>
              
              <p style="margin: 0 0 20px; color: #4b5563; font-size: 16px; line-height: 1.6;">
                Este é um email de teste do sistema BoostPadel. Se estás a receber este email, significa que o sistema de notificações está configurado corretamente.
              </p>

              <p style="margin: 0 0 20px; color: #4b5563; font-size: 16px; line-height: 1.6;">
                Abaixo está um exemplo de como aparecem as credenciais de acesso:
              </p>
              
              <div style="background-color: #f9fafb; border: 2px solid #e5e7eb; border-radius: 8px; padding: 24px; margin: 0 0 30px;">
                <div style="margin-bottom: 16px;">
                  <p style="margin: 0 0 6px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Número de Telefone (exemplo)</p>
                  <p style="margin: 0; color: #1f2937; font-size: 18px; font-weight: 600; font-family: 'Courier New', monospace;">${testPhone}</p>
                </div>
                <div>
                  <p style="margin: 0 0 6px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Password (exemplo)</p>
                  <p style="margin: 0; color: #1f2937; font-size: 18px; font-weight: 600; font-family: 'Courier New', monospace;">${testPassword}</p>
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
                  2. Toque no botão de partilha ⬆️<br>
                  3. Escolha "Adicionar ao Ecrã Principal"<br>
                  4. Faça login com modo "Jogador"
                </p>
                
                <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.6;">
                  <strong style="color: #1f2937;">Android (Chrome):</strong><br>
                  1. Abra o link acima no Chrome<br>
                  2. Toque no menu ⋮ (três pontos)<br>
                  3. Escolha "Instalar aplicação" ou "Adicionar ao ecrã inicial"<br>
                  4. Faça login com modo "Jogador"
                </p>
              </div>
              
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 4px; margin: 0 0 20px;">
                <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.6;">
                  <strong>⚠️ Nota:</strong> Este é apenas um email de teste. As credenciais acima são exemplos e não funcionam.
                </p>
              </div>
            </td>
          </tr>
          
          <tr>
            <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-radius: 0 0 12px 12px;">
              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                Este é um email de teste do sistema BoostPadel.<br>
                Data do teste: ${new Date().toLocaleString('pt-PT')}
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
        from: 'BoostPadel <noreply@boostpadel.store>',
        to: [email],
        subject: '🎾 Teste de Email - BoostPadel',
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
        message: 'Test email sent successfully',
        emailId: resendData.id,
        sentTo: email,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (error) {
    console.error('Error in test-email:', error);
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
