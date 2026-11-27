// Guard v3 from the app, on a local fork of X Layer: the Limits install (v3InstallCalls) on a fresh Safe, the rules read
// back (readV3 logic), a tightening change applied at once and a loosening change refused until scheduled. Sends nothing
// to mainnet.
//   anvil --fork-url https://rpc.xlayer.tech --port 8552 --auto-impersonate &
//   cd app && npx tsx scripts/v3-fork.mts http://127.0.0.1:8552
import { createPublicClient, createTestClient, createWalletClient, decodeFunctionResult, getAddress, http, parseAbi, type Address, type Hex } from "viem";
import prepared from "../../deployments/limits-xlayer-196.json" with { type: "json" };
import { ENGINE, createSafeCalldata, execCalldata, multiSend } from "../src/fengce/engine";
import { V3, V3_DEFAULTS, rulesFor, scheduleCall, v3Abi, v3InstallCalls, type Rules } from "../src/fengce/v3";

const rpc = process.argv[2] ?? "http://127.0.0.1:8552";
const chain = { id: 196, name: "X Layer fork", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;
const pc = createPublicClient({ chain, transport: http(rpc, { timeout: 180_000 }) });
const test = createTestClient({ chain, mode: "anvil", transport: http(rpc, { timeout: 180_000 }) });
let failed = 0;
const check = (ok: boolean, what: string) => (console.log(`${ok ? "ok  " : "FAIL"} ${what}`), ok || failed++);

const owner = getAddress(`0x${Date.now().toString(16).padStart(40, "a")}`.slice(0, 42)) as Address;
await test.setBalance({ address: owner, value: 10n ** 18n });
const w = createWalletClient({ chain, account: owner, transport: http(rpc, { timeout: 180_000 }) });
const data = createSafeCalldata(owner, BigInt(Date.now()));
const ret = await pc.call({ account: owner, to: ENGINE.safeFactory, data });
const safe = decodeFunctionResult({ abi: parseAbi(["function createProxyWithNonce(address,bytes,uint256) returns (address)"]), functionName: "createProxyWithNonce", data: ret.data! }) as Address;
await pc.waitForTransactionReceipt({ hash: await w.sendTransaction({ to: ENGINE.safeFactory, data }) });
console.log(`fresh Safe ${safe}, guard v3 ${V3!.guard}`);

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

const s = { ...V3_DEFAULTS, maxPerBuy: 2_000_000n, tradesPerHour: 5 };
const calls = v3InstallCalls(safe, s, prepared as never);
const r = await exec(multiSend(calls));
check(r.ok, `v3 install, one signature, ${calls.length} calls${"err" in r ? `: ${r.err}` : ""}`);
const slot = await pc.getStorageAt({ address: safe, slot: "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8" });
check(getAddress(`0x${slot!.slice(-40)}`) === V3!.guard, "Safe guard is FengceGuardV3");
const rules = (await pc.readContract({ address: V3!.guard, abi: v3Abi, functionName: "rulesOf", args: [safe] })) as unknown as Rules;
check(rules.tiltOn && !rules.quietOn && Number(rules.tiltCooldown) === 6 * 3600, "rules read back: Tilt-shield on, quiet hours off, 6 h pause");

const tighten = rulesFor(safe, { ...s, quietOn: true, quietStart: 1, quietEnd: 7 });
const t1 = await exec({ to: V3!.guard, data: (await import("viem")).encodeFunctionData({ abi: v3Abi, functionName: "setRules", args: [tighten] }), operation: 0 });
check(t1.ok, "tightening (quiet hours on) applies at once");
const loosen = rulesFor(safe, { ...s, quietOn: false });
const ld = (await import("viem")).encodeFunctionData({ abi: v3Abi, functionName: "setRules", args: [loosen] });
const t2 = await exec({ to: V3!.guard, data: ld, operation: 0 });
check(!t2.ok, `loosening (quiet hours off) refused directly${"err" in t2 ? ` (${(t2.err ?? "").slice(0, 80)})` : ""}`);
const sc = scheduleCall({ to: V3!.guard, value: 0n, data: ld, label: "loosen" });
const t3 = await exec({ to: sc.to, data: sc.data, operation: 0 });
check(t3.ok, "loosening scheduled (scheduleAdmin)");
await test.increaseTime({ seconds: 86_401 });
await test.mine({ blocks: 1 });
const t4 = await exec({ to: V3!.guard, data: ld, operation: 0 });
check(t4.ok, "after 1 day the scheduled loosening applies");
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
