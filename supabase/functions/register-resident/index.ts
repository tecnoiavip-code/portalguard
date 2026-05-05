import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const BASE_HEADERS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOCAL_ORIGIN_PATTERNS = [/^http:\/\/localhost:\d+$/i, /^http:\/\/127\.0\.0\.1:\d+$/i];
const VERCEL_ORIGIN_PATTERN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

const ipRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const emailRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const IP_WINDOW_MS = 60_000;
const EMAIL_WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS_PER_IP = 10;
const MAX_ATTEMPTS_PER_EMAIL = 5;

const getAllowedOrigins = (): string[] => {
  const raw = Deno.env.get("ALLOWED_ORIGINS") ?? "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const isAllowedOrigin = (origin: string | null): boolean => {
  if (!origin) return true;

  const allowed = getAllowedOrigins();
  if (allowed.includes(origin)) return true;
  if (VERCEL_ORIGIN_PATTERN.test(origin)) return true;
  return LOCAL_ORIGIN_PATTERNS.some((re) => re.test(origin));
};

const buildCorsHeaders = (req: Request): HeadersInit => {
  const origin = req.headers.get("origin");
  if (isAllowedOrigin(origin) && origin) {
    return { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
  return { ...BASE_HEADERS, "Access-Control-Allow-Origin": "null" };
};

const jsonResponse = (req: Request, body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
  });

const sanitizeEmail = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
};

const getClientIp = (req: Request): string => {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp;

  return "unknown";
};

const incrementRate = (
  map: Map<string, { count: number; resetAt: number }>,
  key: string,
  windowMs: number,
  maxCount: number
): boolean => {
  const now = Date.now();
  const item = map.get(key);

  if (!item || item.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (item.count >= maxCount) {
    return false;
  }

  item.count += 1;
  return true;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders(req) });
  }

  if (!isAllowedOrigin(req.headers.get("origin"))) {
    return jsonResponse(req, { error: "Forbidden origin" }, 403);
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const { email, password } = await req.json();
    const normalizedEmail = sanitizeEmail(email);
    const ip = getClientIp(req);

    if (!incrementRate(ipRateLimitMap, ip, IP_WINDOW_MS, MAX_ATTEMPTS_PER_IP)) {
      return jsonResponse(req, { error: "Muitas tentativas. Tente novamente em alguns minutos." }, 429);
    }

    if (!incrementRate(emailRateLimitMap, normalizedEmail || "empty", EMAIL_WINDOW_MS, MAX_ATTEMPTS_PER_EMAIL)) {
      return jsonResponse(req, { error: "Muitas tentativas para este email. Tente novamente mais tarde." }, 429);
    }

    if (!normalizedEmail || typeof password !== "string") {
      return jsonResponse(req, { error: "Dados invalidos" }, 400);
    }

    if (password.length < 8) {
      return jsonResponse(req, { error: "A senha deve ter no minimo 8 caracteres" }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: resident, error: residentError } = await supabaseAdmin
      .from("residents")
      .select("id, name, email, auth_user_id")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    if (residentError || !resident || resident.auth_user_id) {
      return jsonResponse(
        req,
        { error: "Nao foi possivel criar conta com os dados informados. Verifique com a portaria." },
        400
      );
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: resident.name },
    });

    if (authError || !authData.user) {
      return jsonResponse(
        req,
        { error: "Nao foi possivel criar conta com os dados informados. Verifique com a portaria." },
        400
      );
    }

    const userId = authData.user.id;

    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "resident" });

    if (roleError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw roleError;
    }

    const { error: linkError } = await supabaseAdmin
      .from("residents")
      .update({ auth_user_id: userId })
      .eq("id", resident.id);

    if (linkError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw linkError;
    }

    return jsonResponse(req, { success: true, message: "Conta criada com sucesso" });
  } catch (error) {
    console.error("register-resident error:", error);
    return jsonResponse(req, { error: "Erro interno do servidor" }, 500);
  }
});
