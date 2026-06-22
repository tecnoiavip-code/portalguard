import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Base64url helpers ──

function base64urlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  const raw = atob(padded);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function arrayBufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const len = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(len);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// ── VAPID key generation ──

async function generateVapidKeys() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"]
  );
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

  const x = base64urlToUint8Array(publicKeyJwk.x!);
  const y = base64urlToUint8Array(publicKeyJwk.y!);
  const uncompressed = new Uint8Array(65);
  uncompressed[0] = 0x04;
  uncompressed.set(x, 1);
  uncompressed.set(y, 33);

  return {
    publicKey: arrayBufferToBase64url(uncompressed.buffer),
    privateKeyJwk: JSON.stringify(privateKeyJwk),
  };
}

// ── VAPID JWT ──

async function createVapidJwt(
  audience: string,
  subject: string,
  privateKeyJwk: JsonWebKey
) {
  const key = await crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 86400, sub: subject };

  const enc = new TextEncoder();
  const headerB64 = arrayBufferToBase64url(enc.encode(JSON.stringify(header)).buffer);
  const payloadB64 = arrayBufferToBase64url(enc.encode(JSON.stringify(payload)).buffer);
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    enc.encode(unsignedToken)
  );

  const sigBytes = new Uint8Array(signature);
  const r = sigBytes.slice(0, 32);
  const s = sigBytes.slice(32, 64);
  const rawSig = new Uint8Array(64);
  rawSig.set(r, 0);
  rawSig.set(s, 32);

  const signatureB64 = arrayBufferToBase64url(rawSig.buffer);
  return `${unsignedToken}.${signatureB64}`;
}

// ── RFC 8291: Web Push Payload Encryption (aes128gcm) ──

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data));
}

async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  return hmacSha256(salt, ikm);
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  // Only need 1 block (32 bytes) since length <= 32
  const input = concatUint8Arrays(info, new Uint8Array([1]));
  const result = await hmacSha256(prk, input);
  return result.slice(0, length);
}

async function encryptPushPayload(
  payloadText: string,
  p256dhBase64url: string,
  authBase64url: string
): Promise<Uint8Array> {
  const encoder = new TextEncoder();

  // Decode subscriber keys
  const subscriberPublicKeyRaw = base64urlToUint8Array(p256dhBase64url);
  const authSecret = base64urlToUint8Array(authBase64url);

  // Generate random 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Import subscriber's public key for ECDH
  const subscriberPublicKey = await crypto.subtle.importKey(
    "raw",
    subscriberPublicKeyRaw,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // Generate ephemeral ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  // Export local public key (65 bytes uncompressed)
  const localPublicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", localKeyPair.publicKey)
  );

  // ECDH shared secret
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: subscriberPublicKey },
    localKeyPair.privateKey,
    256
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  // Step 1: IKM extraction
  // PRK_key = HKDF-Extract(salt=auth_secret, ikm=ecdh_secret)
  const prkKey = await hkdfExtract(authSecret, sharedSecret);

  // info = "WebPush: info\0" || subscriber_public_key || local_public_key
  const ikmInfo = concatUint8Arrays(
    encoder.encode("WebPush: info\0"),
    subscriberPublicKeyRaw,
    localPublicKeyRaw
  );

  // IKM = HKDF-Expand(PRK_key, ikm_info, 32)
  const ikm = await hkdfExpand(prkKey, ikmInfo, 32);

  // Step 2: PRK = HKDF-Extract(salt=salt, ikm=IKM)
  const prk = await hkdfExtract(salt, ikm);

  // Step 3: Derive CEK and NONCE
  const cekInfo = encoder.encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = encoder.encode("Content-Encoding: nonce\0");

  const cek = await hkdfExpand(prk, cekInfo, 16);
  const nonce = await hkdfExpand(prk, nonceInfo, 12);

  // Step 4: Pad plaintext and encrypt
  const payloadBytes = encoder.encode(payloadText);
  // Add padding delimiter (0x02 = last record)
  const paddedPayload = new Uint8Array(payloadBytes.length + 1);
  paddedPayload.set(payloadBytes);
  paddedPayload[payloadBytes.length] = 2;

  const cekCryptoKey = await crypto.subtle.importKey(
    "raw", cek, { name: "AES-GCM" }, false, ["encrypt"]
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      cekCryptoKey,
      paddedPayload
    )
  );

  // Step 5: Build aes128gcm content-coding header
  // header = salt (16) || record_size (4, uint32 BE) || idlen (1) || keyid (65)
  const header = new Uint8Array(86);
  header.set(salt, 0);
  const rsView = new DataView(header.buffer, 16, 4);
  rsView.setUint32(0, 4096, false); // record size
  header[20] = 65; // key ID length (uncompressed P-256 = 65 bytes)
  header.set(localPublicKeyRaw, 21);

  // Final body = header || ciphertext
  return concatUint8Arrays(header, ciphertext);
}

