import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    middlewareMode: false,
    proxy: {
      '/auth/v1': {
        target: 'https://kxdqffkkufgsizszchvw.supabase.co',
        changeOrigin: true,
        rewrite: (path) => path,
      },
      '/rest/v1': {
        target: 'https://kxdqffkkufgsizszchvw.supabase.co',
        changeOrigin: true,
        rewrite: (path) => path,
      },
      '/realtime/v1': {
        target: 'https://kxdqffkkufgsizszchvw.supabase.co',
        changeOrigin: true,
        rewrite: (path) => path,
        ws: true,
      },
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
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
          {
            src: "/pwa-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
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
  },
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  build: {
    target: 'es2022',
  },
}));
