import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@6.4.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const BASE_HEADERS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOCAL_ORIGIN_PATTERNS = [/^http:\/\/localhost:\d+$/i, /^http:\/\/127\.0\.0\.1:\d+$/i];
const VERCEL_ORIGIN_PATTERN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

interface MailNotificationRequest {
  residentId: string;
  sender: string;
  packageType: string;
  receivedAt: string;
}

function escapeHtml(unsafe: string): string {
  if (!unsafe) return "";
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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

const getBearerToken = (req: Request): string | null => {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  return authHeader.slice(7).trim();
};

const isResidentUser = async (supabase: any, userId: string): Promise<boolean> => {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "resident")
    .maybeSingle();
  return !!data;
};

const handler = async (req: Request): Promise<Response> => {
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse(req, { error: "Unauthorized" }, 401);
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return jsonResponse(req, { error: "Unauthorized" }, 401);
    }

    if (await isResidentUser(supabase, authData.user.id)) {
      return jsonResponse(req, { error: "Forbidden" }, 403);
    }

    const { residentId, sender, packageType, receivedAt }: MailNotificationRequest = await req.json();

    if (!residentId || !sender || !packageType || !receivedAt) {
      return jsonResponse(req, { error: "Dados invalidos" }, 400);
    }

    const { data: resident, error: residentError } = await supabase
      .from("residents")
      .select("name, email, apartment")
      .eq("id", residentId)
      .single();

    if (residentError || !resident) {
      return jsonResponse(req, { error: "Morador nao encontrado" }, 404);
    }

    if (!resident.email) {
      return jsonResponse(req, { message: "Morador sem email cadastrado" });
    }

    const receivedAtDate = new Date(receivedAt);
    const formattedDate = Number.isNaN(receivedAtDate.getTime())
      ? "Data indisponivel"
      : receivedAtDate.toLocaleString("pt-BR");

    const emailResponse = await resend.emails.send({
      from: "PortalGuard <onboarding@resend.dev>",
      to: [resident.email],
      subject: "Nova Correspondencia Recebida",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #333; border-bottom: 2px solid #4F46E5; padding-bottom: 10px;">
            Nova Correspondencia Recebida
          </h1>
          <p style="font-size: 16px; color: #555;">
            Ola <strong>${escapeHtml(resident.name)}</strong>,
          </p>
          <p style="font-size: 16px; color: #555;">
            Voce tem uma nova correspondencia aguardando retirada na portaria.
          </p>
          <div style="background-color: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>Apartamento:</strong> ${escapeHtml(resident.apartment)}</p>
            <p style="margin: 5px 0;"><strong>Remetente:</strong> ${escapeHtml(sender)}</p>
            <p style="margin: 5px 0;"><strong>Tipo:</strong> ${escapeHtml(packageType)}</p>
            <p style="margin: 5px 0;"><strong>Data de Recebimento:</strong> ${escapeHtml(formattedDate)}</p>
          </div>
          <p style="font-size: 14px; color: #777; margin-top: 20px;">
            Por favor, dirija-se a portaria para realizar a retirada.
          </p>
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;" />
          <p style="font-size: 12px; color: #999; text-align: center;">
            PortalGuard - Sistema de Gestao de Portaria
          </p>
        </div>
      `,
    });

    return jsonResponse(req, { success: true, emailResponse });
  } catch (error: any) {
    console.error("notify-mail-received error:", error);
    return jsonResponse(req, { error: error?.message ?? "Erro interno" }, 500);
  }
};

serve(handler);
