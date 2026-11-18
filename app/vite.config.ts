import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Static multi-page build. Every page is its own HTML file (no client-side routing) and every asset path is
 * relative (base "./"), so the same dist/ runs on Vercel and on TapeOut DeWeb. */
export const PAGES = ["index", "simulator/index", "install/index", "safe/index", "wallets/index", "policy/index"];

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@fengce/sdk": resolve(__dirname, "../sdk/src/index.ts") } },
  server: { fs: { allow: [resolve(__dirname, "..")] } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: Object.fromEntries(PAGES.map((p) => [p, resolve(__dirname, `${p}.html`)])) },
  },
});