// ── Send Web Push with encrypted payload ──

async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payloadText: string,
  vapidPublicKey: string,
  vapidPrivateKeyJwk: JsonWebKey
) {
  const url = new URL(subscription.endpoint);
  const audience = `${url.protocol}//${url.host}`;

  const jwt = await createVapidJwt(
    audience,
    "mailto:noreply@portalguard.lovable.app",
    vapidPrivateKeyJwk
  );

  // Encrypt the payload using RFC 8291 aes128gcm
  const encryptedBody = await encryptPushPayload(
    payloadText,
    subscription.p256dh,
    subscription.auth
  );

  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: "86400",
      Authorization: `vapid t=${jwt}, k=${vapidPublicKey}`,
      "Content-Length": String(encryptedBody.length),
    },
    body: encryptedBody,
  });

  return response;
}

// ── Main handler ──

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { action, user_id, title, body, tag, data } = await req.json();

    // Action: get-vapid-key
    if (action === "get-vapid-key") {
      const { data: existing } = await supabase
        .from("vapid_keys")
        .select("public_key")
        .limit(1)
        .maybeSingle();

      if (existing) {
        return new Response(JSON.stringify({ publicKey: existing.public_key }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const keys = await generateVapidKeys();
      await supabase.from("vapid_keys").insert({
        public_key: keys.publicKey,
        private_key: keys.privateKeyJwk,
      });

      return new Response(JSON.stringify({ publicKey: keys.publicKey }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Helper: send to a list of subscriptions
    async function sendToSubscriptions(
      subs: { endpoint: string; p256dh: string; auth: string }[],
      payloadText: string,
      vapidPublicKey: string,
      vapidPrivateKeyJwk: JsonWebKey
    ) {
      let sent = 0;
      const expired: string[] = [];

      for (const sub of subs) {
        try {
          const res = await sendWebPush(sub, payloadText, vapidPublicKey, vapidPrivateKeyJwk);
          if (res.status === 201 || res.status === 200) {
            sent++;
          } else if (res.status === 404 || res.status === 410) {
            expired.push(sub.endpoint);
          } else {
            const text = await res.text();
            console.error(`Push failed (${res.status}):`, text);
          }
        } catch (e) {
          console.error("Push error:", e);
        }
      }

      if (expired.length > 0) {
        await supabase
          .from("push_subscriptions")
          .delete()
          .in("endpoint", expired);
      }

      return { sent, expired: expired.length };
    }

    // Get VAPID keys (shared by send and send-to-staff)
    async function getVapidKeys() {
      const { data: vapidData } = await supabase
        .from("vapid_keys")
        .select("public_key, private_key")
        .limit(1)
        .maybeSingle();
      return vapidData;
    }

    // Action: send - send push to a specific user
    if (action === "send") {
      if (!user_id || !title) {
        return new Response(JSON.stringify({ error: "user_id and title required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const vapidData = await getVapidKeys();
      if (!vapidData) {
        return new Response(JSON.stringify({ error: "VAPID keys not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .eq("user_id", user_id);

      if (!subs || subs.length === 0) {
        return new Response(JSON.stringify({ sent: 0, message: "No subscriptions" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const payload = JSON.stringify({ title, body: body || "", tag: tag || "", data: data || {} });
      const privateKeyJwk = JSON.parse(vapidData.private_key);
      const result = await sendToSubscriptions(subs, payload, vapidData.public_key, privateKeyJwk);

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: send-to-staff
    if (action === "send-to-staff") {
      const { data: staffRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "receptionist", "security_guard"]);

      if (!staffRoles || staffRoles.length === 0) {
        return new Response(JSON.stringify({ sent: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userIds = staffRoles.map((r: any) => r.user_id);

      const vapidData = await getVapidKeys();
      if (!vapidData) {
        return new Response(JSON.stringify({ error: "VAPID keys not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth, user_id")
        .in("user_id", userIds);

      if (!subs || subs.length === 0) {
        return new Response(JSON.stringify({ sent: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const payload = JSON.stringify({ title, body: body || "", tag: tag || "", data: data || {} });
      const privateKeyJwk = JSON.parse(vapidData.private_key);
      const result = await sendToSubscriptions(subs, payload, vapidData.public_key, privateKeyJwk);

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
