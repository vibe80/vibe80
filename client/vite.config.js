import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
