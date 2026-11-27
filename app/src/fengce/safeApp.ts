// Fengce as a custom app inside Safe{Wallet} (app.safe.global → Apps → Add custom app → getfengce.vercel.app). In the
// Safe's iframe the app connects to that Safe on its own (Safe Apps SDK), and every Safe transaction the app would ask an
// owner to sign is handed to Safe{Wallet} instead (sdk.txs.send): the Safe app batches the calls, collects the owners'
// signatures and executes. The manifest is public/manifest.json.
import type SafeAppsSDK from "@safe-global/safe-apps-sdk";
import { decodeFunctionData, getAddress, hexToBigInt, parseAbi, slice, type Address, type Hex } from "viem";

const safeAbi = parseAbi(["function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)"]);
const msAbi = parseAbi(["function multiSend(bytes transactions)"]);

export interface SafeAppSession {
  sdk: SafeAppsSDK;
  safe: Address;
  owners: Address[];
  threshold: number;
}

let session: SafeAppSession | null = null;
export const safeAppSession = () => session;

/** In Safe{Wallet}'s iframe on X Layer: the Safe it runs in. Resolves null anywhere else (quickly). */
export async function detectSafeApp(): Promise<SafeAppSession | null> {
  if (typeof window === "undefined" || window.self === window.top) return null;
  const { default: SDK } = await import("@safe-global/safe-apps-sdk");
  const sdk = new SDK({ allowedDomains: [/^https:\/\/app\.safe\.global$/, /^https:\/\/.*\.safe\.global$/], debug: false });
  const info = await Promise.race([sdk.safe.getInfo().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
  if (!info || info.chainId !== 196) return null;
  session = { sdk, safe: getAddress(info.safeAddress) as Address, owners: info.owners.map((o) => getAddress(o) as Address), threshold: info.threshold };
  return session;
}

/** The calls a Safe transaction stands for: an execTransaction to the Safe is unwrapped (MultiSend batches into their
 * calls); any other call becomes one call made by the Safe. */
function callsOf(s: SafeAppSession, to: Address, data: Hex, value: bigint): { to: string; value: string; data: string }[] {
  if (to.toLowerCase() !== s.safe.toLowerCase()) return [{ to, value: value.toString(), data }];
  const [innerTo, innerValue, innerData, op] = decodeFunctionData({ abi: safeAbi, data }).args as unknown as [Address, bigint, Hex, number];
  if (op === 1 && innerData.startsWith("0x8d80ff0a")) {
    const packed = decodeFunctionData({ abi: msAbi, data: innerData }).args[0] as Hex;
    const out: { to: string; value: string; data: string }[] = [];
    for (let o = 0; o < (packed.length - 2) / 2; ) {
      const t = slice(packed, o + 1, o + 21);
      const v = hexToBigInt(slice(packed, o + 21, o + 53));
      const len = Number(hexToBigInt(slice(packed, o + 53, o + 85)));
      out.push({ to: getAddress(t), value: v.toString(), data: len ? slice(packed, o + 85, o + 85 + len) : "0x" });
      o += 85 + len;
    }
    return out;
  }
  return [{ to: innerTo, value: innerValue.toString(), data: innerData }];
}

/** Hands a transaction to Safe{Wallet} and waits until it is executed (with one owner, right after signing). With more
 * owners it is proposed and runs once they sign; then this throws with the Safe transaction hash. */
export async function sendThroughSafeApp(s: SafeAppSession, to: Address, data: Hex, value = 0n): Promise<Hex> {
  const { safeTxHash } = await s.sdk.txs.send({ txs: callsOf(s, to, data, value) });
  for (let i = 0; i < 150; i++) {
    const tx = await s.sdk.txs.getBySafeTxHash(safeTxHash).catch(() => null);
    if (tx?.txHash) return tx.txHash as Hex;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Proposed in Safe{Wallet} (Safe transaction ${safeTxHash.slice(0, 10)}…). It runs once the Safe's owners sign it there.`);
}
