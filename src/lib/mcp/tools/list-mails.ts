/// <reference types="node" />
import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function sb(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_mails",
  title: "List mail/correspondence",
  description:
    "List correspondence items visible to the signed-in user (RLS-scoped). Optionally filter by apartment or pickup status.",
  inputSchema: {
    apartment: z.string().trim().optional(),
    picked_up: z.boolean().optional().describe("If set, filter by pickup status."),
    limit: z.number().int().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ apartment, picked_up, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    let q = sb(ctx)
      .from("mails")
      .select("id,apartment,resident_name,mail_type,description,received_at,picked_up,picked_up_at")
      .order("received_at", { ascending: false })
      .limit(limit ?? 25);
    if (apartment) q = q.eq("apartment", apartment);
    if (typeof picked_up === "boolean") q = q.eq("picked_up", picked_up);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { mails: data ?? [] },
    };
  },
});
