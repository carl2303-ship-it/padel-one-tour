import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, stripe-signature",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload = await req.json();
    
    if (payload.type === "checkout.session.completed") {
      const session = payload.data.object;
      const metadata = session.metadata || {};

      // ====== Handle Open Game Payments ======
      if (metadata.type === 'open_game' && metadata.gameId) {
        const { gameId, paymentType, playerAccountId, userId } = metadata;

        // Update payment record
        await supabase
          .from('open_game_payments')
          .update({
            stripe_payment_intent_id: session.payment_intent,
            status: 'succeeded',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_session_id', session.id);

        // Update player payment_status
        if (playerAccountId) {
          await supabase
            .from('open_game_players')
            .update({
              payment_status: 'paid',
              stripe_session_id: session.id,
            })
            .eq('game_id', gameId)
            .eq('player_account_id', playerAccountId);
        }

        // If full_court payment, mark ALL players as paid
        if (paymentType === 'full_court') {
          await supabase
            .from('open_game_players')
            .update({ payment_status: 'paid' })
            .eq('game_id', gameId);
        }

        console.log(`Open game payment completed: game=${gameId}, type=${paymentType}, player=${playerAccountId}`);

        return new Response(
          JSON.stringify({ success: true, message: 'Open game payment processed' }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: existingTransaction } = await supabase
        .from('payment_transactions')
        .select('*')
        .eq('stripe_checkout_session_id', session.id)
        .maybeSingle();

      if (existingTransaction) {
        console.log(`Found existing transaction for session ${session.id}`);

        const registrationData = existingTransaction.metadata?.registration_data;
        if (!registrationData || !registrationData.team) {
          console.log('No registration_data found in existing transaction');
          return new Response(JSON.stringify({ received: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const teamData = registrationData.team;
        const categoryId = existingTransaction.metadata?.category_id;

        const { data: players, error: playersError } = await supabase
          .from('players')
          .insert([
            { name: teamData.player1.name, email: teamData.player1.email, phone: teamData.player1.phone || null, user_id: existingTransaction.organizer_user_id || null },
            { name: teamData.player2.name, email: teamData.player2.email, phone: teamData.player2.phone || null, user_id: existingTransaction.organizer_user_id || null }
          ])
          .select();

        if (playersError || !players || players.length !== 2) {
          throw new Error(`Failed to create players: ${playersError?.message}`);
        }

        const { data: teamsCount } = await supabase
          .from('teams')
          .select('*', { count: 'exact', head: true })
          .eq('tournament_id', existingTransaction.tournament_id);

        await supabase
          .from('payment_transactions')
          .update({
            stripe_payment_intent_id: session.payment_intent,
            status: 'succeeded',
            updated_at: new Date().toISOString()
          })
          .eq('id', existingTransaction.id);

        const { error: teamError } = await supabase
          .from('teams')
          .insert({
            tournament_id: existingTransaction.tournament_id,
            name: teamData.name,
            player1_id: players[0].id,
            player2_id: players[1].id,
            seed: (teamsCount?.length || 0) + 1,
            category_id: categoryId || null,
            payment_status: 'paid',
            payment_transaction_id: existingTransaction.id
          });

        if (teamError) {
          throw new Error(`Failed to create team: ${teamError.message}`);
        }

        console.log(`Team ${teamData.name} registered successfully from existing transaction`);

        return new Response(
          JSON.stringify({
            success: true,
            message: "Team registered successfully",
            teamName: teamData.name
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (metadata.tournamentId) {
        const { tournamentId, categoryId, isIndividual, teamName, player1Name, player1Email, player1Phone, player2Name, player2Email, player2Phone, organizerUserId } = metadata;

        const isIndividualRegistration = isIndividual === "true";

        if (isIndividualRegistration) {
          const { error: playerError } = await supabase
            .from('players')
            .insert({
              tournament_id: tournamentId,
              category_id: categoryId || null,
              name: player1Name,
              email: player1Email || null,
              phone_number: player1Phone || null,
              user_id: organizerUserId || null,
            });

          if (playerError) {
            throw new Error(`Failed to create individual player: ${playerError.message}`);
          }

          console.log(`Individual player ${player1Name} registered successfully with payment`);

          return new Response(
            JSON.stringify({
              success: true,
              message: "Player registered successfully",
              playerName: player1Name
            }),
            {
              status: 200,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        } else {
          const { data: players, error: playersError } = await supabase
            .from('players')
            .insert([
              { name: player1Name, email: player1Email, phone_number: player1Phone || null, user_id: organizerUserId || null },
              { name: player2Name, email: player2Email, phone_number: player2Phone || null, user_id: organizerUserId || null }
            ])
            .select();

          if (playersError || !players || players.length !== 2) {
            throw new Error(`Failed to create players: ${playersError?.message}`);
          }

          const { data: teamsCount } = await supabase
            .from('teams')
            .select('*', { count: 'exact', head: true })
            .eq('tournament_id', tournamentId);

          const { data: transaction } = await supabase
            .from('payment_transactions')
            .insert({
              tournament_id: tournamentId,
              stripe_checkout_session_id: session.id,
              stripe_payment_intent_id: session.payment_intent,
              amount: session.amount_total / 100,
              currency: session.currency || 'eur',
              status: 'succeeded',
              organizer_user_id: organizerUserId,
              metadata: { teamName, categoryId: categoryId || null }
            })
            .select()
            .single();

          if (!transaction) {
            throw new Error('Failed to create payment transaction');
          }

          const { error: teamError } = await supabase
            .from('teams')
            .insert({
              tournament_id: tournamentId,
              name: teamName,
              player1_id: players[0].id,
              player2_id: players[1].id,
              seed: (teamsCount?.length || 0) + 1,
              category_id: categoryId || null,
              payment_status: 'paid',
              payment_transaction_id: transaction.id
            });

          if (teamError) {
            throw new Error(`Failed to create team: ${teamError.message}`);
          }

          console.log(`Team ${teamName} registered successfully with payment`);

          return new Response(
            JSON.stringify({
              success: true,
              message: "Team registered successfully",
              teamName
            }),
            {
              status: 200,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
      }

      const email = session.customer_details?.email || session.customer_email;

      if (!email) {
        throw new Error("No email found in Stripe session");
      }

      const password = crypto.randomUUID().replace(/-/g, "").substring(0, 16);

      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          source: 'boostpadel_store',
          stripe_session_id: session.id
        }
      });

      if (authError) {
        console.error("Error creating user:", authError);
        throw authError;
      }

      console.log(`User created successfully: ${email}`);

      await supabase
        .from('user_logo_settings')
        .insert({
          user_id: authData.user.id,
          role: 'organizer',
          is_paid_organizer: true,
          logo_url: null
        });

      const emailHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
              .credentials { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
              .credential-item { margin: 10px 0; }
              .label { font-weight: bold; color: #667eea; }
              .value { font-family: 'Courier New', monospace; background: #f0f0f0; padding: 8px 12px; border-radius: 4px; display: inline-block; margin-top: 5px; }
              .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
              .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Bem-vindo ao Torneio de Padel!</h1>
              </div>
              <div class="content">
                <p>Ola!</p>
                <p>Obrigado pela sua compra! A sua conta foi criada com sucesso.</p>
                
                <div class="credentials">
                  <h3>As suas credenciais de acesso:</h3>
                  <div class="credential-item">
                    <div class="label">Email:</div>
                    <div class="value">${email}</div>
                  </div>
                  <div class="credential-item">
                    <div class="label">Password temporaria:</div>
                    <div class="value">${password}</div>
                  </div>
                </div>

                <p><strong>Importante:</strong> Por razoes de seguranca, recomendamos que altere a sua password assim que fizer login pela primeira vez.</p>
                
                <p style="text-align: center;">
                  <a href="${supabaseUrl.replace('.supabase.co', '.netlify.app')}" class="button">Aceder a Plataforma</a>
                </p>

                <p>Se tiver alguma questao, nao hesite em contactar-nos.</p>
                
                <p>Bom torneio!</p>
              </div>
              <div class="footer">
                <p>Este e um email automatico. Por favor nao responda.</p>
              </div>
            </div>
          </body>
        </html>
      `;

      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: "Torneio Padel <onboarding@resend.dev>",
          to: [email],
          subject: "Bem-vindo! As suas credenciais de acesso",
          html: emailHtml,
        }),
      });

      if (!resendResponse.ok) {
        const errorData = await resendResponse.text();
        console.error("Resend error:", errorData);
        throw new Error(`Failed to send email: ${errorData}`);
      }

      const emailResult = await resendResponse.json();
      console.log("Email sent successfully:", emailResult);
      
      return new Response(
        JSON.stringify({
          success: true,
          message: "User account created and email sent",
          email,
          emailId: emailResult.id,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    return new Response(
      JSON.stringify({ received: true }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({
        error: error.message,
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});