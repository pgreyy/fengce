// check(): would this Safe allow this transaction, and if not, why. One eth_call, nothing is sent.
//
// It runs the Safe's own guard (FengceGuard v2 or FengceGuardV3) exactly as the Safe would before executing:
// guard.checkTransaction(...) called with the Safe as msg.sender. State changes in an eth_call are discarded.
import { decodeErrorResult, encodeAbiParameters, getAddress, hexToBigInt, keccak256, numberToHex, pad, parseAbi, type Address, type Hex, type PublicClient } from "viem";

/** Reason codes. FengceGuardV3 reverts with FengceRefused(code); v2 errors are mapped to the same names. */
export type ReasonCode =
  | "MAX_PER_BUY" // the pinned max-per-buy circuit (NAND #2) refused: amount over the cap, paying USDT0
  | "CIRCUIT" // another pinned policy circuit refused
  | "TRADES_PER_HOUR" // counter circuit #7 (Tick): too many swaps this clock hour
  | "QUIET_HOURS"
  | "HOLD_LOCK"
  | "TILT_SHIELD"
  | "AGENT_CAP"
  | "NOT_CONFIGURED" // the guard is installed but has no policy for this Safe
  | "DELEGATECALL" // a delegatecall other than the audited MultiSendCallOnly
  | "ADMIN" // a Safe admin change that must go through the timelock or recovery first
  | "OTHER";

/** FengceGuardV3 reason codes (FengceRulesV3). */
export const V3_REASONS: Record<number, ReasonCode> = { 1: "CIRCUIT", 2: "TRADES_PER_HOUR", 3: "QUIET_HOURS", 4: "HOLD_LOCK", 5: "TILT_SHIELD", 6: "AGENT_CAP", 7: "OTHER" };

export interface CheckTx {
  to: Address;
  value?: bigint;
  data?: Hex;
  /** 0 call (default), 1 delegatecall (MultiSendCallOnly batches) */
  operation?: 0 | 1;
}

export interface CheckResult {
  allowed: boolean;
  reason: ReasonCode | null;
  /** FengceGuardV3 numeric reason code, when there is one */
  code?: number;
  /** the Safe's transaction guard (null: no guard, nothing is checked) */
  guard: Address | null;
  /** for MAX_PER_BUY: the cap, in the token's base units (USDT0 has 6 decimals) */
  limit?: bigint;
  /** the call the guard refused (inside a batch it is the first refused call) */
  refusedTo?: Address;
  /** decoded revert, for logs */
  detail?: string;
}

/** keccak256("guard_manager.guard.address") */
const GUARD_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";
/** Pin of the max-per-buy circuit (processor 0x839b…574e #2) with its [over cap, paying USDT0] schema. */
export const MAX_BUY_PIN = "0xf503c66d7d2a5e35c0dc09c37631ecc68bc871684c478857f4b72ed62afeabda";

const guardAbi = parseAbi([
  "function checkTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures, address msgSender)",
  "function configOf(address safe) view returns (bool set, bytes32 pinId, uint64 recoveryDelay, uint64 recoveryWindow, uint64 adminDelay, address tick, bytes32 tickGroup)",
]);
const safeAbi = parseAbi(["function getOwners() view returns (address[])"]);
const errors = parseAbi([
  "error FengceRefused(uint8 reason, address safe, address to)",
  "error FengceDenied(address safe, address to)",
  "error TickDenied(bytes32 groupId, address account)",
  "error FengceNotConfigured(address safe)",
  "error FengceDelegateCallDenied(address to)",
  "error FengceSafeCallDenied(bytes4 selector)",
  "error FengceGuardCallDenied(bytes4 selector)",
  "error FengceInnerAdminDenied(address to)",
  "error FengceModuleAdminDenied(address to)",
  "error AdminNotReady(bytes32 id)",
  "error RecoveryNotReady(address safe)",
  "error RecoveryExpired(address safe)",
  "error FengceNotAllOwners()",
]);

function revertData(e: unknown): Hex | undefined {
  let c: any = e;
  for (let i = 0; i < 8 && c; i++) {
    if (typeof c.data === "string" && c.data.startsWith("0x")) return c.data as Hex;
    if (c.data?.data && typeof c.data.data === "string") return c.data.data as Hex;
    c = c.cause;
  }
  return undefined;
}

