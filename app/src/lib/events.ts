import { decodeErrorResult, decodeEventLog, getAddress, parseAbi, type Abi, type Address, type Hex, type Log } from "viem";
import { CatalogArtifact, FengceGuardArtifact } from "@fengce/sdk";
import m2 from "../../../deployments/m2-demo-xlayer-196.json";
import { ADDR, AGENT_EXECUTOR, CATALOG, DEPLOY_BLOCK, client } from "./chain";

/** Every Fengce event of release v2: FengceGuard (installs, timelocks, recovery), AgentExecutor (agents, Denied) and
 * Catalog (listings, fees). */
export interface FengceEvent {
  source: "guard" | "agentExecutor" | "catalog";
  event: string;
  block: string;
  tx: Hex;
  logIndex: number;
  /** the Safe the event is about, when it has one */
  safe: Address | null;
  /** event arguments, JSON-safe (numbers as strings); Denied.reason is decoded when possible */
  args: Record<string, string | boolean | string[]>;
}

export interface Coverage {
  from: string;
  to: string;
  windows: number;
  /** windows the RPC still did not answer after a retry; their blocks were not read */
  failed: number;
}

export interface Snapshot {
  format: "fengce-events/1";
  chainId: 196;
  release: "v2";
  contracts: { guard: Address; agentExecutor: Address; catalog: Address };
  fromBlock: string;
  toBlock: string;
  generatedAt: string;
  events: FengceEvent[];
}

const AGENT_EXECUTOR_EVENTS = parseAbi([
  "event AgentAdded(address indexed safe, address indexed agent, uint64 expiresAt)",
  "event AgentRevoked(address indexed safe, address indexed agent, address by)",
  "event AgentExecuted(address indexed safe, address indexed agent, address to, uint256 value, bytes32 dataHash)",
  "event Denied(address indexed safe, address indexed agent, address target, bytes32 factsHash, bytes reason)",
]);

const V3_EVENTS = parseAbi(["event Refused(address indexed safe, address indexed by, uint8 indexed reason, address to, bytes32 dataHash)"]) as unknown as Abi;

const SOURCES: { source: FengceEvent["source"]; address: Address; abi: Abi }[] = [
  { source: "guard", address: ADDR.guard, abi: FengceGuardArtifact.abi as unknown as Abi },
  { source: "agentExecutor", address: AGENT_EXECUTOR, abi: AGENT_EXECUTOR_EVENTS as unknown as Abi },
  { source: "catalog", address: CATALOG, abi: CatalogArtifact.abi as unknown as Abi },
  // Milestone 2: FengceGuardV3 (same timelock events as v2, plus Refused) and AgentExecutorV3 (same agent events)
  { source: "guard", address: getAddress(m2.guard), abi: [...(FengceGuardArtifact.abi as unknown as Abi), ...V3_EVENTS] as Abi },
  { source: "agentExecutor", address: getAddress(m2.agentExecutor), abi: AGENT_EXECUTOR_EVENTS as unknown as Abi },
];

function jsonSafe(v: unknown): string | boolean | string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "boolean") return v;
  return String(v);
}

function decodeReason(data: Hex): string {
  try {
    const d = decodeErrorResult({ abi: FengceGuardArtifact.abi as unknown as Abi, data });
    return `${d.errorName}(${(d.args ?? []).map(String).join(", ")})`;
  } catch {
    return data;
  }
}

export function decodeLog(log: Log): FengceEvent | null {
  const src = SOURCES.find((s) => s.address.toLowerCase() === log.address.toLowerCase());
  if (!src) return null;
  try {
    const d = decodeEventLog({ abi: src.abi, data: log.data, topics: log.topics }) as unknown as { eventName: string; args: Record<string, unknown> };
    const args: FengceEvent["args"] = {};
    for (const [k, v] of Object.entries(d.args ?? {})) args[k] = jsonSafe(v);
    if (d.eventName === "Denied" && typeof d.args.reason === "string") args.reason = decodeReason(d.args.reason as Hex);
    const safe = typeof d.args.safe === "string" ? getAddress(d.args.safe as string) : null;
    return { source: src.source, event: d.eventName, block: String(log.blockNumber), tx: log.transactionHash!, logIndex: Number(log.logIndex), safe, args };
  } catch {
    return null; // an event this app does not know
  }
}

// ------------------------------------------------------------------ scanning

/** Inclusive block span of one eth_getLogs request: every public X Layer RPC answers at most 101 blocks (checked
 * 2026-11-25: rpc.xlayer.tech and xlayerrpc.okx.com "block range greater than 100 max", dRPC free plan the same). */
export const LOG_SPAN = 101n;
const env: Record<string, string | undefined> = typeof process !== "undefined" && process.env ? process.env : {};
/** RPCs used for log scans. Each answers browser CORS requests and allows about 7 requests per second per visitor
 * (ratelimit-limit headers; batches count every call), so the scan is paced per RPC and spread over all of them. All
 * four are on the TapeOut gateway's X Layer node list. XLAYER_RPC (Node only) is added first. */
