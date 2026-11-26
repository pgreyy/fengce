// A Safe's activity read from X Layer, no backend.
//
// Executed Safe transactions: every one raises the Safe's nonce by 1, so the block of nonce n is found with a binary search
// over historical nonce() reads (about 25 eth_calls each, cached per Safe in this browser). That block's logs give the
// transaction hash; its receipt gives the token transfers (amounts, swap or send) and any FengceGuard events (limits
// installed, change requested, applied, cancelled). Agent calls through AgentExecutor (allowed and Denied) come from the
// Fengce event history. Owner transactions the guard refuses revert and leave no log: they are shown when this browser
// sent or simulated them (activity.ts), and a sent one is checked against its receipt on chain.
import { decodeEventLog, decodeFunctionData, formatUnits, parseAbi, size, slice, hexToBigInt, toEventSelector, type Address, type Hex, type Log } from "viem";
import { FengceGuardArtifact } from "@fengce/sdk";
import { client } from "../lib/chain";
import { attempts } from "./activity";
import { ABIS, ENGINE, TOKENS } from "./engine";
import { reasonOf, revertData, safeInfo } from "./wallet";
import { safeHistory } from "./reads";

export interface ActivityRow {
  /** unix seconds, or null when unknown */
  time: number | null;
  block: bigint | null;
  type: string;
  amount: string;
  /** true allowed, false refused, null not a trade (a setting change) */
  ok: boolean | null;
  result: string;
  reason: string;
  tx: Hex | null;
  /** where the row comes from */
  source: "safe" | "agent" | "browser";
}

const nonceAbi = parseAbi(["function nonce() view returns (uint256)"]);
const TRANSFER = toEventSelector("Transfer(address,address,uint256)");
const EXEC_OK = toEventSelector("ExecutionSuccess(bytes32,uint256)");
const EXEC_FAIL = toEventSelector("ExecutionFailure(bytes32,uint256)");
const SAFE_MULTISIG = toEventSelector("SafeMultiSigTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes,bytes)");
const safeL2Abi = parseAbi([
  "event SafeMultiSigTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures, bytes additionalInfo)",
]);
const guardAbi = FengceGuardArtifact.abi as any;

const tokenOf = (a: string) => Object.values(TOKENS).find((t) => t.address.toLowerCase() === a.toLowerCase());
const fmtAmt = (v: bigint, token: string) => {
  const t = tokenOf(token);
  const n = Number(formatUnits(v, t?.decimals ?? 18));
  return `${n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 4 })} ${t?.symbol ?? token.slice(0, 6) + "…"}`;
};

async function nonceAt(safe: Address, block: bigint): Promise<bigint> {
  try {
    return await client.readContract({ address: safe, abi: nonceAbi, functionName: "nonce", blockNumber: block });
  } catch {
    return 0n; // no Safe at that block yet
  }
}

interface Cache {
  /** nonce n -> block where it was used */
  blocks: Record<string, string>;
}
const ckey = (safe: Address) => `fengce-nonce-blocks:${safe.toLowerCase()}`;
function readCache(safe: Address): Cache {
  try {
    const c = JSON.parse(localStorage.getItem(ckey(safe)) ?? "null") as Cache | null;
    return c && c.blocks ? c : { blocks: {} };
  } catch {
    return { blocks: {} };
  }
}
function writeCache(safe: Address, c: Cache) {
  try {
    localStorage.setItem(ckey(safe), JSON.stringify(c));
  } catch {
    /* storage blocked: found again next time */
  }
}

/** Blocks in which the Safe executed transactions with nonce current-limit..current-1. Every nonce() probe is kept and
 * shared, newest first, so each search starts between the closest probes already made. */
