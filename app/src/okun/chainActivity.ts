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
import { createPublicClient, http } from "viem";
import { DEPLOY_BLOCK, IN_BROWSER, RPCS, client } from "../lib/chain";

/** Probes go round-robin over every public RPC, batched, so the search shares the rate limits of both. */
const probeClients = RPCS.map((u) => createPublicClient({ transport: http(u, { retryCount: 3, retryDelay: 400, batch: IN_BROWSER ? { batchSize: 16, wait: 4 } : false }) }));
let rr = 0;
const probeClient = () => probeClients[rr++ % probeClients.length];
import { attempts } from "./activity";
import { ABIS, ENGINE, TOKENS } from "./engine";
import { reasonOf, revertData, safeInfo } from "./wallet";

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
    return await probeClient().readContract({ address: safe, abi: nonceAbi, functionName: "nonce", blockNumber: block });
  } catch (e) {
    // no Safe at that block yet: the call returns no data. Anything else (rate limit, timeout) is retried once more on
    // the other RPC and then fails the search, rather than being read as "nonce 0".
    if (/returned no data|reverted|execution reverted/i.test(String((e as Error).message))) return 0n;
    return await probeClient()
      .readContract({ address: safe, abi: nonceAbi, functionName: "nonce", blockNumber: block })
      .catch((e2) => {
        if (/returned no data|reverted/i.test(String((e2 as Error).message))) return 0n;
        throw e2;
      });
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

/** Blocks in which a counter (a Safe's nonce, or an EOA's transaction count) went from n to n+1, for the newest
 * `limit` values of n. All values are searched at once: every round sends one parallel batch of probes (a 64-point grid
 * first, then 16 points inside each interval still open), so a Safe with any number of transactions takes about five
 * round trips. The search starts at the Fengce v2 deploy block (or after the last block cached for this Safe), and the
 * results are cached in this browser, so a second visit only looks at new blocks. */
async function executionBlocks(safe: Address, head: bigint, limit: number, countAt: (b: bigint) => Promise<bigint> = (b) => nonceAt(safe, b), cacheId = safe as string, from: bigint = DEPLOY_BLOCK, minNonce = 0n): Promise<{ nonce: bigint; block: bigint }[]> {
  const cache = readCache(cacheId as Address);
  const probes = new Map<bigint, bigint>(); // block -> count after that block
  // at most 24 probes in flight: enough for one round trip per round, below the public RPCs' rate limits
  const probeAll = async (bs: bigint[]) => {
    const todo = [...new Set(bs)].filter((b) => !probes.has(b));
    for (let i = 0; i < todo.length; i += 24) {
      const part = todo.slice(i, i + 24);
      const vals = await Promise.all(part.map(countAt));
      part.forEach((b, k) => probes.set(b, vals[k]));
    }
  };
  const current = await countAt(head);
  probes.set(head, current);
  let first = current > BigInt(limit) ? current - BigInt(limit) : 0n;
  if (first < minNonce) first = minNonce;
  const cached = Object.entries(cache.blocks).map(([n, b]) => [BigInt(n), BigInt(b)] as const);
  const lastCached = cached.reduce((m, [, b]) => (b > m ? b : m), 0n);
  const lo = lastCached > from ? lastCached : from;
  const out = new Map<bigint, bigint>();
  for (const [n, b] of cached) if (n >= first) out.set(n, b);
  const targets: bigint[] = [];
  for (let n = first; n < current; n++) if (!out.has(n)) targets.push(n);
  if (targets.length) {
    // round 1: a grid over [lo, head]
    const span = head - lo;
    await probeAll([lo, ...Array.from({ length: 23 }, (_, i) => lo + (span * BigInt(i + 1)) / 24n)]);
    for (let round = 0; round < 40; round++) {
      const sorted = [...probes.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
      const want: bigint[] = [];
      let open = 0;
      for (const n of targets) {
        if (out.has(n)) continue;
        // tightest (a, b]: count(a) <= n < count(b)
        let a = -1n, b = -1n;
        for (const [blk, v] of sorted) {
          if (v <= n) a = blk;
          else {
            b = blk;
            break;
          }
        }
        if (b < 0n) continue; // not found below head (should not happen)
        if (a < 0n) {
          // the count was already above n at the first probe: that transaction is older than the search range
          out.set(n, -1n);
          continue;
        }
        if (b - a <= 1n) {
          out.set(n, b);
          continue;
        }
        open++;
        const w = b - a;
        const k = w - 1n < 12n ? w - 1n : 12n;
        for (let i = 1n; i <= k; i++) want.push(a + (w * i) / (k + 1n));
      }
      if (!open) break;
      await probeAll(want);
    }
  }
  const res = [...out.entries()].filter(([, b]) => b >= 0n).map(([nonce, block]) => ({ nonce, block }));
  for (const r of res) cache.blocks[r.nonce.toString()] = r.block.toString();
  writeCache(cacheId as Address, cache);
  return res.sort((x, y) => (x.nonce < y.nonce ? 1 : -1));
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
async function ownerRefusals(safe: Address, head: bigint, limit: number, from: bigint): Promise<ActivityRow[]> {
  const owners = (await safeInfo(safe).catch(() => ({ owners: [] as Address[] }))).owners.slice(0, 3);
  const rows: ActivityRow[] = [];
  for (const owner of owners) {
    const blocks = await executionBlocks(safe, head, limit, (b) => probeClient().getTransactionCount({ address: owner, blockNumber: b }).then(BigInt), `eoa:${owner}`, from);
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

// ------------------------------------------------------------------ rows, seeded by the event snapshot

/** Activity of one Safe as the snapshot stores it (block as a string). */
export interface SeedEntry {
  head: string; // rows cover the Safe up to this block
  nonce: string; // the Safe's nonce at `head`
  rows: (Omit<ActivityRow, "block"> & { block: string | null })[];
}
const toSeedRow = (r: ActivityRow) => ({ ...r, block: r.block === null ? null : r.block.toString() });
const fromSeedRow = (r: SeedEntry["rows"][number]): ActivityRow => ({ ...r, block: r.block === null ? null : BigInt(r.block) });

async function describeExecs(safe: Address, execs: { nonce: bigint; block: bigint }[]): Promise<ActivityRow[]> {
  const found = await Promise.all(
    execs.map(async ({ nonce, block }) => {
      const tx = await txForNonce(safe, block, nonce);
      if (!tx) return null;
      const [rc, time] = await Promise.all([client.getTransactionReceipt({ hash: tx }), timeOf(block)]);
      return { time, block, tx, source: "safe" as const, ...describeReceipt(safe, rc.logs as Log[]) };
    }),
  );
  return found.filter((r): r is NonNullable<typeof r> => r !== null);
}

/** The Safe's executed transactions after the seed (or all, without one). Returns the rows, the head and the nonce. */
export async function collect(safe: Address, limit: number, seed?: SeedEntry | null): Promise<{ head: bigint; nonce: bigint; rows: ActivityRow[] }> {
  const known = seed ? BigInt(seed.nonce) : 0n;
  const from = seed ? BigInt(seed.head) : DEPLOY_BLOCK;
  const [head, nonce] = await Promise.all([client.getBlockNumber(), client.readContract({ address: safe, abi: nonceAbi, functionName: "nonce" }).catch(() => 0n)]);
  const execs = nonce > known ? await executionBlocks(safe, head, limit, undefined, safe, from, known) : [];
  const rows = [...(await describeExecs(safe, execs)), ...(seed?.rows ?? []).map(fromSeedRow)];
  return { head, nonce, rows };
}

/** Owner refusals recorded on chain (reverted owner transactions to the Safe) after `from`. */
export async function refusalsSince(safe: Address, from: bigint, limit = 15): Promise<ActivityRow[]> {
  const head = await client.getBlockNumber();
  return ownerRefusals(safe, head, limit, from).catch(() => [] as ActivityRow[]);
}

/** Rows this browser recorded (simulated refusals, or sent ones checked against their receipt). */
export async function browserRows(safe: Address, seen: Set<string | undefined>): Promise<ActivityRow[]> {
  return Promise.all(
    attempts(safe)
      .filter((a) => !(a.tx && seen.has(a.tx.toLowerCase())))
      .map(async (a) => {
        const onChain = a.tx ? await client.getTransactionReceipt({ hash: a.tx }).then((r) => r.status, () => null) : null;
        return {
          time: Math.floor(a.time / 1000),
          block: null,
          tx: a.tx ?? null,
          source: "browser" as const,
          type: a.action,
          amount: a.amount,
          ok: onChain ? onChain === "success" : a.ok,
          result: onChain === "reverted" ? "Refused on chain" : a.tx ? (a.ok ? "Allowed" : "Refused") : "Refused · simulated, not sent",
          reason: a.reason,
        } as ActivityRow;
      }),
  );
}

/** Agent calls (AgentExecutor: allowed, and Denied with the reason) from a list of Fengce events. */
export function agentRowsFrom(safe: Address, events: { source: string; event: string; block: string; tx: Hex; safe: string | null; args: Record<string, unknown> }[]): ActivityRow[] {
  const mine = events.filter((e) => e.source === "agentExecutor" && e.safe?.toLowerCase() === safe.toLowerCase());
  return mine
    .filter((e) => e.event === "AgentExecuted" || e.event === "Denied")
    .map((e) => {
      const ok = e.event === "AgentExecuted";
      return { time: null, block: BigInt(e.block), tx: e.tx, source: "agent" as const, type: `Agent ${short(String(e.args.agent))}`, amount: "–", ok, result: ok ? "Allowed" : "Refused", reason: ok ? "within the agent's limits" : plainReason(String(e.args.reason ?? "")) };
    });
}

export async function withTimes(rows: ActivityRow[]): Promise<ActivityRow[]> {
  await Promise.all(rows.filter((r) => r.time === null && r.block !== null).map(async (r) => (r.time = await timeOf(r.block!).catch(() => null))));
  return rows;
}

const byTime = (x: ActivityRow, y: ActivityRow) => (y.time ?? 0) - (x.time ?? 0);
export function mergeRows(...lists: ActivityRow[][]): ActivityRow[] {
  const seen = new Set<string>();
  const out: ActivityRow[] = [];
  for (const r of lists.flat()) {
    const k = r.tx ? r.tx.toLowerCase() : `${r.source}:${r.time}:${r.type}:${r.amount}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out.sort(byTime);
}

/** Instant: the snapshot's rows for this Safe and this browser's simulated attempts, no RPC call (null without a seed). */
export async function seedRows(safe: Address): Promise<ActivityRow[] | null> {
  const { loadSnapshot } = await import("./reads");
  const snap = (await loadSnapshot()) as { activity?: Record<string, SeedEntry> } | null;
  const seed = snap?.activity?.[safe.toLowerCase()];
  if (!seed) return null;
  const base = seed.rows.map(fromSeedRow);
  const seen = new Set(base.map((r) => r.tx?.toLowerCase()));
  const local = attempts(safe)
    .filter((a) => !a.tx)
    .map((a) => ({ time: Math.floor(a.time / 1000), block: null, tx: null, source: "browser" as const, type: a.action, amount: a.amount, ok: a.ok, result: "Refused · simulated, not sent", reason: a.reason }) as ActivityRow);
  return mergeRows(base, local);
}

/** First paint (fast): the snapshot's rows for this Safe plus any Safe transaction since, and this browser's rows. */
export async function safeActivity(safe: Address, limit = 25): Promise<ActivityRow[]> {
  const { loadSnapshot } = await import("./reads");
  const snap = (await loadSnapshot()) as (Awaited<ReturnType<typeof loadSnapshot>> & { activity?: Record<string, SeedEntry> }) | null;
  const seed = snap?.activity?.[safe.toLowerCase()] ?? null;
  const { rows } = await collect(safe, limit, seed);
  const agent = seed ? [] : await withTimes(agentRowsFrom(safe, (snap?.events ?? []) as never));
  const base = mergeRows(rows, agent);
  return mergeRows(base, await browserRows(safe, new Set(base.map((r) => r.tx?.toLowerCase()))));
}

/** Background (slower): owner refusals after the snapshot and agent calls from the live event history. */
export async function laterRows(safe: Address): Promise<ActivityRow[]> {
  const { loadSnapshot, safeHistory } = await import("./reads");
  const snap = (await loadSnapshot()) as (Awaited<ReturnType<typeof loadSnapshot>> & { activity?: Record<string, SeedEntry> }) | null;
  const seed = snap?.activity?.[safe.toLowerCase()];
  const [refused, hist] = await Promise.all([refusalsSince(safe, seed ? BigInt(seed.head) : DEPLOY_BLOCK), safeHistory(safe).catch(() => null)]);
  const agent = hist ? await withTimes(agentRowsFrom(safe, hist.h.events as never)) : [];
  return mergeRows(refused, agent);
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