export const LOG_RPCS = [
  ...(env.XLAYER_RPC ? [env.XLAYER_RPC] : []),
  "https://rpc.xlayer.tech",
  "https://xlayerrpc.okx.com",
  "https://xlayer.drpc.org",
  "https://196.rpc.thirdweb.com",
];
const PER_SECOND = 5;

interface Endpoint {
  url: string;
  next: number;
}
const pool: Endpoint[] = LOG_RPCS.map((url) => ({ url, next: 0 }));

/** Waits for the RPC whose next free slot is earliest and books the slot after it. */
async function acquire(avoid?: string): Promise<Endpoint> {
  const cands = pool.length > 1 && avoid ? pool.filter((e) => e.url !== avoid) : pool;
  const e = cands.reduce((a, b) => (b.next < a.next ? b : a));
  const now = Date.now();
  const at = Math.max(now, e.next);
  e.next = at + 1000 / PER_SECOND;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
  return e;
}

interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  logIndex: Hex;
  transactionHash: Hex;
}

async function getLogs(url: string, from: bigint, to: bigint): Promise<FengceEvent[]> {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 15_000) : null;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getLogs",
        params: [{ address: SOURCES.map((s) => s.address), fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }],
      }),
      signal: ctl?.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { result?: RawLog[]; error?: { message: string } };
    if (!j.result) throw new Error(j.error?.message ?? "no result");
    return j.result
      .map((l) =>
        decodeLog({ ...l, blockNumber: BigInt(l.blockNumber), logIndex: Number(l.logIndex), transactionIndex: 0, blockHash: null, removed: false } as unknown as Log),
      )
      .filter((e): e is FengceEvent => e !== null);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface ScanOptions {
  onProgress?: (done: number, total: number) => void;
  /** called as the contiguous scanned prefix grows: every window up to `toBlock` was read */
  onPrefix?: (toBlock: bigint, events: FengceEvent[]) => void;
}

/**
 * Reads Fengce events in [from, to] in 101-block windows, all three contracts per request, paced per RPC and spread
 * over every RPC in LOG_RPCS. A window that fails is retried on another RPC; if it still fails it is counted in
 * `failed` and the scan goes on. Events come back oldest first.
 */
export async function scanEvents(from: bigint, to: bigint, opts: ScanOptions | ((done: number, total: number) => void) = {}) {
  const o: ScanOptions = typeof opts === "function" ? { onProgress: opts } : opts;
  const windows: [bigint, bigint][] = [];
  for (let f = from; f <= to; f += LOG_SPAN) windows.push([f, f + LOG_SPAN - 1n < to ? f + LOG_SPAN - 1n : to]);
  const results: (FengceEvent[] | null | undefined)[] = new Array(windows.length).fill(undefined);
  let failed = 0;
  let done = 0;
  let next = 0;
  let prefix = 0; // windows [0, prefix) all answered
  const one = async (k: number) => {
    const [f, t] = windows[k];
    let last: string | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const e = await acquire(last);
      try {
        return await getLogs(e.url, f, t);
      } catch {
        last = e.url;
        e.next = Math.max(e.next, Date.now() + 1000 * (attempt + 1)); // back off this RPC
      }
    }
    return null;
  };
  const worker = async () => {
    while (next < windows.length) {
      const k = next++;
      const r = await one(k);
      results[k] = r;
      if (r === null) failed += 1;
      done += 1;
      o.onProgress?.(done, windows.length);
      let moved = false;
      while (prefix < windows.length && results[prefix] !== undefined && results[prefix] !== null) {
        prefix += 1;
        moved = true;
      }
      if (moved && o.onPrefix && (prefix % 50 === 0 || prefix === windows.length)) {
        o.onPrefix(windows[prefix - 1][1], results.slice(0, prefix).flat() as FengceEvent[]);
      }
    }
  };
  await Promise.all([...Array(Math.min(windows.length, pool.length * 3))].map(worker));
  const events = (results.filter(Boolean) as FengceEvent[][]).flat();
  events.sort((a, b) => Number(BigInt(a.block) - BigInt(b.block)) || a.logIndex - b.logIndex);
  return { events, coverage: { from: from.toString(), to: to.toString(), windows: windows.length, failed } satisfies Coverage };
}

/** Most windows a server-side request scans live after the snapshot (about 10,000 blocks); the rest is a gap. */
export const LIVE_MAX_WINDOWS = 100;
/** Most windows a browser scans after the snapshot (about 300,000 blocks, several days); it runs in the background. */
export const BROWSER_MAX_WINDOWS = 3000;

export interface History {
  events: FengceEvent[];
  snapshot: { from: string; to: string; generatedAt: string } | null;
  live: Coverage | null;
  /** blocks after the snapshot that were not scanned (too many for one page load), or null */
  gap: { from: string; to: string } | null;
  head: string;
  /** blocks read from this browser's cache of an earlier visit, or null */
  cached?: { from: string; to: string } | null;
}

