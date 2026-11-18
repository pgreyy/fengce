// Bundles the server (with the app's chain code and the SDK) into one runnable file: dist/server.mjs.
import { chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
await build({
  configFile: false,
  logLevel: "warn",
  resolve: { alias: { "@fengce/sdk": resolve(here, "../sdk/src/index.ts") } },
  ssr: { noExternal: true },
  build: {
    ssr: resolve(here, "src/server.ts"),
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
    target: "node20",
    minify: false,
    rollupOptions: { output: { format: "esm", entryFileNames: "server.mjs", inlineDynamicImports: true, banner: "#!/usr/bin/env node" } },
  },
});
chmodSync(resolve(here, "dist/server.mjs"), 0o755);
console.log("built dist/server.mjs");
