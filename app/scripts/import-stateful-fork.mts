// Imports an unlisted TapeOut circuit WITH MEMORY at a Safe's first install, on a local fork of X Layer, with the exact
// calls of Limits → Add a circuit (importSchema, importStatefulPlan): circuit 2.2.364 (processor #364 "TapeWeave", not
// ours; 1 state bit: input 0 = 1 flips it and the output is the new bit), mapped in0 = always 1, in1 = always 0, run by
// Tick with a 1-day period next to a base max per buy. Then: the first transaction in the period is allowed, the second
// is refused, and the next period allows again. Sends nothing to mainnet.
//   anvil --fork-url https://rpc.xlayer.tech --port 8556 --auto-impersonate &
//   cd app && npx tsx scripts/import-stateful-fork.mts http://127.0.0.1:8556
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createTestClient, createWalletClient, decodeErrorResult, decodeFunctionResult, getAddress, http, parseAbi, type Address, type Hex } from "viem";
import { PinRegistryArtifact, schemaHash, type SchemaFile } from "@fengce/sdk";
import prepared from "../../deployments/limits-xlayer-196.json" with { type: "json" };
import { ENGINE, TOKENS, createSafeCalldata, execCalldata, multiSend, swapCalls } from "../src/fengce/engine";
import { describe, type Circuit } from "../src/fengce/circuitIndex";
import { importSchema, importStatefulPlan } from "../src/fengce/importInstall";
import { V3 } from "../src/fengce/v3";

const rpc = process.argv[2] ?? "http://127.0.0.1:8556";
const chain = { id: 196, name: "X Layer fork", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;
const pc = createPublicClient({ chain, transport: http(rpc, { timeout: 180_000 }) });
const test = createTestClient({ chain, mode: "anvil", transport: http(rpc, { timeout: 180_000 }) });
let failed = 0;
const check = (ok: boolean, what: string) => (console.log(`${ok ? "ok  " : "FAIL"} ${what}`), ok || failed++);

// the circuit, from the index
const idx = JSON.parse(readFileSync(resolve(import.meta.dirname, "../public/circuits-index.json"), "utf8"));
const row = idx.circuits.find((r: number[]) => r[0] === 364 && r[1] === 2);
const c: Circuit = { p: 364, cpu: getAddress(idx.processors[364]) as Address, id: 2, nIn: row[2], nOut: row[3], nState: row[4], gates: row[5], app: row[6] === 1, tt: row[7], tape: "2.2.364" };
console.log(`circuit ${c.tape} on ${c.cpu}: ${describe(c)}, ${c.gates} gates, memory ${c.nState} bit(s)`);
check(c.nState === 1 && !c.app, "index: a circuit with memory, not a DeWeb app");
const netlist = (await pc.readContract({ address: c.cpu, abi: parseAbi(["function netlist(uint256) view returns (bytes)"]), functionName: "netlist", args: [2n] })) as Hex;
const schema = importSchema(c, netlist, [{ kind: "one" }, { kind: "zero" }], V3!.guard) as SchemaFile;
check(!("error" in schema), "mapping: in0 = always 1, in1 = always 0");

const owner = getAddress(`0x${(Date.now() * 11).toString(16).padStart(40, "c")}`.slice(0, 42)) as Address;
await test.setBalance({ address: owner, value: 10n ** 18n });
const w = createWalletClient({ chain, account: owner, transport: http(rpc, { timeout: 180_000 }) });
const data = createSafeCalldata(owner, BigInt(Date.now()));
const ret = await pc.call({ account: owner, to: ENGINE.safeFactory, data });
const safe = decodeFunctionResult({ abi: parseAbi(["function createProxyWithNonce(address,bytes,uint256) returns (address)"]), functionName: "createProxyWithNonce", data: ret.data! }) as Address;
await pc.waitForTransactionReceipt({ hash: await w.sendTransaction({ to: ENGINE.safeFactory, data }) });

const regAbi = PinRegistryArtifact.abi as any;
const { result: pinId } = await pc.simulateContract({ account: safe, address: ENGINE.pinRegistry, abi: regAbi, functionName: "pin", args: [c.cpu, 2n, schemaHash(schema), `0x${"0".repeat(64)}`] });
const plan = importStatefulPlan({ safe, circuit: c, schema, pinId: pinId as Hex, pinned: false, fengceSet: false, period: 86_400n, baseMaxPerBuy: 5_000_000n, prepared: prepared as never });
check(plan.batch[0].label.startsWith("Pin circuit") && plan.batch.some((x) => x.label.includes("Tick.createGroup")), `one signature at first install: ${plan.batch.length} calls (pin, guard v3, Tick group, guard on last)`);
let refusedOnSet = "";
try {
  importStatefulPlan({ safe, circuit: c, schema, pinId: pinId as Hex, pinned: true, fengceSet: true, period: 86_400n, baseMaxPerBuy: 5_000_000n, prepared: prepared as never });
} catch (e) {
  refusedOnSet = (e as Error).message;
}
check(refusedOnSet === "Circuits with memory can only be added when a Safe's limits are first set up.", "on a Safe that already has limits: refused with the plain message");

async function exec(tx: { to: Address; data: Hex; operation: 0 | 1 }) {
  const d = execCalldata(owner, tx);
  try {
    await pc.call({ account: owner, to: safe, data: d });
  } catch (e) {
    return { ok: false, err: (e as Error).message.split("\n")[0] };
  }
  const r = await pc.waitForTransactionReceipt({ hash: await w.sendTransaction({ to: safe, data: d, gas: 15_000_000n }) });
  return { ok: r.status === "success", hash: r.transactionHash };
}
const r = await exec(multiSend(plan.batch));
check(r.ok, `pin + install executed${"err" in r ? `: ${r.err}` : ""}`);
const cfg = (await pc.readContract({ address: V3!.guard, abi: parseAbi(["function configOf(address) view returns (bool,bytes32,uint64,uint64,uint64,address,bytes32)"]), functionName: "configOf", args: [safe] })) as readonly unknown[];
const g = (await pc.readContract({ address: ENGINE.tick, abi: parseAbi(["function groupOf(bytes32) view returns (address,bytes32,uint64,uint64,uint64,bytes)"]), functionName: "groupOf", args: [cfg[6] as Hex] })) as readonly unknown[];
check(getAddress(String(cfg[5])) === ENGINE.tick && g[1] === pinId, "guard v3 runs the imported circuit through Tick (its memory kept per Safe)");

const call = { to: "0x000000000000000000000000000000000000dEaD" as Address, data: "0x" as Hex, operation: 0 as const };
const a = await exec(call);
check(a.ok, "first transaction in the period: allowed");
const b = await exec(call);
check(!b.ok, `second transaction in the period: refused (${"err" in b ? (b.err ?? "").slice(0, 80) : "sent"})`);
await test.increaseTime({ seconds: 86_400 });
await test.mine({ blocks: 1 });
const n = await exec(call);
check(n.ok, "next period: allowed again");
void TOKENS;
void swapCalls;
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
