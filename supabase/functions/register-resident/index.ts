import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return jsonResponse({ error: "Email e senha são obrigatórios" });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check if email exists in residents table (case-insensitive)
    const { data: resident, error: resError } = await supabaseAdmin
      .from("residents")
      .select("id, name, email, auth_user_id")
      .ilike("email", email.trim())
      .maybeSingle();

    if (resError || !resident) {
      return jsonResponse({ error: "Este email não está cadastrado como morador. Verifique com a portaria se seu email está correto." });
    }

    // Check if resident already has auth account
    if (resident.auth_user_id) {
      return jsonResponse({ error: "Este morador já possui uma conta. Faça login ou use 'Esqueci minha senha'." });
    }

    // Create auth user (email always lowercase)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password,
      email_confirm: true,
      user_metadata: { full_name: resident.name },
    });

    if (authError) {
      if (authError.message.includes("already been registered")) {
        return jsonResponse({ error: "Este email já possui uma conta. Faça login ou use 'Esqueci minha senha'." });
      }
      return jsonResponse({ error: authError.message });
    }

    const userId = authData.user.id;

    // Assign resident role
    await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "resident" });

    // Link auth user to resident
    await supabaseAdmin.from("residents").update({ auth_user_id: userId }).eq("id", resident.id);

    return jsonResponse({ success: true, message: "Conta criada com sucesso!" });
  } catch (error) {
    console.error("Register resident error:", error);
    return jsonResponse({ error: "Erro interno do servidor. Tente novamente." });
  }
});
