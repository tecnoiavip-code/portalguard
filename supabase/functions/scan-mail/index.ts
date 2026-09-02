import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY não configurada");

    const body = await req.json().catch(() => ({}));
    const imageBase64: string | undefined = body?.imageBase64;
    const residents: Array<{ name: string; apartment: string }> = Array.isArray(body?.residents)
      ? body.residents.slice(0, 400)
      : [];

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return new Response(JSON.stringify({ error: "imageBase64 é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = imageBase64.startsWith("data:")
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    const residentsList = residents
      .map((r) => `${r.name} | ${r.apartment}`)
      .join("\n");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          {
            role: "system",
            content:
              "Você lê etiquetas de encomendas e cartas brasileiras (Correios, Amazon, Mercado Livre, Shopee, transportadoras). " +
              "Extraia os dados do destinatário e do remetente da imagem e responda SOMENTE com a função extract_mail.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Extraia os dados desta etiqueta.\n" +
                  "Se houver correspondência com um morador da lista abaixo (nome parecido e/ou apartamento), retorne exatamente o nome e o apartamento como estão na lista.\n" +
                  (residentsList ? `Moradores cadastrados (NOME | APARTAMENTO):\n${residentsList}` : "Sem lista de moradores."),
              },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_mail",
              description: "Retorna os dados extraídos da etiqueta da correspondência",
              parameters: {
                type: "object",
                properties: {
                  recipientName: { type: "string", description: "Nome do destinatário" },
                  apartment: { type: "string", description: "Apartamento/unidade do destinatário" },
                  sender: { type: "string", description: "Remetente / loja / transportadora" },
                  trackingCode: { type: "string", description: "Código de rastreio" },
                  packageType: {
                    type: "string",
                    enum: ["Carta", "Pacote Pequeno", "Pacote Médio", "Pacote Grande"],
                  },
                  notes: { type: "string", description: "Outras informações relevantes" },
                },
                required: ["recipientName", "sender", "packageType"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_mail" } },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("AI gateway error", response.status, text);
      const message =
        response.status === 429
          ? "Muitas solicitações. Tente novamente em instantes."
          : response.status === 402
          ? "Créditos de IA esgotados. Adicione créditos para continuar."
          : "Falha ao processar a imagem.";
      return new Response(JSON.stringify({ error: message }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await response.json();
    const call = result.choices?.[0]?.message?.tool_calls?.[0];
    let data: Record<string, unknown> = {};
    if (call?.function?.arguments) {
      try {
        data = JSON.parse(call.function.arguments);
      } catch (_) {
        data = {};
      }
    }

    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("scan-mail error:", error);
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