/** The AmountGt threshold of a Safe's policy (the max per buy), read from the guard's storage (slot 5, bindings at +5). */
async function maxPerBuy(client: PublicClient, guard: Address, safe: Address): Promise<bigint | undefined> {
  const base = hexToBigInt(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [safe, 5n])));
  const lenSlot = base + 5n;
  const at = async (s: bigint) => hexToBigInt((await client.getStorageAt({ address: guard, slot: numberToHex(s, { size: 32 }) })) ?? "0x0");
  const len = Number(await at(lenSlot));
  if (!len || len > 32) return undefined;
  const data = hexToBigInt(keccak256(pad(numberToHex(lenSlot), { size: 32 })));
  for (let i = 0; i < len; i++) {
    const source = Number((await at(data + BigInt(2 * i))) & 0xffn);
    if (source === 5) return at(data + BigInt(2 * i + 1)); // TxFacts.Source.AmountGt
  }
  return undefined;
}

/**
 * Would `safe` allow `tx`? Runs the Safe's guard on it (one eth_call; nothing is sent, no signature needed).
 * `sender` is who would submit the Safe transaction (defaults to the first owner).
 *
 *   const r = await check(client, safe, { to: USDT0, data: transferCalldata })
 *   // { allowed: false, reason: "MAX_PER_BUY", limit: 2000000n, guard: "0x…" }
 */
export async function check(client: PublicClient, safe: Address, tx: CheckTx, opts: { sender?: Address } = {}): Promise<CheckResult> {
  safe = getAddress(safe);
  const raw = await client.getStorageAt({ address: safe, slot: GUARD_SLOT });
  const guardWord = raw ? hexToBigInt(raw) : 0n;
  if (guardWord === 0n) return { allowed: true, reason: null, guard: null, detail: "no guard installed: the Safe checks nothing" };
  const guard = getAddress(numberToHex(guardWord, { size: 20 }));
  const sender = opts.sender ?? ((await client.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" })) as Address[])[0];
  const zero = "0x0000000000000000000000000000000000000000" as Address;
  try {
    await client.simulateContract({
      account: safe,
      address: guard,
      abi: guardAbi,
      functionName: "checkTransaction",
      args: [tx.to, tx.value ?? 0n, tx.data ?? "0x", tx.operation ?? 0, 0n, 0n, 0n, zero, zero, "0x", sender],
    });
    return { allowed: true, reason: null, guard };
  } catch (e) {
    const data = revertData(e);
    if (!data) return { allowed: false, reason: "OTHER", guard, detail: (e as Error).message.split("\n")[0] };
    let d: { errorName: string; args?: readonly unknown[] };
    try {
      d = decodeErrorResult({ abi: errors, data }) as never;
    } catch {
      return { allowed: false, reason: "OTHER", guard, detail: data };
    }
    const detail = `${d.errorName}(${(d.args ?? []).map(String).join(", ")})`;
    const capIfMaxBuy = async (r: CheckResult): Promise<CheckResult> => {
      const cfg = (await client.readContract({ address: guard, abi: guardAbi, functionName: "configOf", args: [safe] }).catch(() => null)) as readonly unknown[] | null;
      if (cfg && String(cfg[1]).toLowerCase() === MAX_BUY_PIN) return { ...r, reason: "MAX_PER_BUY", limit: await maxPerBuy(client, guard, safe) };
      return r;
    };
    switch (d.errorName) {
      case "FengceRefused": {
        const code = Number(d.args![0]);
        const r: CheckResult = { allowed: false, reason: V3_REASONS[code] ?? "OTHER", code, guard, refusedTo: d.args![2] as Address, detail };
        return code === 1 ? capIfMaxBuy(r) : r;
      }
      case "FengceDenied":
        return capIfMaxBuy({ allowed: false, reason: "CIRCUIT", guard, refusedTo: d.args![1] as Address, detail });
      case "TickDenied":
        return { allowed: false, reason: "TRADES_PER_HOUR", guard, detail };
      case "FengceNotConfigured":
        return { allowed: false, reason: "NOT_CONFIGURED", guard, detail };
      case "FengceDelegateCallDenied":
        return { allowed: false, reason: "DELEGATECALL", guard, detail };
      default:
        return { allowed: false, reason: "ADMIN", guard, detail };
    }
  }
}
