/**
 * Quote CLI.
 *   npx tsx src/cli/quote.ts <processor> <circuitId> [--rpc URL] [--port N] [--out FILE]
 * Starts an anvil fork of X Layer, builds the certificate (see ../quote.ts), prints the JSON and
 * stops anvil. Needs `anvil` on PATH and `forge build` output in ../out.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { XLAYER } from "../abi.js";
import { canonicalJson, quote } from "../quote.js";

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
}

async function main() {
  const [processor, id] = process.argv.slice(2);
  if (!processor || !id) throw new Error("usage: quote.ts <processor> <circuitId> [--rpc URL] [--port N] [--out FILE]");
  const rpc = arg("--rpc", XLAYER.rpc)!;
  const port = arg("--port", "8547")!;
  const out = arg("--out");
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(here, "../../../out");

  const anvil = spawn("anvil", ["--fork-url", rpc, "--port", port, "--silent"], { stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`;
  try {
    const fork = createPublicClient({ transport: http(url) });
    for (let i = 0; ; i++) {
      try {
        await fork.getBlockNumber();
        break;
      } catch {
        if (i > 120) throw new Error("anvil did not start");
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    const [account] = await fork.request({ method: "eth_accounts" } as any) as string[];
    const wallet = createWalletClient({ transport: http(url) });
    const result = await quote({ fork: fork as any, wallet, account: getAddress(account), outDir }, getAddress(processor), BigInt(id));
    const text = JSON.stringify(JSON.parse(canonicalJson(result)), null, 2);
    if (out) writeFileSync(out, text + "\n");
    console.log(text);
  } finally {
    anvil.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
