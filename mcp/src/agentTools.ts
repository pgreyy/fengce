// Agent tools for the Fengce MCP server: check (would this Safe allow this transaction, with the reason code),
// explain_refusal (the reason in plain words and what to change), pay_through_safe (an agent key pays through
// AgentExecutorV3; refused payments are never sent).
import { spawnSync } from "node:child_process";
import { createWalletClient, decodeEventLog, encodeAbiParameters, encodeFunctionData, getAddress, hexToBigInt, http, keccak256, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { check, type CheckResult } from "@fengce/sdk";
import { client } from "../../app/src/lib/chain";
import { readInstalled, usdt0 } from "../../app/src/fengce/reads";
import { TOKENS } from "../../app/src/fengce/engine";
import m2 from "../../deployments/m2-demo-xlayer-196.json";

export const AGENT_EXECUTOR_V3 = getAddress(m2.agentExecutor) as Address;
const LOCATION = 0x9a57f217486e173034fca5d4a86893cc651eefd65d7136fdc890c40c96dcea92n;
const execAbi = parseAbi([
  "function execute(address safe, address to, uint256 value, bytes data) returns (bytes)",
  "function agents(address safe, address agent) view returns (bool active, uint64 expiresAt)",
  "event Denied(address indexed safe, address indexed agent, address target, bytes32 factsHash, bytes reason)",
  "event AgentExecuted(address indexed safe, address indexed agent, address to, uint256 value, bytes32 dataHash)",
]);
const extsloadAbi = parseAbi(["function extsload(bytes32 slot) view returns (bytes32)"]);
const erc20 = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);
const REASON_NAMES: Record<number, string> = { 1: "CIRCUIT", 2: "TRADES_PER_HOUR", 3: "QUIET_HOURS", 4: "HOLD_LOCK", 5: "TILT_SHIELD", 6: "AGENT_CAP", 7: "OTHER" };

export interface Tx {
  to: Address;
  value: bigint;
  data: Hex;
}

/** USDT0 amount of a transfer, or null. */
function usdt0Amount(tx: Tx): bigint | null {
  if (tx.to.toLowerCase() !== TOKENS.USDT0.address.toLowerCase() || !tx.data.startsWith("0xa9059cbb")) return null;
  return hexToBigInt(`0x${tx.data.slice(74, 138)}`);
}

/** The agent's daily cap on a guard v3 Safe: on, per day and spent today (USDT0 base units), read from guard storage. */
export async function agentCap(guard: Address, safe: Address, agent: Address) {
  const key = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], [safe, AGENT_EXECUTOR_V3, agent]));
  const capSlot = hexToBigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [key, LOCATION + 1n])));
  const day = BigInt(Math.floor(Date.now() / 1000 / 86_400));
  const spentKey = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [key, day]));
  const spentSlot = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [spentKey, LOCATION + 2n]));
  const read = (slot: Hex) => client.readContract({ address: guard, abi: extsloadAbi, functionName: "extsload", args: [slot] }).then(hexToBigInt);
  const [on, perDay, spent] = await Promise.all([read(`0x${capSlot.toString(16).padStart(64, "0")}`), read(`0x${(capSlot + 1n).toString(16).padStart(64, "0")}`), read(spentSlot)]);
  return { on: (on & 0xffn) === 1n, perDay, spent, resetsAt: Number((day + 1n) * 86_400n) };
}

export interface Decision extends CheckResult {
  path: "owner" | "agent";
  agent?: Address;
  /** agent path: the cap state used */
  cap?: { on: boolean; perDay: string; spentToday: string; resetsAt: string } | null;
}

/** Would the Safe allow this transaction? Owner path: the guard runs exactly as at execution (SDK check, eth_call). Agent
 * path: the agent must be active on AgentExecutorV3, the owner-path rules apply, and the agent's daily cap. */
