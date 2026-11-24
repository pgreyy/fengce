import { createWalletClient, custom, isAddress, parseAbi, type Address, type Hex } from "viem";
import { client } from "./chain";
import { verdictAbi } from "./verdict-abi";

/** The Verdict deployment, if deployments/verdict-xlayer-196.json exists at build time (script/DeployVerdict.s.sol
 * writes it). Before that the page is read-only with an empty state. `?verdict=0x…` overrides it. */
const found = import.meta.glob("../../../deployments/verdict-xlayer-196.json", { eager: true, import: "default" }) as Record<
  string,
  { Verdict?: string }
>;
const fromFile = Object.values(found)[0]?.Verdict;

export function verdictAddress(): Address | null {
  let q: string | null = null;
  try {
    q = new URLSearchParams(location.search).get("verdict");
  } catch {
    /* not in a browser */
  }
  const a = q ?? fromFile ?? null;
  return a && isAddress(a) ? (a as Address) : null;
}

export const USDT0 = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as Address;
export const STATES = ["Open", "Checkpointed", "YES", "NO", "VOID"] as const;
export const VOID_REASONS = ["", "no checkpoint in the window", "a source's code changed", "the circuit pin changed", "the evaluation failed", "one side had no stake"];

export interface Field {
  kind: number; // 0 Uint, 1 Bool, 2 Flag
  offset: number;
  width: number;
  fixedValue: bigint;
}
export interface Input {
  source: Address;
  callData: Hex;
  decode: number; // 0 Word, 1 Constant
  arg: bigint;
}
export interface Market {
  id: bigint;
  creator: Address;
  pinId: Hex;
  refClosureHash: Hex;
  deadline: bigint;
  settleWindow: bigint;
  checkpointBlock: bigint;
  checkpointTime: bigint;
  state: number;
  voidReason: number;
  totals: readonly [bigint, bigint];
  question: string;
}

const registryAbi = parseAbi([
  "function evalInfo(bytes32) view returns (address processor, uint256 circuitId, uint32 nIn, uint32 nOut, bytes32 netlistHash, bytes32 schemaHash)",
  "function isPinned(bytes32) view returns (bool)",
]);
const processorAbi = parseAbi(["function eval(uint256 id, bytes input) view returns (bytes)"]);
const erc20Abi = parseAbi([
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

export async function marketCount(v: Address): Promise<bigint> {
  return client.readContract({ address: v, abi: verdictAbi, functionName: "marketCount" });
}

export async function market(v: Address, id: bigint): Promise<Market> {
  const m = (await client.readContract({ address: v, abi: verdictAbi, functionName: "market", args: [id] })) as Omit<Market, "id">;
  return { id, ...m };
}

export async function marketData(v: Address, id: bigint) {
  const [fields, inputs, codehashes, values] = (await client.readContract({
    address: v,
    abi: verdictAbi,
    functionName: "marketData",
    args: [id],
  })) as unknown as [Field[], Input[], Hex[], bigint[]];
  return { fields, inputs, codehashes, values };
}

export async function pinInfo(v: Address, pinId: Hex) {
  const registry = (await client.readContract({ address: v, abi: verdictAbi, functionName: "registry" })) as Address;
  const [processor, circuitId, nIn, nOut] = await client.readContract({ address: registry, abi: registryAbi, functionName: "evalInfo", args: [pinId] });
  const pinned = await client.readContract({ address: registry, abi: registryAbi, functionName: "isPinned", args: [pinId] });
  return { registry, processor, circuitId, nIn: Number(nIn), nOut: Number(nOut), pinned };
}

/** Independent encoder (TAP-02: bit i is bit i%8 of byte i/8, LSB first), the same rule as src/core/Schema.sol. */
export function encodeBits(nIn: number, fields: Field[], values: bigint[]): Hex {
  const out = new Uint8Array(Math.ceil(nIn / 8));
  let vi = 0;
  for (const f of fields) {
    const v = f.kind === 2 ? f.fixedValue : values[vi++];
    if (f.width < 256 && v >> BigInt(f.width) !== 0n) throw new Error(`value ${v} does not fit ${f.width} bits`);
    for (let b = 0; b < f.width; b++) if ((v >> BigInt(b)) & 1n) out[(f.offset + b) >> 3] |= 1 << ((f.offset + b) & 7);
  }
  return `0x${[...out].map((x) => x.toString(16).padStart(2, "0")).join("")}` as Hex;
}

/** Re-runs the circuit with eth_call straight on the processor (not through Verdict). */
export async function rerun(processor: Address, circuitId: bigint, input: Hex): Promise<Hex> {
  return client.readContract({ address: processor, abi: processorAbi, functionName: "eval", args: [circuitId, input] });
}

/** Reads a source the way checkpoint does, at a given block (needs an RPC that serves that block's state). */
export async function readAt(x: Input, block: bigint): Promise<bigint> {
  const r = await client.call({ to: x.source, data: x.callData, blockNumber: block });
  const data = (r.data ?? "0x").slice(2);
  const off = Number(x.arg) * 64;
  if (data.length < off + 64) throw new Error("short return data");
  return BigInt(`0x${data.slice(off, off + 64)}`);
}

// ---------------------------------------------------------------- wallet

declare global {
  interface Window {
    ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
  }
}

const XLAYER_HEX = "0xc4"; // 196

export async function connect(): Promise<Address> {
  if (!window.ethereum) throw new Error("No browser wallet found. Install one that supports X Layer.");
  const [a] = (await window.ethereum.request({ method: "eth_requestAccounts" })) as Address[];
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: XLAYER_HEX }] });
  } catch {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: XLAYER_HEX, chainName: "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: ["https://rpc.xlayer.tech"], blockExplorerUrls: ["https://www.oklink.com/x-layer"] }],
    });
  }
  return a;
}

