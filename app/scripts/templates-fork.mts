// Limits → Templates on a local fork of X Layer: installs Admin key guard, Vault and Treasury on fresh Safes with the
// exact calls of the page (templateCalls), then shows one allowed and one refused transaction for each. Sends nothing to
// mainnet.
//   anvil --fork-url https://rpc.xlayer.tech --port 8557 --auto-impersonate &
//   cd app && npx tsx scripts/templates-fork.mts http://127.0.0.1:8557
import { createPublicClient, createTestClient, createWalletClient, decodeFunctionResult, encodeFunctionData, getAddress, http, keccak256, parseAbi, type Address, type Hex } from "viem";
import { PinRegistryArtifact, parseSchema, readCatalog } from "@fengce/sdk";
import deployment from "../../deployments/xlayer-196-v2.json" with { type: "json" };
import prepared from "../../deployments/limits-xlayer-196.json" with { type: "json" };
import { ENGINE, TOKENS, createSafeCalldata, execCalldata, multiSend } from "../src/fengce/engine";
import { presetFor } from "../src/lib/policies";
import { templateCalls, type TemplateKey } from "../src/fengce/templates";

const rpc = process.argv[2] ?? "http://127.0.0.1:8557";
const chain = { id: 196, name: "X Layer fork", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;
const pc = createPublicClient({ chain, transport: http(rpc, { timeout: 180_000 }) });
const test = createTestClient({ chain, mode: "anvil", transport: http(rpc, { timeout: 180_000 }) });
let failed = 0;
const check = (ok: boolean, what: string) => (console.log(`${ok ? "ok  " : "FAIL"} ${what}`), ok || failed++);
const erc20 = parseAbi(["function transfer(address,uint256) returns (bool)"]);

// #18 (Periodic Spending Budget) from the Catalog, with its schema
const entries = (await readCatalog(pc as never, getAddress(deployment.contracts.Catalog))).filter((e) => e.active);
let budget: { pinId: Hex; schema: any; period: bigint } | null = null;
for (const e of entries) {
  const c = (await pc.readContract({ address: ENGINE.pinRegistry, abi: PinRegistryArtifact.abi as never, functionName: "circuitPin", args: [e.pinId] })) as { processor: Address; circuitId: bigint };
  if (c.circuitId === 18n) {
    const p = presetFor(c.processor, 18n)!;
    const netlist = (await pc.readContract({ address: c.processor, abi: parseAbi(["function netlist(uint256) view returns (bytes)"]), functionName: "netlist", args: [18n] })) as Hex;
    budget = { pinId: e.pinId, schema: parseSchema({ ...p.schema(0n), netlistHash: keccak256(netlist) }), period: 86_400n };
  }
}

// USDT0 from the USDT0/WOKB pool
const fac = (await pc.readContract({ address: ENGINE.router, abi: parseAbi(["function factory() view returns (address)"]), functionName: "factory" })) as Address;
const pool = (await pc.readContract({ address: fac, abi: parseAbi(["function getPool(address,address,uint24) view returns (address)"]), functionName: "getPool", args: [TOKENS.USDT0.address, TOKENS.WOKB.address, 500] })) as Address;
await test.setBalance({ address: pool, value: 10n ** 17n });
const pw = createWalletClient({ chain, account: pool, transport: http(rpc, { timeout: 180_000 }) });

let n = 0;
async function freshSafe() {
  const owner = getAddress(`0x${(Date.now() * 13 + ++n).toString(16).padStart(40, "d")}`.slice(0, 42)) as Address;
  await test.setBalance({ address: owner, value: 10n ** 18n });
  const w = createWalletClient({ chain, account: owner, transport: http(rpc, { timeout: 180_000 }) });
  const data = createSafeCalldata(owner, BigInt(Date.now() + n));
  const ret = await pc.call({ account: owner, to: ENGINE.safeFactory, data });
  const safe = decodeFunctionResult({ abi: parseAbi(["function createProxyWithNonce(address,bytes,uint256) returns (address)"]), functionName: "createProxyWithNonce", data: ret.data! }) as Address;
  await pc.waitForTransactionReceipt({ hash: await w.sendTransaction({ to: ENGINE.safeFactory, data }) });
  await pc.waitForTransactionReceipt({ hash: await pw.writeContract({ address: TOKENS.USDT0.address, abi: erc20, functionName: "transfer", args: [safe, 2_000_000n] }) });
  const exec = async (tx: { to: Address; data: Hex; operation: 0 | 1 }) => {
    const d = execCalldata(owner, tx);
    try {
      await pc.call({ account: owner, to: safe, data: d });
    } catch (e) {
      let x: any = e, err = (e as Error).message.split("\n")[0];
      for (let k = 0; k < 8 && x; k++) {
        const raw = typeof x.data === "string" ? x.data : x.data?.data;
        if (typeof raw === "string" && raw.startsWith("0x")) err = raw.startsWith("0xc7568655") ? `FengceRefused(code ${Number(BigInt(`0x${raw.slice(10, 74)}`))})` : `revert ${raw.slice(0, 10)}`;
        x = x.cause;
      }
      return { ok: false, err };
    }
    const r = await pc.waitForTransactionReceipt({ hash: await w.sendTransaction({ to: safe, data: d, gas: 15_000_000n }) });
    return { ok: r.status === "success", err: "" };
  };
  return { owner, safe, exec };
}
const send = (amount: bigint, to: Address) => ({ to: TOKENS.USDT0.address, data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [to, amount] }), operation: 0 as const });
const sig = (s: string) => `0x${keccak256(new TextEncoder().encode(s) as any).slice(2, 10)}`;
void sig;