/** Snapshot events plus a live scan of the blocks after it (at most `maxWindows` windows, newest kept). */
export async function history(snapshot: Snapshot | null, head?: bigint, maxWindows = LIVE_MAX_WINDOWS): Promise<History> {
  const h = head ?? (await client.getBlockNumber());
  const start = snapshot ? BigInt(snapshot.toBlock) + 1n : DEPLOY_BLOCK;
  const { liveFrom, gap } = window_(start, h, maxWindows);
  const live = h >= liveFrom ? await scanEvents(liveFrom, h) : { events: [], coverage: null };
  return {
    events: [...(snapshot?.events ?? []), ...live.events],
    snapshot: snapshot ? { from: snapshot.fromBlock, to: snapshot.toBlock, generatedAt: snapshot.generatedAt } : null,
    live: live.coverage,
    gap,
    head: h.toString(),
  };
}

function window_(start: bigint, head: bigint, maxWindows: number) {
  const maxBlocks = BigInt(maxWindows) * LOG_SPAN;
  if (head - start + 1n > maxBlocks) {
    const liveFrom = head - maxBlocks + 1n;
    return { liveFrom, gap: { from: start.toString(), to: (liveFrom - 1n).toString() } };
  }
  return { liveFrom: start, gap: null };
}

// ------------------------------------------------------------------ browser sync (background, cached)

interface CacheEntry {
  fromBlock: string;
  toBlock: string;
  events: FengceEvent[];
}
const CACHE_KEY = `fengce-events:v3:${ADDR.guard.toLowerCase()}`;

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const c = raw ? (JSON.parse(raw) as CacheEntry) : null;
    return c && typeof c.fromBlock === "string" && typeof c.toBlock === "string" && Array.isArray(c.events) ? c : null;
  } catch {
    return null;
  }
}
function writeCache(c: CacheEntry) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* storage blocked or full: the next visit scans again */
  }
}

export interface SyncState {
  phase: "syncing" | "done" | "error";
  done: number;
  total: number;
  history: History | null;
  error?: string;
}

let syncPromise: Promise<History> | null = null;
let syncState: SyncState = { phase: "syncing", done: 0, total: 0, history: null };
const listeners = new Set<(s: SyncState) => void>();
function emit(s: Partial<SyncState>) {
  syncState = { ...syncState, ...s };
  for (const l of listeners) l(syncState);
}
export function onSync(l: (s: SyncState) => void): () => void {
  listeners.add(l);
  l(syncState);
  return () => listeners.delete(l);
}

/**
 * Browser only: the snapshot, then this browser's cache of earlier visits, then a background scan of the blocks after
 * both. One sync per page, shared by every view; progress goes to onSync listeners. The cache keeps the contiguous
 * range read after the snapshot, so a second visit only scans the blocks added since.
 */
export function syncHistory(snapshot: Snapshot | null): Promise<History> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const h = await client.getBlockNumber();
    const snapTo = snapshot ? BigInt(snapshot.toBlock) : DEPLOY_BLOCK - 1n;
    const c = readCache();
    const usable = c && BigInt(c.fromBlock) <= snapTo + 1n && BigInt(c.toBlock) > snapTo ? c : null;
    const cachedEvents = usable ? usable.events.filter((e) => BigInt(e.block) > snapTo) : [];
    const start = usable ? BigInt(usable.toBlock) + 1n : snapTo + 1n;
    const { liveFrom, gap } = window_(start, h, BROWSER_MAX_WINDOWS);
    const keepFrom = gap ? liveFrom : usable ? BigInt(usable.fromBlock) : snapTo + 1n;
    const base = gap ? [] : cachedEvents;
    const save = (toBlock: bigint, scanned: FengceEvent[]) => writeCache({ fromBlock: keepFrom.toString(), toBlock: toBlock.toString(), events: [...base, ...scanned] });
    const live = h >= liveFrom ? await scanEvents(liveFrom, h, { onProgress: (done, total) => emit({ done, total }), onPrefix: save }) : { events: [], coverage: null };
    const result: History = {
      events: [...(snapshot?.events ?? []), ...base, ...live.events],
      snapshot: snapshot ? { from: snapshot.fromBlock, to: snapshot.toBlock, generatedAt: snapshot.generatedAt } : null,
      live: live.coverage,
      gap,
      head: h.toString(),
      cached: usable && !gap ? { from: usable.fromBlock, to: usable.toBlock } : null,
    };
    emit({ phase: "done", history: result });
    return result;
  })().catch((e) => {
    emit({ phase: "error", error: e instanceof Error ? e.message : String(e) });
    throw e;
  });
  return syncPromise;
}

/** Installs per pin: distinct Safes whose FengceGuard configuration names that pin (Configured events). */
export function installsByPin(events: FengceEvent[]): Map<string, number> {
  const safes = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.source !== "guard" || e.event !== "Configured" || !e.safe) continue;
    const pin = String(e.args.pinId).toLowerCase();
    if (!safes.has(pin)) safes.set(pin, new Set());
    safes.get(pin)!.add(e.safe.toLowerCase());
  }
  return new Map([...safes].map(([k, v]) => [k, v.size]));
}
