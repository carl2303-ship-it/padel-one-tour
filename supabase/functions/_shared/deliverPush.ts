import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
  tournamentId?: string;
  tag?: string;
}

type SubscriptionRow = { endpoint: string; p256dh: string; auth: string };

async function sendWebPush(
  subscription: SubscriptionRow,
  payload: PushPayload,
  vapidPublicKey: string,
  vapidPrivateKey: string,
): Promise<boolean> {
  const encoder = new TextEncoder();

  const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    return Uint8Array.from(rawData, (char) => char.charCodeAt(0));
  };

  const uint8ArrayToBase64Url = (uint8Array: Uint8Array): string => {
    const base64 = btoa(String.fromCharCode(...uint8Array));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  };

  try {
    const p256dhKey = urlBase64ToUint8Array(subscription.p256dh);
    const authSecret = urlBase64ToUint8Array(subscription.auth);

    const clientPublicKey = await crypto.subtle.importKey(
      "raw",
      p256dhKey,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );

    const localKeyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );

    const sharedSecret = await crypto.subtle.deriveBits(
      { name: "ECDH", public: clientPublicKey },
      localKeyPair.privateKey,
      256,
    );

    const localPublicKeyRaw = await crypto.subtle.exportKey("raw", localKeyPair.publicKey);
    const localPublicKeyBytes = new Uint8Array(localPublicKeyRaw);

    const salt = crypto.getRandomValues(new Uint8Array(16));

    const keyInfo = new Uint8Array([...encoder.encode("WebPush: info\0"), ...p256dhKey, ...localPublicKeyBytes]);

    const prk = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(sharedSecret),
      { name: "HKDF" },
      false,
      ["deriveBits"],
    );

    const ikm = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: authSecret,
        info: keyInfo,
      },
      prk,
      256,
    );

    const prkForCEK = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(ikm),
      { name: "HKDF" },
      false,
      ["deriveBits"],
    );

    const cekInfo = encoder.encode("Content-Encoding: aes128gcm\0");
    const cekBits = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: salt,
        info: cekInfo,
      },
      prkForCEK,
      128,
    );

    const nonceInfo = encoder.encode("Content-Encoding: nonce\0");
    const nonceBits = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: salt,
        info: nonceInfo,
      },
      prkForCEK,
      96,
    );

    const contentEncryptionKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(cekBits),
      { name: "AES-GCM" },
      false,
      ["encrypt"],
    );

    const payloadBytes = encoder.encode(JSON.stringify(payload));
    const paddedPayload = new Uint8Array(payloadBytes.length + 1);
    paddedPayload.set(payloadBytes);
    paddedPayload[payloadBytes.length] = 2;

    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: new Uint8Array(nonceBits) },
      contentEncryptionKey,
      paddedPayload,
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

    const jwtHeader = uint8ArrayToBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
    const jwtPayload = uint8ArrayToBase64Url(
      encoder.encode(
        JSON.stringify({
          aud: audience,
          exp: exp,
          sub: "mailto:notifications@padeltournaments.app",
        }),
      ),
    );

    const vapidPrivateKeyBytes = urlBase64ToUint8Array(vapidPrivateKey);
    const vapidKey = await crypto.subtle
      .importKey(
        "pkcs8",
        vapidPrivateKeyBytes,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
      )
      .catch(async () => {
        const jwk = {
          kty: "EC",
          crv: "P-256",
          d: vapidPrivateKey,
          x: vapidPublicKey.substring(0, 43),
          y: vapidPublicKey.substring(43),
        };
        return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      });

    const unsignedToken = `${jwtHeader}.${jwtPayload}`;
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      vapidKey,
      encoder.encode(unsignedToken),
    );

    const jwt = `${unsignedToken}.${uint8ArrayToBase64Url(new Uint8Array(signature))}`;

    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        "TTL": "86400",
        Authorization: `vapid t=${jwt}, k=${vapidPublicKey}`,
      },
      body: body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Push failed:", response.status, errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending push:", error);
    return false;
  }
}