async function executionBlocks(safe: Address, head: bigint, limit: number, countAt: (b: bigint) => Promise<bigint> = (b) => nonceAt(safe, b), cacheId = safe as string): Promise<{ nonce: bigint; block: bigint }[]> {
  const probes = new Map<bigint, bigint>(); // block -> nonce after that block
  const probe = async (b: bigint) => {
    if (!probes.has(b)) probes.set(b, await countAt(b));
    return probes.get(b)!;
  };
  const current = await probe(head);
  const cache = readCache(cacheId as Address);
  const first = current > BigInt(limit) ? current - BigInt(limit) : 0n;
  for (const [n, blk] of Object.entries(cache.blocks)) {
    const b = BigInt(blk);
    probes.set(b, BigInt(n) + 1n); // after the block of nonce n, the nonce is at least n+1 (only used as a bound)
    if (b > 0n && !probes.has(b - 1n)) probes.set(b - 1n, BigInt(n));
  }
  const out: { nonce: bigint; block: bigint }[] = [];
  for (let n = current - 1n; n >= first; n--) {
    const hit = cache.blocks[n.toString()];
    if (hit) {
      out.push({ nonce: n, block: BigInt(hit) });
      continue;
    }
    // bounds from known probes: lo has nonce <= n, hi has nonce > n
    let lo = -1n, hi = head;
    for (const [b, v] of probes) {
      if (v > n && b < hi) hi = b;
      if (v <= n && b > lo) lo = b;
    }
    // nothing known below: probe 8 points at once, further back each time (recent Safes are found in one round)
    if (lo < 0n) {
      let step = 2048n;
      while (lo < 0n) {
        const pts = [...Array(8).keys()].map((k) => (hi > step * 4n ** BigInt(k) ? hi - step * 4n ** BigInt(k) : 0n));
        const vals = await Promise.all(pts.map(probe));
        const i = vals.findIndex((v) => v <= n);
        if (i >= 0) {
          lo = pts[i];
          if (i > 0) hi = pts[i - 1];
        } else if (pts[7] === 0n) {
          lo = -1n;
          break;
        } else {
          hi = pts[7];
          step *= 4n ** 8n;
        }
      }
    }
    // 8-way search: smallest block in (lo, hi] with nonce > n, 7 probes per round in one batched request
    let a = lo + 1n, z = hi;
    while (a < z) {
      if (z - a < 8n) {
        const pts = [...Array(Number(z - a)).keys()].map((k) => a + BigInt(k));
        const vals = await Promise.all(pts.map(probe));
        const i = vals.findIndex((v) => v > n);
        z = i >= 0 ? pts[i] : z;
        a = z;
        break;
      }
      const span = z - a;
      const pts = [1n, 2n, 3n, 4n, 5n, 6n, 7n].map((k) => a + (span * k) / 8n);
      const vals = await Promise.all(pts.map(probe));
      const i = vals.findIndex((v) => v > n);
      if (i < 0) a = pts[6] + 1n;
      else {
        z = pts[i];
        if (i > 0) a = pts[i - 1] + 1n;
      }
    }
    out.push({ nonce: n, block: a });
    cache.blocks[n.toString()] = a.toString();
    if (n === 0n) break;
  }
  writeCache(cacheId as Address, cache);
  return out;
}

/** The transaction in `block` that used Safe nonce `nonce` (SafeL2 logs carry the nonce in additionalInfo). */
async function txForNonce(safe: Address, block: bigint, nonce: bigint): Promise<Hex | null> {
  const logs = await client.getLogs({ address: safe, fromBlock: block, toBlock: block });
  const txs = [...new Set(logs.filter((l) => l.topics[0] === EXEC_OK || l.topics[0] === EXEC_FAIL).map((l) => l.transactionHash!))];
  if (txs.length <= 1) return txs[0] ?? null;
  for (const l of logs.filter((x) => x.topics[0] === SAFE_MULTISIG)) {
    try {
      const d = decodeEventLog({ abi: safeL2Abi, data: l.data, topics: l.topics });
      const info = d.args.additionalInfo as Hex;
      if (BigInt(`0x${info.slice(2, 66)}`) === nonce) return l.transactionHash!;
    } catch {
      /* not SafeL2 */
    }
  }
  return txs[0];
}