function wallet(account: Address) {
  return createWalletClient({
    account,
    chain: { id: 196, name: "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.xlayer.tech"] } } },
    transport: custom(window.ethereum!),
  });
}

async function send(account: Address, req: Parameters<ReturnType<typeof wallet>["writeContract"]>[0]): Promise<Hex> {
  const hash = await wallet(account).writeContract(req);
  await client.waitForTransactionReceipt({ hash });
  return hash;
}

export async function usdt0(account: Address) {
  return client.readContract({ address: USDT0, abi: erc20Abi, functionName: "balanceOf", args: [account] });
}

export async function placeBet(v: Address, account: Address, id: bigint, side: 0 | 1, amount: bigint): Promise<Hex> {
  const allowance = await client.readContract({ address: USDT0, abi: erc20Abi, functionName: "allowance", args: [account, v] });
  if (allowance < amount) await send(account, { address: USDT0, abi: erc20Abi, functionName: "approve", args: [v, amount] } as never);
  return send(account, { address: v, abi: verdictAbi, functionName: "bet", args: [id, side, amount] } as never);
}

export function call(v: Address, account: Address, fn: "checkpoint" | "settle" | "claim" | "refund", id: bigint): Promise<Hex> {
  return send(account, { address: v, abi: verdictAbi, functionName: fn, args: [id] } as never);
}

export async function claimable(v: Address, id: bigint, who: Address): Promise<bigint> {
  return client.readContract({ address: v, abi: verdictAbi, functionName: "claimable", args: [id, who] });
}

export async function stakeOf(v: Address, id: bigint, who: Address): Promise<readonly [bigint, bigint]> {
  return client.readContract({ address: v, abi: verdictAbi, functionName: "stakeOf", args: [id, who] });
}

export async function evaluateStored(v: Address, id: bigint): Promise<readonly [Hex, Hex]> {
  return client.readContract({ address: v, abi: verdictAbi, functionName: "evaluateStored", args: [id] });
}