/** Merge subscriptions by user_id and all player_accounts for that user (dedupe by endpoint). */
export async function loadSubscriptionsForTarget(
  supabase: SupabaseClient,
  opts: { userId?: string; playerAccountId?: string; appSource?: string },
): Promise<SubscriptionRow[]> {
  const { userId, playerAccountId, appSource } = opts;

  if (userId) {
    const { data: accounts } = await supabase.from("player_accounts").select("id").eq("user_id", userId);
    const paIds = (accounts || []).map((a: { id: string }) => a.id);

    const byUserQuery = supabase.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", userId);
    const byUserFiltered = appSource ? byUserQuery.eq("app_source", appSource) : byUserQuery;
    const byPaPromise = paIds.length
      ? appSource
        ? supabase
            .from("push_subscriptions")
            .select("endpoint, p256dh, auth")
            .in("player_account_id", paIds)
            .eq("app_source", appSource)
        : supabase.from("push_subscriptions").select("endpoint, p256dh, auth").in("player_account_id", paIds)
      : Promise.resolve({ data: [] as SubscriptionRow[] });
    const [byUser, byPa] = await Promise.all([byUserFiltered, byPaPromise]);

    const merged = [...(byUser.data || []), ...((byPa as { data?: SubscriptionRow[] }).data || [])];
    const seen = new Set<string>();
    return merged.filter((s) => {
      if (!s?.endpoint || seen.has(s.endpoint)) return false;
      seen.add(s.endpoint);
      return true;
    });
  }

  if (playerAccountId) {
    const { data: paRow } = await supabase
      .from("player_accounts")
      .select("user_id")
      .eq("id", playerAccountId)
      .maybeSingle();

    const uid = paRow?.user_id as string | undefined;
    if (uid) {
      const { data: accounts } = await supabase.from("player_accounts").select("id").eq("user_id", uid);
      const paIds = [...new Set([...(accounts || []).map((a: { id: string }) => a.id), playerAccountId])];
      const byUserQuery = supabase.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", uid);
      const byPaQuery = supabase.from("push_subscriptions").select("endpoint, p256dh, auth").in("player_account_id", paIds);
      const [byUser, byPa] = await Promise.all([
        appSource ? byUserQuery.eq("app_source", appSource) : byUserQuery,
        appSource ? byPaQuery.eq("app_source", appSource) : byPaQuery,
      ]);
      const merged = [...(byUser.data || []), ...(byPa.data || [])];
      const seen = new Set<string>();
      return merged.filter((s) => {
        if (!s?.endpoint || seen.has(s.endpoint)) return false;
        seen.add(s.endpoint);
        return true;
      });
    }

    const query = supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("player_account_id", playerAccountId);
    const { data } = await (appSource ? query.eq("app_source", appSource) : query);
    return data || [];
  }

  return [];
}

export async function deliverWebPushNotifications(
  supabase: SupabaseClient,
  opts: {
    vapidPublicKey: string;
    vapidPrivateKey: string;
    userId?: string;
    playerAccountId?: string;
    appSource?: string;
    payload: PushPayload;
  },
): Promise<{ sentCount: number; totalSubscriptions: number }> {
  const { vapidPublicKey, vapidPrivateKey, userId, playerAccountId, appSource, payload } = opts;

  const subscriptions = await loadSubscriptionsForTarget(supabase, { userId, playerAccountId, appSource });
  if (subscriptions.length === 0) {
    return { sentCount: 0, totalSubscriptions: 0 };
  }

  let sentCount = 0;
  const failedEndpoints: string[] = [];

  for (const sub of subscriptions) {
    const success = await sendWebPush(sub, payload, vapidPublicKey, vapidPrivateKey);
    if (success) sentCount++;
    else failedEndpoints.push(sub.endpoint);
  }

  if (failedEndpoints.length > 0) {
    await supabase.from("push_subscriptions").delete().in("endpoint", failedEndpoints);
  }

  return { sentCount, totalSubscriptions: subscriptions.length };
}
