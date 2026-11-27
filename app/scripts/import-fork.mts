// Imports a TapeOut circuit that is not in the Fengce Catalog, on a local fork of X Layer, with the exact calls of
// Limits → Add a circuit (importSchema, importPlan): circuit 1.2.131 (a NAND on processor #131, not ours), input 0 =
// amount over 1 USDT0, input 1 = token paid is USDT0; pinned and installed with guard v3 on a fresh Safe in one
// signature; then a 0.2 USDT0 swap is allowed and a 3 USDT0 swap is refused. Sends nothing to mainnet.
//   anvil --fork-url https://rpc.xlayer.tech --port 8555 --auto-impersonate &
//   cd app && npx tsx scripts/import-fork.mts http://127.0.0.1:8555
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createTestClient, createWalletClient, decodeErrorResult, decodeFunctionResult, getAddress, http, parseAbi, type Address, type Hex } from "viem";
import { PinRegistryArtifact, schemaHash, type SchemaFile } from "@fengce/sdk";
import prepared from "../../deployments/limits-xlayer-196.json" with { type: "json" };
import { ENGINE, TOKENS, createSafeCalldata, execCalldata, multiSend, swapCalls } from "../src/fengce/engine";
import { describe, type Circuit } from "../src/fengce/circuitIndex";
import { importPlan, importSchema } from "../src/fengce/importInstall";
import { V3 } from "../src/fengce/v3";

