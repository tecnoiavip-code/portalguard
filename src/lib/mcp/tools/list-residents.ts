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
  name: "list_residents",
  title: "List residents",
  description:
    "List residents visible to the signed-in user (RLS-scoped). Optionally filter by apartment or name substring.",
  inputSchema: {
    apartment: z.string().trim().optional().describe("Filter by exact apartment identifier."),
    search: z.string().trim().optional().describe("Case-insensitive substring match on the resident name."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows to return (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ apartment, search, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    let q = sb(ctx)
      .from("residents")
      .select("id,name,apartment,block,phone,email,vehicle_plate")
      .order("apartment", { ascending: true })
      .limit(limit ?? 25);
    if (apartment) q = q.eq("apartment", apartment);
    if (search) q = q.ilike("name", `%${search}%`);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { residents: data ?? [] },
    };
  },
});
