// Assembles a Vercel Build Output (v3) directory: the static pages exactly as built in dist/ (the same files that go
// to TapeOut DeWeb) plus the public API as Node functions. Run after `vite build`.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.env.VERCEL_OUTPUT ?? resolve(app, "../.vercel/output"));
const FUNCTIONS = ["catalog", "circuit", "safe", "simulate", "install", "preflight"];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(resolve(app, "dist"), resolve(out, "static"), { recursive: true });

for (const name of FUNCTIONS) {
  const dir = resolve(out, `functions/api/${name}.func`);
  await build({
    configFile: false,
    logLevel: "warn",
    resolve: { alias: { "@fengce/sdk": resolve(app, "../sdk/src/index.ts") } },
    ssr: { noExternal: true },
    build: {
      ssr: resolve(app, `api-src/${name}.ts`),
      outDir: dir,
      emptyOutDir: true,
      target: "node22",
      minify: false,
      rollupOptions: { output: { format: "esm", entryFileNames: "index.mjs", inlineDynamicImports: true } },
    },
  });
  writeFileSync(resolve(dir, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(
    resolve(dir, ".vc-config.json"),
    JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: true, maxDuration: 60 }, null, 2),
  );
}

writeFileSync(
  resolve(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        // getfengce.vercel.app is the main domain. The old name redirects every page to the same path there; the HTTP
        // API keeps answering on both names (vercel.json has the same rule for git-based deploys; this prebuilt output
        // does not read vercel.json).
        { src: "^/(?!api/)(.*)$", has: [{ type: "host", value: "getokun.vercel.app" }], status: 308, headers: { Location: "https://getfengce.vercel.app/$1" } },
        { src: "^/api/circuit/([^/]+)/([^/]+)/?$", dest: "/api/circuit?processor=$1&id=$2" },
        { src: "^/api/safe/([^/]+)/?$", dest: "/api/safe?address=$1" },
        // Safe{Wallet} reads the manifest and icon from its own origin when the app is added as a custom app
        { src: "^/(manifest\\.json|favicon\\.svg)$", headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "X-Requested-With, content-type, Authorization" }, continue: true },
        { handle: "filesystem" },
      ],
    },
    null,
    2,
  ),
);
writeFileSync(resolve(out, "builds.json"), JSON.stringify({ target: "production", argv: [], builds: [] }, null, 2));
console.log(`Build Output written to ${out}: static (${FUNCTIONS.length} functions)`);
