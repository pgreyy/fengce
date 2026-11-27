// On a local fork of X Layer (sends nothing to mainnet):
//  A. /install: the Transaction Builder file the page builds (batchFile of v3InstallCalls) is run as Safe{Wallet} runs
//     it, as one MultiSendCallOnly batch from a fresh Safe; the Safe then runs FengceGuardV3.
//  B. "Create a new Safe": one transaction through the mainnet FengceSetupV3 creates a Safe with guard v3 and the default
//     limits; a 0.2 USDT0 buy is allowed and a 101 USDT0 buy is refused.
//   anvil --fork-url https://rpc.xlayer.tech --port 8558 --auto-impersonate &
//   cd app && npx tsx scripts/install-create-fork.mts http://127.0.0.1:8558
import { createPublicClient, createTestClient, createWalletClient, decodeFunctionResult, getAddress, http, parseAbi, type Address, type Hex } from "viem";
import prepared from "../../deployments/limits-xlayer-196.json" with { type: "json" };
import { ENGINE, TOKENS, createSafeCalldata, execCalldata, multiSend, swapCalls, type Call } from "../src/fengce/engine";
import { batchFile } from "../src/fengce/installFile";
import { CREATE_DEFAULTS, V3, V3_DEFAULTS, createSafeV3Calldata, v3InstallCalls, v3Abi } from "../src/fengce/v3";

const rpc = process.argv[2] ?? "http://127.0.0.1:8558";
const chain = { id: 196, name: "X Layer fork", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;
const pc = createPublicClient({ chain, transport: http(rpc, { timeout: 180_000 }) });
const test = createTestClient({ chain, mode: "anvil", transport: http(rpc, { timeout: 180_000 }) });
let failed = 0;
const check = (ok: boolean, what: string) => (console.log(`${ok ? "ok  " : "FAIL"} ${what}`), ok || failed++);
const GUARD_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";
const factoryAbi = parseAbi(["function createProxyWithNonce(address,bytes,uint256) returns (address)"]);
const guardOf = async (safe: Address) => getAddress(`0x${(await pc.getStorageAt({ address: safe, slot: GUARD_SLOT }))!.slice(-40)}`);

async function owner(tag: number) {
  const o = getAddress(`0x${(Date.now() * 17 + tag).toString(16).padStart(40, "e")}`.slice(0, 42)) as Address;
  await test.setBalance({ address: o, value: 10n ** 18n });
  return { o, w: createWalletClient({ chain, account: o, transport: http(rpc, { timeout: 180_000 }) }) };
}
async function create(o: Address, w: any, data: Hex) {
  const ret = await pc.call({ account: o, to: ENGINE.safeFactory, data });
  const safe = decodeFunctionResult({ abi: factoryAbi, functionName: "createProxyWithNonce", data: ret.data! }) as Address;
  const r = await pc.waitForTransactionReceipt({ hash: await w.sendTransaction({ to: ENGINE.safeFactory, data }) });
  return { safe, ok: r.status === "success" };
}
async function exec(o: Address, w: any, safe: Address, tx: { to: Address; data: Hex; operation: 0 | 1 }) {
  const d = execCalldata(o, tx);
  try {
    await pc.call({ account: o, to: safe, data: d });
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
  return { ok: r.status === "success", err: "" };
}

// A. /install's Transaction Builder file
{
  const { o, w } = await owner(1);
  const { safe } = await create(o, w, createSafeCalldata(o, BigInt(Date.now())));
  const calls = v3InstallCalls(safe, { ...V3_DEFAULTS, maxPerBuy: 2_000_000n, tradesPerHour: 5 }, prepared as never);
  const file = JSON.parse(JSON.stringify(batchFile(safe, calls, 2, 5, true)));
  check(file.chainId === "196" && file.transactions.length === calls.length && /FengceGuardV3/.test(file.meta.description), `/install file: ${file.transactions.length} transactions, "${file.meta.description.slice(0, 60)}…"`);
  const fromFile: Call[] = file.transactions.map((t: any) => ({ to: getAddress(t.to), value: BigInt(t.value), data: t.data as Hex, label: "" }));
  const r = await exec(o, w, safe, multiSend(fromFile));
  check(r.ok, `the file's batch executed on a fresh Safe${r.err ? ` (${r.err})` : ""}`);
  check((await guardOf(safe)) === V3!.guard, "the Safe runs FengceGuardV3");
  const rules = (await pc.readContract({ address: V3!.guard, abi: v3Abi, functionName: "rulesOf", args: [safe] })) as any;
  check(rules.tiltOn === true, "Tilt-shield on, as chosen in the file");
}

// B. "Create a new Safe": one transaction through FengceSetupV3
{
  const { o, w } = await owner(2);
  check(!!V3!.setup && (await pc.getCode({ address: V3!.setup! }))!.length > 2, `FengceSetupV3 on mainnet at ${V3!.setup}`);
  const { safe, ok } = await create(o, w, createSafeV3Calldata(o, BigInt(Date.now()), CREATE_DEFAULTS, prepared as never));
  check(ok, `one transaction created Safe ${safe}`);
  check((await guardOf(safe)) === V3!.guard, "guard v3 installed during creation");
  const cfg = (await pc.readContract({ address: V3!.guard, abi: parseAbi(["function configOf(address) view returns (bool,bytes32,uint64,uint64,uint64,address,bytes32)"]), functionName: "configOf", args: [safe] })) as readonly unknown[];
  check(cfg[0] === true && String(cfg[1]).toLowerCase() === prepared.maxBuyPin.toLowerCase(), "max per buy configured (circuit #2)");
  // fund with 1 USDT0 from the USDT0/WOKB pool
  const fac = (await pc.readContract({ address: ENGINE.router, abi: parseAbi(["function factory() view returns (address)"]), functionName: "factory" })) as Address;
  const pool = (await pc.readContract({ address: fac, abi: parseAbi(["function getPool(address,address,uint24) view returns (address)"]), functionName: "getPool", args: [TOKENS.USDT0.address, TOKENS.WOKB.address, 500] })) as Address;
  await test.setBalance({ address: pool, value: 10n ** 17n });
  const pw = createWalletClient({ chain, account: pool, transport: http(rpc, { timeout: 180_000 }) });
  await pc.waitForTransactionReceipt({ hash: await pw.writeContract({ address: TOKENS.USDT0.address, abi: parseAbi(["function transfer(address,uint256) returns (bool)"]), functionName: "transfer", args: [safe, 1_000_000n] }) });
  const a = await exec(o, w, safe, multiSend(swapCalls(safe, TOKENS.USDT0.address, TOKENS.WOKB.address, 200_000n, 0n)));
  check(a.ok, `0.2 USDT0 buy: allowed${a.err ? ` (${a.err})` : ""}`);
  const b = await exec(o, w, safe, multiSend(swapCalls(safe, TOKENS.USDT0.address, TOKENS.WOKB.address, 101_000_000n, 0n)));
  check(!b.ok && /code 1\b/.test(b.err), `101 USDT0 buy (over the 100 default): refused (${b.err || "sent"})`);
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
