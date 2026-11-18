#!/usr/bin/env node
/**
 * fengce-quote: build a Quote certificate for a TapeOut circuit on X Layer.
 *
 *   fengce-quote <processor> <circuitId> [--rpc URL] [--port N] [--out FILE]
 *                [--input 0xBYTES] [--schema FILE --values JSON]
 *
 * Starts a local anvil fork (needs `anvil` from Foundry on PATH), deploys PinRegistry and
 * FengceGuard on the fork, measures gas on the real Safe -> guard -> circuit path, prints the
 * certificate JSON and stops anvil. Nothing is sent to the real chain.
 * --input / --schema: probe input to use when the circuit denies all-zero input.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, getAddress, http, type Hex } from "viem";
import { XLAYER } from "../abi.js";
import { canonicalJson, quote, type QuoteOptions } from "../quote.js";
import { parseSchema } from "../schema.js";

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
}

const USAGE = "usage: fengce-quote <processor> <circuitId> [--rpc URL] [--port N] [--out FILE] [--input 0xBYTES] [--schema FILE --values JSON]";

async function main() {
  const [processor, id] = process.argv.slice(2);
  if (!processor || !id || processor.startsWith("--")) throw new Error(USAGE);
  const rpc = arg("--rpc", XLAYER.rpc)!;
  const port = arg("--port", "8547")!;
  const out = arg("--out");
  const opts: QuoteOptions = {};
  const input = arg("--input");
  const schemaFile = arg("--schema");
  if (input) opts.input = input as Hex;
  if (schemaFile) {
    opts.schema = parseSchema(readFileSync(schemaFile, "utf8"));
    opts.values = JSON.parse(arg("--values", "{}")!);
  }

  const anvil = spawn("anvil", ["--fork-url", rpc, "--port", port, "--silent"], { stdio: "ignore" });
  anvil.on("error", (e) => {
    console.error(`could not start anvil (install Foundry): ${e.message}`);
    process.exit(1);
  });
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
    const [account] = (await fork.request({ method: "eth_accounts" } as any)) as string[];
    const wallet = createWalletClient({ transport: http(url) });
    const result = await quote({ fork: fork as any, wallet, account: getAddress(account) }, getAddress(processor), BigInt(id), opts);
    const text = JSON.stringify(JSON.parse(canonicalJson(result)), null, 2);
    if (out) writeFileSync(out, text + "\n");
    console.log(text);
  } finally {
    anvil.kill();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
