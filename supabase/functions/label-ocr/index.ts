import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const { imageBase64 } = await req.json();

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "imageBase64 is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const dataUrl = /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(imageBase64)
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;
    const mimeMatch = /^data:(image\/(?:jpeg|jpg|png|webp));base64,/i.exec(dataUrl);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const base64Data = dataUrl.replace(/^data:image\/(jpeg|jpg|png|webp);base64,/i, "");

    console.log("Processing label OCR...");

    const prompt = `You are a shipping label OCR specialist. Extract ALL readable text from the provided shipping/package label image.

Focus on extracting:
- Sender/shipper name (REMIMENTE, DE, SOLD BY, VENDIDO POR)
- Recipient name (DESTINATARIO, PARA, NOME)
- Address (ENDERECO, RUA, AVENIDA)
- Apartment/unit (APT, APARTAMENTO, BLOCO, CASA)
- City and state (CIDADE, UF)
- CEP/ZIP code
- Phone number (FONE, TELEFONE, CELULAR)
- Tracking code (código de rastreio, código de barras alfanumérico)
- Shipping company (Mercado Livre, Amazon, Loggi, Correios, Jadlog, Sequoia, Total Express, Intelipost, etc.)
- Package type/weight if visible

Output ALL text exactly as printed on the label, line by line. Do not summarize or interpret - just extract the raw text as accurately as possible. Include everything: logos, headers, barcodes numbers, etc.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const errorText = await response.text();
      console.error("Gemini API error:", response.status, errorText);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const result = await response.json();
    const extractedText = result?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("") || "";

    console.log(`Label OCR extracted ${extractedText.length} characters`);

    return new Response(
      JSON.stringify({ text: extractedText }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("label-ocr error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});