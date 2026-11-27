// The home hero's live proof: the Milestone 2 demo Safe (deployments/m2-demo-xlayer-196.json, written by
// scripts/m2-onchain.sh) with its real allowed swap and its refusal recorded on chain. Amounts and tokens are decoded
// from the transactions themselves, and the guard is read from the Safe's storage.
import { decodeFunctionData, getAddress, hexToBigInt, parseAbi, slice, sliceHex, type Address, type Hex } from "viem";
import { client } from "../lib/chain";
import { ABIS, TOKENS } from "./engine";

interface M2 {
  safe?: string;
  guard?: string;
  txs?: Record<string, { hash: Hex }[]>;
  steps?: Record<string, Record<string, string>>;
}
const m2 = Object.values(import.meta.glob("../../../deployments/m2-demo-xlayer-196.json", { eager: true, import: "default" }))[0] as M2 | undefined;

export const DEMO =
  m2?.safe && m2.guard && m2.txs?.swap?.[0] && m2.txs?.refuse?.[0]
    ? {
        safe: getAddress(m2.safe) as Address,
        guard: getAddress(m2.guard) as Address,
        swapTx: m2.txs.swap[0].hash,
        refuseTx: m2.txs.refuse[0].hash,
        refusedCode: Number(m2.steps?.refuse?.refusedCode ?? 0),
      }
    : null;

/** FengceGuardV3 reason codes (contracts/src/safe/FengceRulesV3.sol). Code 1 is the policy circuit (max per buy). */
export const REASONS: Record<number, string> = { 1: "CIRCUIT", 2: "TRADES_PER_HOUR", 3: "QUIET_HOURS", 4: "HOLD_LOCK", 5: "TILT_SHIELD", 6: "AGENT_CAP", 7: "OTHER" };

const recordAbi = parseAbi(["function recordRefusal(address safe, address to, uint256 value, bytes data, uint8 operation)"]);
const GUARD_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";
const SYMBOL: Record<string, string> = { [TOKENS.USDT0.address.toLowerCase()]: "USDT0", [TOKENS.WOKB.address.toLowerCase()]: "OKB", [TOKENS.USDC.address.toLowerCase()]: "USDC" };
const DEC: Record<string, number> = { USDT0: 6, USDC: 6, OKB: 18 };

export interface Swap {
  amount: string; // "0.2 USDT0"
  out: string; // "OKB"
}

/** The swap inside a Safe transaction (execTransaction) or a recorded refusal (recordRefusal), MultiSend or direct. */
export async function swapOfTx(hash: Hex): Promise<Swap | null> {
  const tx = await client.getTransaction({ hash });
  let data: Hex;
  try {
    data = decodeFunctionData({ abi: ABIS.safe, data: tx.input }).args![2] as Hex;
  } catch {
    data = decodeFunctionData({ abi: recordAbi, data: tx.input }).args[3] as Hex;
  }
  const calls: Hex[] = [];
  if (data.startsWith("0x8d80ff0a")) {
    const packed = decodeFunctionData({ abi: ABIS.multiSend, data }).args[0] as Hex;
    for (let o = 0; o < (packed.length - 2) / 2; ) {
      const len = Number(hexToBigInt(slice(packed, o + 53, o + 85)));
      calls.push(sliceHex(packed, o + 85, o + 85 + len));
      o += 85 + len;
    }
  } else calls.push(data);
  for (const c of calls) {
    if (!c.startsWith("0x04e45aaf")) continue;
    const p = decodeFunctionData({ abi: ABIS.router, data: c }).args[0] as { tokenIn: Address; tokenOut: Address; amountIn: bigint };
    const sym = SYMBOL[p.tokenIn.toLowerCase()] ?? "tokens";
    const n = Number(p.amountIn) / 10 ** (DEC[sym] ?? 18);
    return { amount: `${n.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${sym}`, out: SYMBOL[p.tokenOut.toLowerCase()] ?? "tokens" };
  }
  return null;
}

export async function guardOn(safe: Address, guard: Address): Promise<boolean> {
  const v = await client.getStorageAt({ address: safe, slot: GUARD_SLOT });
  return !!v && getAddress(`0x${v.slice(-40)}`) === guard;
}