export async function decide(safe: Address, tx: Tx, agent?: Address): Promise<Decision> {
  const owner = await check(client as never, safe, { to: tx.to, value: tx.value, data: tx.data });
  if (!agent) return { ...owner, path: "owner" };
  const [active] = (await client.readContract({ address: AGENT_EXECUTOR_V3, abi: execAbi, functionName: "agents", args: [safe, agent] })) as [boolean, bigint];
  if (!active) return { allowed: false, reason: "OTHER", code: 7, guard: owner.guard, detail: `${agent} is not an active agent of this Safe on AgentExecutorV3 ${AGENT_EXECUTOR_V3}`, path: "agent", agent };
  let cap: Decision["cap"] = null;
  if (owner.guard) {
    const c = await agentCap(owner.guard, safe, agent);
    cap = { on: c.on, perDay: c.perDay.toString(), spentToday: c.spent.toString(), resetsAt: new Date(c.resetsAt * 1000).toISOString() };
    const amt = usdt0Amount(tx);
    if (c.on && amt !== null && c.spent + amt > c.perDay) return { allowed: false, reason: "AGENT_CAP" as never, code: 6, guard: owner.guard, detail: `over the agent's daily cap: ${usdt0(c.spent)} spent today + ${usdt0(amt)} > ${usdt0(c.perDay)} USDT0`, path: "agent", agent, cap };
  }
  return { ...owner, path: "agent", agent, cap };
}

const hh = (h: number) => `${String(h).padStart(2, "0")}:00 UTC`;
const when = (t: number) => new Date(t * 1000).toISOString().replace(".000Z", " UTC").replace("T", " ");

/** The reason in plain words, and what limit to change (or wait for). */
export async function explain(safe: Address, d: Decision, tx: Tx): Promise<{ reason: string; change: string }> {
  if (d.allowed) return { reason: "Allowed: the Safe's limits let this transaction through.", change: "Nothing to change." };
  const inst = await readInstalled(safe).catch(() => null);
  const r = inst?.v3?.rules;
  const loosen = "Loosening is a scheduled change on Limits: it applies after 1 day (7 with a partner, unless they approve sooner). Tightening applies at once.";
  const code = d.code ?? 0;
  const name = REASON_NAMES[code] ?? String(d.reason ?? "refused");
  switch (code || name) {
    case 1:
    case "MAX_PER_BUY": {
      const cap = inst?.maxPerBuy ?? d.limit ?? null;
      const amt = usdt0Amount(tx);
      return {
        reason: `${name}: the amount${amt !== null ? ` (${usdt0(amt)} USDT0)` : ""} is over the Safe's max per buy${cap !== null ? ` of ${usdt0(cap)} USDT0` : ""} (NAND circuit #2 said no).`,
        change: `Send or buy at most ${cap !== null ? `${usdt0(cap)} USDT0` : "the cap"}, or raise max per buy on Limits. ${loosen}`,
      };
    }
    case 2:
      return inst?.trades
        ? { reason: `TRADES_PER_HOUR: ${inst.trades.usedThisHour} of ${inst.trades.perHour} trades used this clock hour.`, change: `Wait until ${when(inst.trades.resetsAt)} (the count resets each clock hour), or allow more trades per hour on Limits. ${loosen}` }
        : { reason: "TRADES_PER_HOUR: the Safe's Tick circuit (a per-period budget) refused this transaction.", change: `Wait for the next period, or change the budget on Limits. ${loosen}` };
    case 3:
      return { reason: `QUIET_HOURS: no buys${r ? ` between ${hh(r.quietStart)} and ${hh(r.quietEnd)}` : " during the Safe's quiet hours"}.`, change: `Wait until ${r ? hh(r.quietEnd) : "quiet hours end"}, or shorten or turn off quiet hours on Limits. ${loosen}` };
    case 4:
      return { reason: `HOLD_LOCK: this sells or sends a token bought less than ${r ? `${r.holdSeconds / 3600} hours` : "the hold time"} ago.`, change: `Wait until the hold lock ends for that token, or shorten it on Limits. ${loosen}` };
    case 5: {
      const t = inst?.v3?.tilt;
      return { reason: `TILT_SHIELD: buys are paused after ${t?.tripAt ?? 4} buys in the same half hour (or one buy over 3x the usual size).`, change: `Wait until ${t?.resumesAt ? when(t.resumesAt) : "the pause ends"}; a partner can clear it earlier. Sells and sends to the Safe still work.` };
    }
    case 6:
      return {
        reason: `AGENT_CAP: this agent is over its daily cap${d.cap ? ` (${usdt0(BigInt(d.cap.spentToday))} of ${usdt0(BigInt(d.cap.perDay))} USDT0 spent today)` : ""}.`,
        change: `Wait until ${d.cap ? d.cap.resetsAt.replace(".000Z", " UTC").replace("T", " ") : "the UTC day resets"}, pay less, or have the Safe's owners raise the agent's cap (setAgentCap). ${loosen}`,
      };
    default:
      return { reason: `${name}: ${d.detail ?? "the guard refused this transaction"}.`, change: "Open My wallet for this Safe on getfengce.vercel.app to see its rules; the refusal is final until a limit changes." };
  }
}

