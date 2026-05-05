import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const BASE_HEADERS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOCAL_ORIGIN_PATTERNS = [/^http:\/\/localhost:\d+$/i, /^http:\/\/127\.0\.0\.1:\d+$/i];
const VERCEL_ORIGIN_PATTERN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

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

const requireAuthenticatedUser = async (req: Request): Promise<boolean> => {
  const token = getBearerToken(req);
  if (!token) return false;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const { data, error } = await supabase.auth.getUser(token);
  return !error && !!data.user;
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

  const isAuthenticated = await requireAuthenticatedUser(req);
  if (!isAuthenticated) {
    return jsonResponse(req, { error: "Unauthorized" }, 401);
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const { pdfBase64, fileName } = await req.json();

    if (!pdfBase64 || typeof pdfBase64 !== "string") {
      return jsonResponse(req, { error: "pdfBase64 is required" }, 400);
    }

    if (pdfBase64.length > 14_000_000) {
      return jsonResponse(req, { error: "Arquivo muito grande para OCR" }, 413);
    }

    console.log(`Processing OCR for file: ${fileName || "unknown"}`);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `You are a document OCR specialist. Extract ALL text from the provided PDF image/document.
Focus on extracting resident/tenant data in a structured format.
For each person found, output one line with fields separated by semicolons (;) in this order:
Name;Apartment;CPF;Phone;Email

Rules:
- If a field is not available, leave it empty but keep the semicolons.
- Extract ALL entries, do not skip any.
- Do NOT add headers or explanations, just the data lines.
- If the document has tables, extract each row.
- If you can't find structured resident data, output all text you can read from the document.`,
                },
                {
                  inline_data: {
                    mime_type: "application/pdf",
                    data: pdfBase64,
                  },
                },
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", response.status, errorText);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const result = await response.json();
    const extractedText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

    console.log(`OCR extracted ${extractedText.length} characters`);

    return jsonResponse(req, { text: extractedText });
  } catch (error) {
    console.error("pdf-ocr error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse(req, { error: message }, 500);
  }
});
