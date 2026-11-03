import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  root: fileURLToPath(new URL("./src", import.meta.url)),
  // Read the project .env, exposing only VITE_ variables to the browser.
  envDir: fileURLToPath(new URL("..", import.meta.url)),
  resolve: {
    alias: {
      "@client": fileURLToPath(new URL("./src", import.meta.url)),
      "@lib": fileURLToPath(new URL("../lib", import.meta.url)),
    },
  },
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
