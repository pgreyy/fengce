// Adds Fengce Catalog circuits to fresh Safes on a local fork of X Layer, with the exact calls the Limits → Add a circuit
// sheet sends (catalogPlan), then checks the result on chain. Sends nothing to mainnet.
//
//   anvil --fork-url https://rpc.xlayer.tech --port 8551 --auto-impersonate &
//   cd app && npx tsx scripts/catalog-fork.mts http://127.0.0.1:8551
import { createPublicClient, createTestClient, createWalletClient, decodeFunctionResult, getAddress, http, keccak256, parseAbi, parseEventLogs, type Address, type Hex } from "viem";
import { CatalogArtifact, FengceGuardArtifact, PinRegistryArtifact, TickArtifact, readCatalog, parseSchema } from "@fengce/sdk";
import deployment from "../../deployments/xlayer-196-v2.json" with { type: "json" };
import prepared from "../../deployments/limits-xlayer-196.json" with { type: "json" };
import { catalogPlan } from "../src/fengce/catalogInstall";
import { ENGINE, createSafeCalldata, execCalldata, multiSend } from "../src/fengce/engine";
import { presetFor } from "../src/lib/policies";

const rpc = process.argv[2] ?? "http://127.0.0.1:8551";
const chain = { id: 196, name: "X Layer fork", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;
const pc = createPublicClient({ chain, transport: http(rpc, { timeout: 180_000 }) });
const test = createTestClient({ chain, mode: "anvil", transport: http(rpc, { timeout: 180_000 }) });
const CATALOG = getAddress(deployment.contracts.Catalog);
const factoryAbi = parseAbi(["function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)"]);
const cpuAbi = parseAbi(["function netlist(uint256 id) view returns (bytes)"]);

let failed = 0;
const check = (ok: boolean, what: string) => (console.log(`${ok ? "ok  " : "FAIL"} ${what}`), ok || failed++);

async function freshSafe(tag: string) {
  const owner = getAddress(keccak256(new TextEncoder().encode(`fengce.catalog-fork.${tag}.${Date.now()}`)).slice(0, 42)) as Address;
  await test.setBalance({ address: owner, value: 10n ** 18n });
  const w = createWalletClient({ chain, account: owner, transport: http(rpc, { timeout: 180_000 }) });
  const data = createSafeCalldata(owner, BigInt(Date.now()));
  const ret = await pc.call({ account: owner, to: ENGINE.safeFactory, data });
  const safe = decodeFunctionResult({ abi: factoryAbi, functionName: "createProxyWithNonce", data: ret.data! }) as Address;
  await pc.waitForTransactionReceipt({ hash: await w.sendTransaction({ to: ENGINE.safeFactory, data }) });
  return { owner, safe, w };
}

async function execSafe(s: Awaited<ReturnType<typeof freshSafe>>, tx: { to: Address; data: Hex; operation: 0 | 1 }, value = 0n) {
  const data = execCalldata(s.owner, tx);
  try {
    await pc.call({ account: s.owner, to: s.safe, data, value });
  } catch (e) {
    return { ok: false, err: (e as Error).message.split("\n")[0] };
  }
  const h = await s.w.sendTransaction({ to: s.safe, data, value, gas: 15_000_000n });
  const r = await pc.waitForTransactionReceipt({ hash: h });
  return { ok: r.status === "success", receipt: r, hash: h };
}

const entries = (await readCatalog(pc as never, CATALOG)).filter((e) => e.active);
console.log(`Catalog ${CATALOG}: ${entries.length} active listings (fork of block ${await pc.getBlockNumber()})`);

for (const want of [18n, 52n]) {
  const entry = await (async () => {
    for (const e of entries) {
      const c = (await pc.readContract({ address: ENGINE.pinRegistry, abi: PinRegistryArtifact.abi as never, functionName: "circuitPin", args: [e.pinId] })) as { processor: Address; circuitId: bigint };
      if (c.circuitId === want) return { e, c };
    }
  })();
  if (!entry) throw new Error(`#${want} not listed`);
  const preset = presetFor(entry.c.processor, want)!;
  const netlist = await pc.readContract({ address: entry.c.processor, abi: cpuAbi, functionName: "netlist", args: [want] });
  const schema = parseSchema({ ...preset.schema(1_000_000n), netlistHash: keccak256(netlist) });
  const s = await freshSafe(String(want));
  console.log(`\n#${want} ${preset.name} (${preset.stateful ? "stateful" : "stateless"}) → fresh Safe ${s.safe}`);
  const plan = catalogPlan({
    safe: s.safe,
    catalog: CATALOG,
    pinId: entry.e.pinId,
    installFee: entry.e.installFee,
    schema,
    stateful: !!preset.stateful,
    fengceSet: false,
    period: 86_400n,
    baseMaxPerBuy: 5_000_000n,
    prepared: prepared as never,
  });
  check(plan.batch.length > 0 && plan.schedule === null, `one signature: ${plan.batch.length} calls in one batch, fee ${plan.value} wei`);
  const r = await execSafe(s, multiSend(plan.batch), plan.value);
  if (!check(r.ok, `batch executed${"hash" in r ? ` (tx ${r.hash})` : ""}${"err" in r ? `: ${r.err}` : ""}`) || !("receipt" in r)) continue;
  const fees = parseEventLogs({ abi: CatalogArtifact.abi as any, logs: r.receipt!.logs, eventName: "FeePaid" }) as any[];
  check(fees.length === 1 && fees[0].args.pinId === entry.e.pinId && getAddress(fees[0].args.payer) === s.safe, "Catalog.payInstall ran in the batch (FeePaid from the Safe)");
  const guard = await pc.readContract({ address: s.safe, abi: parseAbi(["function getStorageAt(uint256, uint256) view returns (bytes)"]), functionName: "getStorageAt", args: [BigInt("0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8"), 1n] });
  check(getAddress(`0x${guard.slice(-40)}`) === ENGINE.guard, "Safe guard is FengceGuard");
  const cfg = (await pc.readContract({ address: ENGINE.guard, abi: FengceGuardArtifact.abi as any, functionName: "configOf", args: [s.safe] })) as unknown[];
  if (preset.stateful) {
    check(cfg[0] === true && String(cfg[1]) === prepared.maxBuyPin, "guard configured with the base max per buy pin");
    const g = (await pc.readContract({ address: ENGINE.tick, abi: TickArtifact.abi as any, functionName: "groupOf", args: [cfg[6]] })) as unknown[];
    check(getAddress(String(cfg[5])) === ENGINE.tick && g[1] === entry.e.pinId, `Tick group ${String(cfg[6]).slice(0, 10)}… runs the Catalog pin (#${want})`);
    // behaviour: one spend per period. A 0-value call through the Safe is the first spend (allowed), the second is denied.
    const call = { to: "0x000000000000000000000000000000000000dEaD" as Address, data: "0x" as Hex, operation: 0 as const };
    const a = await execSafe(s, call);
    check(a.ok, "first transaction in the period: allowed");
    const b = await execSafe(s, call);
    check(!b.ok, `second transaction in the period: refused${"err" in b ? ` (${(b.err ?? "").slice(0, 90)})` : ""}`);
    await test.increaseTime({ seconds: 86_400 });
    await test.mine({ blocks: 1 });
    const c = await execSafe(s, call);
    check(c.ok, "next period: allowed again");
  } else {
    check(cfg[0] === true && cfg[1] === entry.e.pinId, "guard runs the Catalog pin as the Safe's policy");
  }
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
