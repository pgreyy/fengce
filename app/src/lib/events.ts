import { decodeErrorResult, decodeEventLog, getAddress, parseAbi, type Abi, type Address, type Hex, type Log } from "viem";
import { CatalogArtifact, FengceGuardArtifact } from "@fengce/sdk";
import { ADDR, AGENT_EXECUTOR, CATALOG, DEPLOY_BLOCK, IN_BROWSER, LOG_WINDOW, client } from "./chain";

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

const SOURCES: { source: FengceEvent["source"]; address: Address; abi: Abi }[] = [
  { source: "guard", address: ADDR.guard, abi: FengceGuardArtifact.abi as unknown as Abi },
  { source: "agentExecutor", address: AGENT_EXECUTOR, abi: AGENT_EXECUTOR_EVENTS as unknown as Abi },
  { source: "catalog", address: CATALOG, abi: CatalogArtifact.abi as unknown as Abi },
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

/** One 100-block window, all three contracts in one eth_getLogs request. */
async function fetchWindow(from: bigint, to: bigint): Promise<FengceEvent[]> {
  const logs = await client.getLogs({ address: SOURCES.map((s) => s.address), fromBlock: from, toBlock: to });
  return logs.map((l) => decodeLog(l as Log)).filter((e): e is FengceEvent => e !== null);
}

/**
 * Reads Fengce events in [from, to] in 100-block windows (the X Layer eth_getLogs limit), oldest first. A window that
 * fails is retried with backoff; if it still fails it is counted in `failed` and the scan goes on.
 */
export async function scanEvents(from: bigint, to: bigint, onProgress?: (done: number, total: number) => void) {
  const windows: [bigint, bigint][] = [];
  for (let f = from; f <= to; f += LOG_WINDOW) windows.push([f, f + LOG_WINDOW - 1n < to ? f + LOG_WINDOW - 1n : to]);
  const parallel = IN_BROWSER ? 3 : 4;
  const events: FengceEvent[] = [];
  let failed = 0;
  let done = 0;
  const one = async (f: bigint, t: bigint) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await fetchWindow(f, t);
      } catch {
        await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      }
    }
    failed += 1;
    return [];
  };
  for (let i = 0; i < windows.length; i += parallel) {
    const got = await Promise.all(windows.slice(i, i + parallel).map(([f, t]) => one(f, t)));
    for (const g of got) events.push(...g);
    done += got.length;
    onProgress?.(done, windows.length);
  }
  events.sort((a, b) => Number(BigInt(a.block) - BigInt(b.block)) || a.logIndex - b.logIndex);
  return { events, coverage: { from: from.toString(), to: to.toString(), windows: windows.length, failed } satisfies Coverage };
}

/** Most windows a page scans live after the snapshot (10,000 blocks); anything older than that and newer than the
 * snapshot is reported as a gap. */
export const LIVE_MAX_WINDOWS = 100;

export interface History {
  events: FengceEvent[];
  snapshot: { from: string; to: string; generatedAt: string } | null;
  live: Coverage | null;
  /** blocks after the snapshot that were not scanned (too many for one page load), or null */
  gap: { from: string; to: string } | null;
  head: string;
}

/** Snapshot events plus a live scan of the blocks after it (at most LIVE_MAX_WINDOWS windows, newest first). */
export async function history(snapshot: Snapshot | null, head?: bigint): Promise<History> {
  const h = head ?? (await client.getBlockNumber());
  const start = snapshot ? BigInt(snapshot.toBlock) + 1n : DEPLOY_BLOCK;
  let liveFrom = start;
  let gap: History["gap"] = null;
  const maxBlocks = BigInt(LIVE_MAX_WINDOWS) * LOG_WINDOW;
  if (h - start + 1n > maxBlocks) {
    liveFrom = h - maxBlocks + 1n;
    gap = { from: start.toString(), to: (liveFrom - 1n).toString() };
  }
  const live = h >= liveFrom ? await scanEvents(liveFrom, h) : { events: [], coverage: null };
  return {
    events: [...(snapshot?.events ?? []), ...live.events],
    snapshot: snapshot ? { from: snapshot.fromBlock, to: snapshot.toBlock, generatedAt: snapshot.generatedAt } : null,
    live: live.coverage,
    gap,
    head: h.toString(),
  };
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