const rpc = process.argv[2] ?? "http://127.0.0.1:8555";
const chain = { id: 196, name: "X Layer fork", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;
const pc = createPublicClient({ chain, transport: http(rpc, { timeout: 180_000 }) });
const test = createTestClient({ chain, mode: "anvil", transport: http(rpc, { timeout: 180_000 }) });
let failed = 0;
const check = (ok: boolean, what: string) => (console.log(`${ok ? "ok  " : "FAIL"} ${what}`), ok || failed++);

// the circuit, from the index
const idx = JSON.parse(readFileSync(resolve(import.meta.dirname, "../public/circuits-index.json"), "utf8"));
const row = idx.circuits.find((r: number[]) => r[0] === 131 && r[1] === 1);
const c: Circuit = { p: 131, cpu: getAddress(idx.processors[131]) as Address, id: 1, nIn: row[2], nOut: row[3], nState: row[4], gates: row[5], app: row[6] === 1, tt: row[7], tape: "1.2.131" };
console.log(`circuit ${c.tape} on ${c.cpu}: ${describe(c)}, ${c.gates} gate(s), app: ${c.app}`);
check(c.tt === "1110" && !c.app, "index: a NAND, not a DeWeb app");
const catalog = parseAbi(["function count() view returns (uint256)"]);
void catalog;

const netlist = (await pc.readContract({ address: c.cpu, abi: parseAbi(["function netlist(uint256) view returns (bytes)"]), functionName: "netlist", args: [1n] })) as Hex;
const schema = importSchema(c, netlist, [{ kind: "amountGt", usdt0: "1" }, { kind: "tokenIs", token: "USDT0" }], V3!.guard) as SchemaFile;
check(!("error" in schema), "mapping: in0 = amount over 1 USDT0, in1 = token paid is USDT0");

// fresh owner and Safe
const owner = getAddress(`0x${(Date.now() * 7).toString(16).padStart(40, "b")}`.slice(0, 42)) as Address;
await test.setBalance({ address: owner, value: 10n ** 18n });
const w = createWalletClient({ chain, account: owner, transport: http(rpc, { timeout: 180_000 }) });
const data = createSafeCalldata(owner, BigInt(Date.now()));
const ret = await pc.call({ account: owner, to: ENGINE.safeFactory, data });
const safe = decodeFunctionResult({ abi: parseAbi(["function createProxyWithNonce(address,bytes,uint256) returns (address)"]), functionName: "createProxyWithNonce", data: ret.data! }) as Address;
await pc.waitForTransactionReceipt({ hash: await w.sendTransaction({ to: ENGINE.safeFactory, data }) });

// pin id (simulated) and the plan
const regAbi = PinRegistryArtifact.abi as any;
const { result: pinId } = await pc.simulateContract({ account: safe, address: ENGINE.pinRegistry, abi: regAbi, functionName: "pin", args: [c.cpu, 1n, schemaHash(schema), `0x${"0".repeat(64)}`] });
const plan = importPlan({ safe, circuit: c, schema, pinId: pinId as Hex, pinned: false, fengceSet: false, guard: V3!.guard, prepared: prepared as never });
check(plan.ownerPin === null && plan.schedule === null && plan.batch[0].label.startsWith("Pin circuit"), `one signature: ${plan.batch.length} calls (pin first, guard turned on last)`);

async function exec(tx: { to: Address; data: Hex; operation: 0 | 1 }) {
  const d = execCalldata(owner, tx);
  try {
    await pc.call({ account: owner, to: safe, data: d });
  } catch (e) {
    let x: any = e, err = (e as Error).message.split("\n")[0];
    for (let k = 0; k < 8 && x; k++) {
      const raw = typeof x.data === "string" ? x.data : x.data?.data;
      if (typeof raw === "string" && raw.startsWith("0xc7568655")) err = `FengceRefused(code ${Number(BigInt(`0x${raw.slice(10, 74)}`))})`;
      x = x.cause;
    }
    return { ok: false, err };
  }
  const r = await pc.waitForTransactionReceipt({ hash: await w.sendTransaction({ to: safe, data: d, gas: 15_000_000n }) });
  return { ok: r.status === "success", hash: r.transactionHash };
}
const r = await exec(multiSend(plan.batch));
check(r.ok, `pin + install executed${"err" in r ? `: ${r.err}` : ""}`);
const cfg = (await pc.readContract({ address: V3!.guard, abi: parseAbi(["function configOf(address) view returns (bool,bytes32,uint64,uint64,uint64,address,bytes32)"]), functionName: "configOf", args: [safe] })) as readonly unknown[];
check(cfg[0] === true && cfg[1] === pinId, "guard v3 runs the imported circuit as the Safe's policy");
const pinned = (await pc.readContract({ address: ENGINE.pinRegistry, abi: regAbi, functionName: "circuitPin", args: [pinId] })) as { processor: Address; circuitId: bigint };
check(getAddress(pinned.processor) === c.cpu && pinned.circuitId === 1n, "PinRegistry: the pin is circuit 1 on processor #131");

// fund the Safe with 5 USDT0 from the USDT0/WOKB pool
const router = parseAbi(["function factory() view returns (address)"]);
const fac = (await pc.readContract({ address: ENGINE.router, abi: router, functionName: "factory" })) as Address;
const pool = (await pc.readContract({ address: fac, abi: parseAbi(["function getPool(address,address,uint24) view returns (address)"]), functionName: "getPool", args: [TOKENS.USDT0.address, TOKENS.WOKB.address, 500] })) as Address;
await test.setBalance({ address: pool, value: 10n ** 17n });
const pw = createWalletClient({ chain, account: pool, transport: http(rpc, { timeout: 180_000 }) });
await pc.waitForTransactionReceipt({ hash: await pw.writeContract({ address: TOKENS.USDT0.address, abi: parseAbi(["function transfer(address,uint256) returns (bool)"]), functionName: "transfer", args: [safe, 5_000_000n] }) });

const small = await exec(multiSend(swapCalls(safe, TOKENS.USDT0.address, TOKENS.WOKB.address, 200_000n, 0n)));
check(small.ok, `swap 0.2 USDT0 → OKB: allowed${"err" in small ? ` (${small.err})` : ""}`);
const big = await exec(multiSend(swapCalls(safe, TOKENS.USDT0.address, TOKENS.WOKB.address, 3_000_000n, 0n)));
check(!big.ok && "err" in big && /code 1\b/.test(big.err!), `swap 3 USDT0 → OKB: refused (${"err" in big ? big.err : "sent"})`);
void decodeErrorResult;
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
