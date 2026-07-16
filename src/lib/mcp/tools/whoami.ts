import { defineTool } from "@lovable.dev/mcp-js";

export default defineTool({
  name: "whoami",
  title: "Who am I",
  description: "Return the signed-in user's ID and email as authenticated by the MCP OAuth token.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            user_id: ctx.getUserId(),
            email: ctx.getUserEmail(),
            client_id: ctx.getClientId(),
          }),
        },
      ],
      structuredContent: {
        user_id: ctx.getUserId(),
        email: ctx.getUserEmail(),
      },
    };
  },
});
