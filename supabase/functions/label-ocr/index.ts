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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const { imageBase64 } = await req.json();

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "imageBase64 is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("Processing label OCR...");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a shipping label OCR specialist. Extract ALL readable text from the provided shipping/package label image.

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

Output ALL text exactly as printed on the label, line by line. Do not summarize or interpret - just extract the raw text as accurately as possible. Include everything: logos, headers, barcodes numbers, etc.`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract all text from this shipping/package label. Return the raw text line by line.",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const result = await response.json();
    const extractedText = result.choices?.[0]?.message?.content || "";

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