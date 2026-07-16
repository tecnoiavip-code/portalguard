import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listResidentsTool from "./tools/list-residents";
import listAccessEntriesTool from "./tools/list-access-entries";
import listMailsTool from "./tools/list-mails";
import listAnnouncementsTool from "./tools/list-announcements";

// The OAuth issuer must be the direct Supabase host, built from the project ref
// (Vite inlines VITE_SUPABASE_PROJECT_ID as a literal at build time — import-safe).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "portalguard-mcp",
  title: "PortalGuard MCP",
  version: "0.1.0",
  instructions:
    "Ferramentas do PortalGuard (portaria de condomínio). Após conectar via OAuth, use `whoami` para confirmar a identidade. Ferramentas de leitura respeitam o RLS do usuário autenticado: `list_residents`, `list_access_entries`, `list_mails`, `list_announcements`.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    whoamiTool,
    listResidentsTool,
    listAccessEntriesTool,
    listMailsTool,
    listAnnouncementsTool,
  ],
});
