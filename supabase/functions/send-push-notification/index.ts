import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
  tournamentId?: string;
  tag?: string;
}

interface SendPushRequest {
  userId?: string;
  playerAccountId?: string;
  payload: PushPayload;
}

async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
  vapidPublicKey: string,
  vapidPrivateKey: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  
  const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from(rawData, char => char.charCodeAt(0));
  };

  const uint8ArrayToBase64Url = (uint8Array: Uint8Array): string => {
    const base64 = btoa(String.fromCharCode(...uint8Array));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  };

  try {
    const p256dhKey = urlBase64ToUint8Array(subscription.p256dh);
    const authSecret = urlBase64ToUint8Array(subscription.auth);

    const clientPublicKey = await crypto.subtle.importKey(
      'raw',
      p256dhKey,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );

    const localKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    );

    const sharedSecret = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: clientPublicKey },
      localKeyPair.privateKey,
      256
    );

    const localPublicKeyRaw = await crypto.subtle.exportKey('raw', localKeyPair.publicKey);
    const localPublicKeyBytes = new Uint8Array(localPublicKeyRaw);

    const salt = crypto.getRandomValues(new Uint8Array(16));

    const keyInfo = new Uint8Array([...encoder.encode('WebPush: info\0'), ...p256dhKey, ...localPublicKeyBytes]);

    const prk = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(sharedSecret),
      { name: 'HKDF' },
      false,
      ['deriveBits']
    );

    const ikm = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: authSecret,
        info: keyInfo,
      },
      prk,
      256
    );

    const prkForCEK = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(ikm),
      { name: 'HKDF' },
      false,
      ['deriveBits']
    );

    const cekInfo = encoder.encode('Content-Encoding: aes128gcm\0');
    const cekBits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: salt,
        info: cekInfo,
      },
      prkForCEK,
      128
    );

    const nonceInfo = encoder.encode('Content-Encoding: nonce\0');
    const nonceBits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: salt,
        info: nonceInfo,
      },
      prkForCEK,
      96
    );

    const contentEncryptionKey = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(cekBits),
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    const payloadBytes = encoder.encode(JSON.stringify(payload));
    const paddedPayload = new Uint8Array(payloadBytes.length + 1);
    paddedPayload.set(payloadBytes);
    paddedPayload[payloadBytes.length] = 2;

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: new Uint8Array(nonceBits) },
      contentEncryptionKey,
      paddedPayload
    );

    const recordSize = new Uint8Array(4);
    new DataView(recordSize.buffer).setUint32(0, 4096, false);

    const header = new Uint8Array([
      ...salt,
      ...recordSize,
      localPublicKeyBytes.length,
      ...localPublicKeyBytes,
    ]);

    const body = new Uint8Array([...header, ...new Uint8Array(encrypted)]);

    const url = new URL(subscription.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

    const jwtHeader = uint8ArrayToBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const jwtPayload = uint8ArrayToBase64Url(encoder.encode(JSON.stringify({
      aud: audience,
      exp: exp,
      sub: 'mailto:notifications@padeltournaments.app',
    })));

    const vapidPrivateKeyBytes = urlBase64ToUint8Array(vapidPrivateKey);
    const vapidKey = await crypto.subtle.importKey(
      'pkcs8',
      vapidPrivateKeyBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    ).catch(async () => {
      const jwk = {
        kty: 'EC',
        crv: 'P-256',
        d: vapidPrivateKey,
        x: vapidPublicKey.substring(0, 43),
        y: vapidPublicKey.substring(43),
      };
      return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    });

    const unsignedToken = `${jwtHeader}.${jwtPayload}`;
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      vapidKey,
      encoder.encode(unsignedToken)
    );

    const jwt = `${unsignedToken}.${uint8ArrayToBase64Url(new Uint8Array(signature))}`;

    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL': '86400',
        'Authorization': `vapid t=${jwt}, k=${vapidPublicKey}`,
      },
      body: body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Push failed:', response.status, errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error sending push:', error);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');

    if (!vapidPublicKey || !vapidPrivateKey) {
      console.log('VAPID keys not configured - push notifications disabled');
      return new Response(
        JSON.stringify({ success: true, message: 'Push notifications not configured' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: SendPushRequest = await req.json();
    const { userId, playerAccountId, payload } = body;

    if ((!userId && !playerAccountId) || !payload) {
      return new Response(
        JSON.stringify({ error: 'userId or playerAccountId and payload are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let subscriptions;
    let subError;

    if (userId) {
      const result = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('user_id', userId);
      subscriptions = result.data;
      subError = result.error;
    } else if (playerAccountId) {
      const result = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('player_account_id', playerAccountId);
      subscriptions = result.data;
      subError = result.error;
    }

    if (subError) {
      throw subError;
    }

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No subscriptions found', sentCount: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let sentCount = 0;
    const failedEndpoints: string[] = [];

    for (const sub of subscriptions) {
      const success = await sendWebPush(sub, payload, vapidPublicKey, vapidPrivateKey);
      if (success) {
        sentCount++;
      } else {
        failedEndpoints.push(sub.endpoint);
      }
    }

    if (failedEndpoints.length > 0) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .in('endpoint', failedEndpoints);
    }

    return new Response(
      JSON.stringify({
        success: true,
        sentCount,
        totalSubscriptions: subscriptions.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in send-push-notification:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
