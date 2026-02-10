import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return new Response(JSON.stringify({ error: "Email e senha são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check if email exists in residents table
    const { data: resident, error: resError } = await supabaseAdmin
      .from("residents")
      .select("id, name, email")
      .eq("email", email)
      .maybeSingle();

    if (resError || !resident) {
      return new Response(JSON.stringify({ error: "Este email não está cadastrado como morador" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if resident already has auth account
    if (resident.id) {
      const { data: existingRes } = await supabaseAdmin
        .from("residents")
        .select("auth_user_id")
        .eq("id", resident.id)
        .maybeSingle();
      
      if (existingRes?.auth_user_id) {
        return new Response(JSON.stringify({ error: "Este morador já possui uma conta. Faça login." }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: resident.name },
    });

    if (authError) {
      return new Response(JSON.stringify({ error: authError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = authData.user.id;

    // Assign resident role
    await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "resident" });

    // Link auth user to resident
    await supabaseAdmin.from("residents").update({ auth_user_id: userId }).eq("id", resident.id);

    return new Response(JSON.stringify({ success: true, message: "Conta criada com sucesso!" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Erro interno do servidor" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