function describeReceipt(safe: Address, logs: readonly Log[]): Pick<ActivityRow, "type" | "amount" | "ok" | "result" | "reason"> {
  const s = safe.toLowerCase();
  const failed = logs.some((l) => l.address.toLowerCase() === s && l.topics[0] === EXEC_FAIL);
  const guardEvents = logs
    .filter((l) => l.address.toLowerCase() === ENGINE.guard.toLowerCase())
    .map((l) => {
      try {
        return decodeEventLog({ abi: guardAbi, data: l.data, topics: l.topics }) as unknown as { eventName: string; args: any };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as { eventName: string; args: any }[];
  const g = guardEvents.map((e) => e.eventName);
  if (g.includes("Configured") && !g.includes("AdminExecuted")) return { type: "Limits installed", amount: "–", ok: null, result: "Done", reason: "guard and policy set" };
  if (g.includes("AdminScheduled")) return { type: "Limit change requested", amount: "–", ok: null, result: "Waiting", reason: "applies after the wait" };
  if (g.includes("AdminExecuted")) return { type: "Limit change applied", amount: "–", ok: null, result: "Done", reason: "after the wait" };
  if (g.includes("AdminCancelled")) return { type: "Limit change cancelled", amount: "–", ok: null, result: "Done", reason: "" };
  const transfers = logs
    .filter((l) => l.topics[0] === TRANSFER && l.topics.length === 3)
    .map((l) => ({ token: l.address, from: `0x${l.topics[1]!.slice(26)}`.toLowerCase(), to: `0x${l.topics[2]!.slice(26)}`.toLowerCase(), value: BigInt(l.data) }));
  const outs = transfers.filter((t) => t.from === s);
  const ins = transfers.filter((t) => t.to === s);
  const result = failed ? "Failed" : "Allowed";
  const reason = failed ? "the call inside reverted" : "within your limits";
  if (outs.length && ins.length && outs[0].token.toLowerCase() !== ins[ins.length - 1].token.toLowerCase())
    return { type: "Swap", amount: `${fmtAmt(outs[0].value, outs[0].token)} → ${fmtAmt(ins[ins.length - 1].value, ins[ins.length - 1].token)}`, ok: !failed, result, reason };
  if (outs.length) return { type: `Send to ${outs[0].to.slice(0, 6)}…${outs[0].to.slice(-4)}`, amount: fmtAmt(outs[0].value, outs[0].token), ok: !failed, result, reason };
  if (ins.length) return { type: "Received", amount: fmtAmt(ins[0].value, ins[0].token), ok: !failed, result, reason };
  return { type: "Safe transaction", amount: "–", ok: failed ? false : null, result: failed ? "Failed" : "Done", reason: failed ? reason : "" };
}

/** What an execTransaction call would have done, from its calldata (swap or send through MultiSend or directly). */
function describeExec(input: Hex): { type: string; amount: string } {
  try {
    const d = decodeFunctionData({ abi: ABIS.safe, data: input });
    if (d.functionName !== "execTransaction") return { type: "Safe transaction", amount: "–" };
    const [to, , data] = d.args as unknown as [Address, bigint, Hex];
    const calls: { to: Address; data: Hex }[] = [];
    if (to.toLowerCase() === ENGINE.multiSendCallOnly.toLowerCase()) {
      const packed = (decodeFunctionData({ abi: ABIS.multiSend, data }).args as [Hex])[0];
      let i = 0;
      while (i < size(packed)) {
        const cto = slice(packed, i + 1, i + 21) as Address;
        const len = Number(hexToBigInt(slice(packed, i + 53, i + 85)));
        calls.push({ to: cto, data: len ? (slice(packed, i + 85, i + 85 + len) as Hex) : "0x" });
        i += 85 + len;
      }
    } else calls.push({ to, data });
    for (const c of calls) {
      if (c.to.toLowerCase() === ENGINE.router.toLowerCase()) {
        const p = (decodeFunctionData({ abi: ABIS.router, data: c.data }).args as any)[0];
        const out = tokenOf(p.tokenOut)?.symbol ?? "token";
        return { type: `Swap → ${out}`, amount: fmtAmt(p.amountIn, p.tokenIn) };
      }
    }
    for (const c of calls) {
      try {
        const e = decodeFunctionData({ abi: ABIS.erc20, data: c.data });
        if (e.functionName === "transfer") {
          const [rcpt, amt] = e.args as [Address, bigint];
          return { type: `Send to ${short(rcpt)}`, amount: fmtAmt(amt, c.to) };
        }
        if (e.functionName === "approve") return { type: "Approve", amount: fmtAmt((e.args as [Address, bigint])[1], c.to) };
      } catch {
        /* not an ERC-20 call */
      }
    }
  } catch {
    /* not decodable */
  }
  return { type: "Safe transaction", amount: "–" };
}

/** Refusals recorded on chain: the owner's own transactions to the Safe that reverted. The owner's nonce rises with every
 * transaction it sends, reverted or not, so the same search finds them; the reason comes from replaying the call one block
 * earlier. Only the owner's `limit` most recent transactions are looked at. */
async function ownerRefusals(safe: Address, head: bigint, limit: number): Promise<ActivityRow[]> {
  const owners = (await safeInfo(safe).catch(() => ({ owners: [] as Address[] }))).owners.slice(0, 3);
  const rows: ActivityRow[] = [];
  for (const owner of owners) {
    const blocks = await executionBlocks(safe, head, limit, (b) => client.getTransactionCount({ address: owner, blockNumber: b }).then(BigInt), `eoa:${owner}`);
    const found = await Promise.all(
      blocks.map(async ({ nonce, block }) => {
        const blk = await client.getBlock({ blockNumber: block, includeTransactions: true });
        const tx = blk.transactions.find((t) => typeof t !== "string" && t.from.toLowerCase() === owner.toLowerCase() && BigInt(t.nonce) === nonce);
        if (!tx || typeof tx === "string" || tx.to?.toLowerCase() !== safe.toLowerCase()) return null;
        const rc = await client.getTransactionReceipt({ hash: tx.hash });
        if (rc.status !== "reverted") return null;
        let reason = "refused";
        try {
          await client.call({ account: owner, to: safe, data: tx.input, blockNumber: block - 1n, gas: tx.gas });
        } catch (e) {
          reason = reasonOf(revertData(e), (e as Error).message).text;
        }
        const what = describeExec(tx.input);
        return { time: Number(blk.timestamp), block, tx: tx.hash, source: "safe" as const, type: what.type, amount: what.amount, ok: false, result: "Refused on chain", reason };
      }),
    );
    for (const r of found) if (r) rows.push(r);
  }
  return rows;
}

/** Plain words for a Denied reason as the event history decodes it (an error name with arguments). */
export function plainReason(r: string): string {
  if (/TickDenied|Rate/i.test(r)) return "too many trades this hour";
  if (/FengceDenied|PolicyDenied|AmountGt|Denied/i.test(r)) return "over the limit";
  return r || "refused";
}

const blockTimes = new Map<bigint, number>();
async function timeOf(block: bigint): Promise<number> {
  if (!blockTimes.has(block)) blockTimes.set(block, Number((await client.getBlock({ blockNumber: block })).timestamp));
  return blockTimes.get(block)!;
}

/** Newest first. `limit` bounds how many executed Safe transactions are looked up. */
export async function safeActivity(safe: Address, limit = 25, withHistory = true): Promise<ActivityRow[]> {
  const head = await client.getBlockNumber();
  const [execs, hist, refused] = await Promise.all([
    executionBlocks(safe, head, limit),
    withHistory ? safeHistory(safe).catch(() => null) : null,
    ownerRefusals(safe, head, 15).catch(() => [] as ActivityRow[]),
  ]);
  const rows: ActivityRow[] = [];
  const found = await Promise.all(
    execs.map(async ({ nonce, block }) => {
      const tx = await txForNonce(safe, block, nonce);
      if (!tx) return null;
      const [rc, time] = await Promise.all([client.getTransactionReceipt({ hash: tx }), timeOf(block)]);
      return { time, block, tx, source: "safe" as const, ...describeReceipt(safe, rc.logs as Log[]) };
    }),
  );
  for (const r of found) if (r) rows.push(r);
  rows.push(...refused);
  for (const e of hist?.ev.agentEvents.filter((x) => x.event === "AgentExecuted") ?? [])
    rows.push({ time: null, block: BigInt(e.block), tx: e.tx, source: "agent", type: `Agent ${short(String(e.args.agent))}`, amount: "–", ok: true, result: "Allowed", reason: "within the agent's limits" });
  for (const e of hist?.ev.deniedAgentCalls ?? [])
    rows.push({ time: null, block: BigInt(e.block), tx: e.tx, source: "agent", type: `Agent ${short(String(e.args.agent))}`, amount: "–", ok: false, result: "Refused", reason: plainReason(String(e.args.reason ?? "")) });
  // agent rows: fetch block times (few)
  await Promise.all(rows.filter((r) => r.time === null && r.block !== null).map(async (r) => (r.time = await timeOf(r.block!).catch(() => null))));
  const seen = new Set(rows.map((r) => r.tx?.toLowerCase()));
  for (const a of attempts(safe)) {
    if (a.tx && seen.has(a.tx.toLowerCase())) continue;
    let onChain: "success" | "reverted" | null = null;
    if (a.tx) onChain = await client.getTransactionReceipt({ hash: a.tx }).then((r) => r.status, () => null);
    rows.push({
      time: Math.floor(a.time / 1000),
      block: null,
      tx: a.tx ?? null,
      source: "browser",
      type: a.action,
      amount: a.amount,
      ok: onChain ? onChain === "success" : a.ok,
      result: onChain === "reverted" ? "Refused on chain" : a.tx ? (a.ok ? "Allowed" : "Refused") : "Refused · simulated, not sent",
      reason: a.reason,
    });
  }
  return rows.sort((x, y) => (y.time ?? 0) - (x.time ?? 0));
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
