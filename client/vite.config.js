import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "favicon.svg", "favicon.png"],
      manifest: {
        name: "Vibe80",
        short_name: "Vibe80",
        description: "Vibe80 web client",
        theme_color: "#ee5d3b",
        background_color: "#f2ede3",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:5179",
        ws: true,
      },
      "/terminal": {
        target: "ws://localhost:5179",
        ws: true,
      },
      "/api": "http://localhost:5179",
    },
  },
});