/** The call an agent sends: AgentExecutorV3.execute(safe, token, 0, transfer(recipient, amount)). */
export function payCall(safe: Address, token: Address, recipient: Address, amount: bigint): { to: Address; data: Hex; inner: Tx } {
  const inner: Tx = { to: token, value: 0n, data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [recipient, amount] }) };
  return { to: AGENT_EXECUTOR_V3, data: encodeFunctionData({ abi: execAbi, functionName: "execute", args: [safe, inner.to, inner.value, inner.data] }), inner };
}

/** What happened in a sent transaction: AgentExecuted or Denied. */
export async function outcome(hash: Hex): Promise<{ status: string; result: "executed" | "denied" | "unknown" }> {
  const r = await client.waitForTransactionReceipt({ hash });
  for (const l of r.logs) {
    if (l.address.toLowerCase() !== AGENT_EXECUTOR_V3.toLowerCase()) continue;
    try {
      const e = decodeEventLog({ abi: execAbi, data: l.data, topics: l.topics });
      if (e.eventName === "AgentExecuted") return { status: r.status, result: "executed" };
      if (e.eventName === "Denied") return { status: r.status, result: "denied" };
    } catch {
      /* another event */
    }
  }
  return { status: r.status, result: "unknown" };
}

/** Sends with a private key from FENGCE_AGENT_PRIVATE_KEY (never printed), or through the OKX Agentic Wallet CLI. */
export async function send(signer: "key" | "onchainos", agent: Address, call: { to: Address; data: Hex }): Promise<Hex> {
  if (signer === "key") {
    const k = process.env.FENGCE_AGENT_PRIVATE_KEY as Hex | undefined;
    if (!k) throw new Error("Set FENGCE_AGENT_PRIVATE_KEY for the agent key in the MCP server's environment, or use signer onchainos.");
    const account = privateKeyToAccount(k);
    if (account.address.toLowerCase() !== agent.toLowerCase()) throw new Error("FENGCE_AGENT_PRIVATE_KEY is not the key of the agent you named.");
    const w = createWalletClient({ account, chain: { id: 196, name: "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.xlayer.tech"] } } }, transport: http("https://rpc.xlayer.tech") });
    return w.sendTransaction({ to: call.to, data: call.data });
  }
  const args = ["wallet", "contract-call", "--chain", "xlayer", "--to", call.to, "--input-data", call.data, "--from", agent, "--force"];
  const r = spawnSync(process.env.ONCHAINOS_BIN ?? "onchainos", args, { encoding: "utf8", timeout: 120_000 });
  if (r.error) throw new Error(`onchainos could not run: ${r.error.message}. Install it and run onchainos wallet login first.`);
  const m = /"txHash"\s*:\s*"(0x[0-9a-fA-F]{64})"/.exec(r.stdout ?? "");
  if (!m) throw new Error(`onchainos did not return a transaction: ${(r.stdout || r.stderr || "").trim().slice(0, 300)}`);
  return m[1] as Hex;
}
