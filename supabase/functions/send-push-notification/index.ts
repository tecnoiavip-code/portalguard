import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Convert base64url to Uint8Array
function base64urlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  const raw = atob(padded);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Convert ArrayBuffer to base64url
function arrayBufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Generate VAPID keys using Web Crypto API
async function generateVapidKeys() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"]
  );
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

  // Uncompressed public key = 0x04 || x || y
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

// Create VAPID JWT for Web Push authorization
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

  // Convert DER signature to raw r||s format
  const sigBytes = new Uint8Array(signature);
  let r: Uint8Array, s: Uint8Array;

  if (sigBytes.length === 64) {
    r = sigBytes.slice(0, 32);
    s = sigBytes.slice(32);
  } else {
    // Already raw format from Web Crypto
    r = sigBytes.slice(0, 32);
    s = sigBytes.slice(32, 64);
  }

  const rawSig = new Uint8Array(64);
  rawSig.set(r, 0);
  rawSig.set(s, 32);

  const signatureB64 = arrayBufferToBase64url(rawSig.buffer);
  return `${unsignedToken}.${signatureB64}`;
}

// Send a single Web Push notification
async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
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

  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "identity",
      TTL: "86400",
      Authorization: `vapid t=${jwt}, k=${vapidPublicKey}`,
    },
    body: payload,
  });

  return response;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { action, user_id, title, body, tag, data } = await req.json();

    // Action: get-vapid-key - returns public VAPID key (creates if not exists)
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

    // Action: send - send push to a specific user
    if (action === "send") {
      if (!user_id || !title) {
        return new Response(JSON.stringify({ error: "user_id and title required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get VAPID keys
      const { data: vapidData } = await supabase
        .from("vapid_keys")
        .select("public_key, private_key")
        .limit(1)
        .maybeSingle();

      if (!vapidData) {
        return new Response(JSON.stringify({ error: "VAPID keys not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get user subscriptions
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
      let sent = 0;
      const expired: string[] = [];

      for (const sub of subs) {
        try {
          const res = await sendWebPush(
            sub,
            payload,
            vapidData.public_key,
            privateKeyJwk
          );
          if (res.status === 201 || res.status === 200) {
            sent++;
          } else if (res.status === 404 || res.status === 410) {
            expired.push(sub.endpoint);
          }
        } catch (e) {
          console.error("Push failed:", e);
        }
      }

      // Clean up expired subscriptions
      if (expired.length > 0) {
        await supabase
          .from("push_subscriptions")
          .delete()
          .in("endpoint", expired);
      }

      return new Response(JSON.stringify({ sent, expired: expired.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: send-to-staff - send push to all staff
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

      const { data: vapidData } = await supabase
        .from("vapid_keys")
        .select("public_key, private_key")
        .limit(1)
        .maybeSingle();

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
      let sent = 0;

      for (const sub of subs) {
        try {
          const res = await sendWebPush(sub, payload, vapidData.public_key, privateKeyJwk);
          if (res.status === 201 || res.status === 200) sent++;
        } catch (e) {
          console.error("Push failed:", e);
        }
      }

      return new Response(JSON.stringify({ sent }), {
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
