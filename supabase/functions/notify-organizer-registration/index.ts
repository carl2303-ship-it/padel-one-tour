import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface NotifyRequest {
  tournamentId: string;
  teamId?: string;
  playerId?: string;
  playerName: string;
  partnerName?: string;
  categoryName?: string;
  isTeam: boolean;
}

async function sendPushNotification(
  supabaseUrl: string,
  supabaseKey: string,
  userId: string,
  payload: { title: string; body: string; url?: string; tournamentId?: string }
) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ userId, payload }),
    });
    const data = await response.json();
    console.log('Push notification result:', data);
    return data;
  } catch (error) {
    console.error('Error sending push notification:', error);
    return { success: false };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: NotifyRequest = await req.json();
    const { tournamentId, playerName, partnerName, categoryName, isTeam } = body;

    if (!tournamentId || !playerName) {
      return new Response(
        JSON.stringify({ error: 'tournamentId and playerName are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: tournament, error: tournamentError } = await supabase
      .from('tournaments')
      .select('name, user_id')
      .eq('id', tournamentId)
      .single();

    if (tournamentError || !tournament) {
      return new Response(
        JSON.stringify({ error: 'Tournament not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tournamentName = tournament.name;
    const organizerUserId = tournament.user_id;

    const registrationText = isTeam && partnerName
      ? `${playerName} e ${partnerName}`
      : playerName;

    const categoryText = categoryName ? ` (${categoryName})` : '';

    const pushPayload = {
      title: 'Nova Inscricao!',
      body: `${registrationText}${categoryText} inscreveu-se em ${tournamentName}`,
      url: '/',
      tournamentId,
      tag: `registration-${tournamentId}`,
    };

    const pushResult = await sendPushNotification(
      supabaseUrl,
      supabaseServiceKey,
      organizerUserId,
      pushPayload
    );

    let emailSent = false;

    if (resendApiKey) {
      const { data: authUser } = await supabase.auth.admin.getUserById(organizerUserId);

      if (authUser?.user?.email) {
        const organizerEmail = authUser.user.email;

        const registrationInfo = isTeam && partnerName
          ? `<strong>${playerName}</strong> e <strong>${partnerName}</strong>`
          : `<strong>${playerName}</strong>`;

        const categoryInfo = categoryName ? ` na categoria <strong>${categoryName}</strong>` : '';

        const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nova Inscricao - ${tournamentName}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">Nova Inscricao!</h1>
            </td>
          </tr>
          
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 20px; color: #4b5563; font-size: 16px; line-height: 1.6;">
                Tem uma nova inscricao no torneio <strong style="color: #1f2937;">${tournamentName}</strong>.
              </p>
              
              <div style="background-color: #f0fdf4; border: 2px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 0 0 20px;">
                <p style="margin: 0 0 10px; color: #166534; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                  ${isTeam ? 'Equipa Inscrita' : 'Jogador Inscrito'}
                </p>
                <p style="margin: 0; color: #1f2937; font-size: 18px; line-height: 1.5;">
                  ${registrationInfo}${categoryInfo}
                </p>
              </div>
              
              <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                Aceda a aplicacao para gerir as inscricoes do torneio.
              </p>
            </td>
          </tr>
          
          <tr>
            <td style="background-color: #f9fafb; padding: 20px 30px; text-align: center; border-radius: 0 0 12px 12px;">
              <p style="margin: 0; color: #6b7280; font-size: 12px;">
                Padel Tournaments - Notificacao automatica
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
            to: [organizerEmail],
            subject: `Nova Inscricao: ${tournamentName}`,
            html: emailHtml,
          }),
        });

        if (resendResponse.ok) {
          emailSent = true;
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Organizer notified',
        pushSent: pushResult?.success || false,
        emailSent,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (error) {
    console.error('Error in notify-organizer-registration:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
