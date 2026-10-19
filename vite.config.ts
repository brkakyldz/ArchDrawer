import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { buildId } from "./scripts/build-id.mjs";

export default defineConfig({
  plugins: [react()],
  // The page knows the code it was built from; the editor compares it with the server's (PER-4).
  define: { __ARCHDRAW_BUILD__: JSON.stringify(buildId(fileURLToPath(new URL(".", import.meta.url)))) },
  publicDir: "src/web/public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:4317" },
  },
});
