import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";
import canonicalSupabase from "./config/supabase.json";

const SUPABASE_KEYS = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PROJECT_ID",
] as const;

const isLocalSupabase = (url: string) => /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:|\/|$)/i.test(url);
const refFromUrl = (url: string) => url.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.co/i)?.[1] ?? "";

/**
 * O "Lovable update" reescreve o arquivo .env com o projeto Supabase antigo, o que
 * quebrava o app em producao. A config canonica em config/supabase.json tem
 * precedencia sempre que o .env apontar para outro projeto ou estiver ausente.
 * URLs locais (scripts/start-local.js via .env.local) sao preservadas.
 */
function resolveSupabaseEnv(mode: string): Record<string, string> {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const resolved: Record<string, string> = {};
  const injectedUrl = (env.VITE_SUPABASE_URL ?? "").trim();
  const usesLocalStack = isLocalSupabase(injectedUrl);
  const urlIsStale = injectedUrl.length > 0 && !usesLocalStack && refFromUrl(injectedUrl) !== canonicalSupabase.projectId;

  for (const key of SUPABASE_KEYS) resolved[key] = (env[key] ?? "").trim();

  if (!usesLocalStack && (!injectedUrl || urlIsStale)) {
    resolved.VITE_SUPABASE_URL = canonicalSupabase.url;
    resolved.VITE_SUPABASE_PUBLISHABLE_KEY = canonicalSupabase.publishableKey;
    resolved.VITE_SUPABASE_PROJECT_ID = canonicalSupabase.projectId;
    const motivo = injectedUrl ? `project ref divergente (${injectedUrl})` : "VITE_SUPABASE_URL ausente";
    console.warn(`[portalguard] Config do Supabase corrigida em tempo de build: ${motivo}. Usando config/supabase.json.`);
  }

  return resolved;
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const supabaseEnv = resolveSupabaseEnv(mode);

  return {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseEnv.VITE_SUPABASE_URL),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabaseEnv.VITE_SUPABASE_PUBLISHABLE_KEY),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(supabaseEnv.VITE_SUPABASE_PROJECT_ID),
    },
    server: {
      host: "::",
      port: 8080,
    },
  plugins: [
    react(),
    mcpPlugin(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: { enabled: false },
      includeAssets: ["favicon.ico", "pwa-icon-192.png", "pwa-icon-512.png"],
      manifest: {
        name: "Portal do Morador - PortalGuard",
        short_name: "Portal Morador",
        description: "Acesse seu condomínio na palma da mão",
        theme_color: "#1e40af",
        background_color: "#d4e8fb",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/morador",
        icons: [
          { src: "/pwa-icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        skipWaiting: true,
        clientsClaim: true,
        navigateFallbackDenylist: [/^\/~oauth/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*supabase.*$/,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-cache",
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  optimizeDeps: {
    include: ['pdfjs-dist', 'react', 'react-dom', 'react/jsx-runtime', 'next-themes', 'react-router-dom'],
  },
  build: {
    target: 'es2022',
  },
  };
});
