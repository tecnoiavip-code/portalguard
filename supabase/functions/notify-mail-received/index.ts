import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@4.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

// Function to escape HTML to prevent XSS attacks
function escapeHtml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface MailNotificationRequest {
  residentId: string;
  sender: string;
  packageType: string;
  receivedAt: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const { residentId, sender, packageType, receivedAt }: MailNotificationRequest = await req.json();

    console.log("Fetching resident data for:", residentId);

    // Buscar dados do morador
    const { data: resident, error: residentError } = await supabase
      .from("residents")
      .select("name, email, apartment")
      .eq("id", residentId)
      .single();

    if (residentError || !resident) {
      console.error("Error fetching resident:", residentError);
      return new Response(
        JSON.stringify({ error: "Morador não encontrado" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    if (!resident.email) {
      console.log("Resident has no email, skipping notification");
      return new Response(
        JSON.stringify({ message: "Morador sem email cadastrado" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    console.log("Sending email to:", resident.email);

    const emailResponse = await resend.emails.send({
      from: "PortalGuard <onboarding@resend.dev>",
      to: [resident.email],
      subject: "Nova Correspondência Recebida",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #333; border-bottom: 2px solid #4F46E5; padding-bottom: 10px;">
            Nova Correspondência Recebida
          </h1>
          <p style="font-size: 16px; color: #555;">
            Olá <strong>${escapeHtml(resident.name)}</strong>,
          </p>
          <p style="font-size: 16px; color: #555;">
            Você tem uma nova correspondência aguardando retirada na portaria.
          </p>
          <div style="background-color: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>Apartamento:</strong> ${escapeHtml(resident.apartment)}</p>
            <p style="margin: 5px 0;"><strong>Remetente:</strong> ${escapeHtml(sender)}</p>
            <p style="margin: 5px 0;"><strong>Tipo:</strong> ${escapeHtml(packageType)}</p>
            <p style="margin: 5px 0;"><strong>Data de Recebimento:</strong> ${escapeHtml(new Date(receivedAt).toLocaleString('pt-BR'))}</p>
          </div>
          <p style="font-size: 14px; color: #777; margin-top: 20px;">
            Por favor, dirija-se à portaria para realizar a retirada.
          </p>
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;" />
          <p style="font-size: 12px; color: #999; text-align: center;">
            PortalGuard - Sistema de Gestão de Portaria
          </p>
        </div>
      `,
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, emailResponse }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error in notify-mail-received function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