const cases: { key: TemplateKey; opts: any; allow: (s: Awaited<ReturnType<typeof freshSafe>>) => any; refuse: (s: Awaited<ReturnType<typeof freshSafe>>) => any; what: [string, string] }[] = [
  {
    key: "admin",
    opts: { cap: 1_000_000n },
    allow: (s) => send(100_000n, s.owner),
    // a delegatecall to a contract other than MultiSendCallOnly (here the Uniswap router)
    refuse: () => ({ to: ENGINE.router, data: "0x" as Hex, operation: 1 as const }),
    what: ["send 0.1 USDT0 to the owner", "delegatecall to a contract that is not MultiSendCallOnly"],
  },
  {
    key: "vault",
    opts: { cap: 500_000n, partner: "0x00000000000000000000000000000000000fa11e" },
    allow: (s) => send(200_000n, s.owner),
    refuse: (s) => send(1_000_000n, s.owner),
    what: ["send 0.2 USDT0 (cap 0.5)", "send 1 USDT0 (over the cap)"],
  },
  {
    key: "treasury",
    opts: { cap: 1_000_000n, budget },
    allow: (s) => send(100_000n, s.owner),
    refuse: (s) => send(100_000n, s.owner),
    what: ["first payment in the period: 0.1 USDT0", "second payment in the same period"],
  },
];

for (const c of cases) {
  const s = await freshSafe();
  console.log(`\n${c.key}: fresh Safe ${s.safe}`);
  const calls = templateCalls(c.key, s.safe, c.opts, prepared as never);
  const r = await s.exec(multiSend(calls));
  check(r.ok, `one signature: ${calls.length} calls${r.err ? ` (${r.err})` : ""}`);
  const a = await s.exec(c.allow(s));
  check(a.ok, `allowed: ${c.what[0]}${a.err ? ` (${a.err})` : ""}`);
  const b = await s.exec(c.refuse(s));
  check(!b.ok, `refused: ${c.what[1]} (${b.err || "was sent"})`);
  if (c.key === "admin") {
    const owners = { to: s.safe, data: encodeFunctionData({ abi: parseAbi(["function addOwnerWithThreshold(address,uint256)"]), functionName: "addOwnerWithThreshold", args: ["0x000000000000000000000000000000000000bEEF", 1n] }), operation: 0 as const };
    const o = await s.exec(owners);
    check(!o.ok, `refused: adding an owner right away (${o.err || "was sent"}); it must be scheduled (1 day)`);
  }
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
