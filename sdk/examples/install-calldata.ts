/**
 * Read-only: build the three Safe transactions that install Fengce on a Safe (configure,
 * setGuard, setModuleGuard) and the equivalent MultiSendCallOnly batch. Nothing is sent.
 *   npx tsx examples/install-calldata.ts <safe> <guard> <pinId> [rpc]
 * The pinId must be a pin of the circuit in nand-limit.schema.json, made with its schemaHash.
 */
import { readFileSync } from "node:fs";
import { createPublicClient, getAddress, http, type Hex } from "viem";
import { buildInstall, parseSchema } from "../src/index.js";

const [safe, guard, pinId, rpc = "https://rpc.xlayer.tech"] = process.argv.slice(2);
if (!safe || !guard || !pinId) throw new Error("usage: install-calldata.ts <safe> <guard> <pinId> [rpc]");
const client = createPublicClient({ transport: http(rpc) });
const schema = parseSchema(readFileSync(new URL("./nand-limit.schema.json", import.meta.url), "utf8"));

const { calls, multiSend } = await buildInstall(client as any, {
  safe: getAddress(safe),
  guard: getAddress(guard),
  pinId: pinId as Hex,
  schema,
  recoveryDelay: 86_400n, // 1 day
  recoveryWindow: 172_800n, // 2 days
  adminDelay: 86_400n, // 1 day
});
for (const c of calls) console.log(`${c.description}\n  to ${c.to}\n  data ${c.data}\n`);
console.log(`${multiSend.description} (operation 1 = delegatecall)\n  to ${multiSend.to}\n  data ${multiSend.data}`);
