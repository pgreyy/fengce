// Reads a Safe's installed limits back from X Layer: the guard configuration (FengceGuard.configOf), the bindings that hold
// the user's numbers (read from the guard's storage, which has no getter for them), and the Tick counter's state.
import { encodeAbiParameters, getAddress, hexToBigInt, keccak256, numberToHex, pad, type Address, type Hex } from "viem";
import { TickArtifact } from "@fengce/sdk";
import { client } from "../lib/chain";
import { safeConfig, safeEvents } from "../lib/data";
import { syncHistory, type History, type Snapshot } from "../lib/events";
import { ENGINE, TOKENS, type Prepared } from "./engine";

/** deployments/okun-xlayer-196.json, if script/PrepareOkun.s.sol has been broadcast (read at build time). */
const found = import.meta.glob("../../../deployments/okun-xlayer-196.json", { eager: true, import: "default" }) as Record<string, Prepared>;
export const PREPARED: Prepared | null = Object.values(found)[0] ?? null;

/** FengceGuard storage (forge inspect FengceGuard storageLayout): _configs at slot 5; Config.bindings at +5, Binding = 2 slots. */
const CONFIGS_SLOT = 5n;
const BINDINGS_OFFSET = 5n;

export interface Binding {
  source: number;
  param: bigint;
}

async function slotAt(addr: Address, slot: bigint): Promise<bigint> {
  const v = await client.getStorageAt({ address: addr, slot: numberToHex(slot, { size: 32 }) });
  return v ? hexToBigInt(v) : 0n;
}

export async function guardBindings(safe: Address): Promise<Binding[]> {
  const base = hexToBigInt(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [safe, CONFIGS_SLOT])));
  const lenSlot = base + BINDINGS_OFFSET;
  const len = Number(await slotAt(ENGINE.guard, lenSlot));
  if (len === 0 || len > 32) return [];
  const data = hexToBigInt(keccak256(pad(numberToHex(lenSlot), { size: 32 })));
  return Promise.all(
    [...Array(len).keys()].map(async (i) => ({
      source: Number((await slotAt(ENGINE.guard, data + BigInt(2 * i))) & 0xffn),
      param: await slotAt(ENGINE.guard, data + BigInt(2 * i + 1)),
    })),
  );
}

export interface Installed {
  safe: Address;
  owners: Address[];
  threshold: number;
  version: string;
  guardOn: boolean;
  moduleGuardOn: boolean;
  set: boolean;
  pinId: Hex | null;
  /** The max per buy (or the cap of an earlier AmountGt policy), USDT0 base units */
  maxPerBuy: bigint | null;
  /** true when the pin is the Limits page's max-per-buy pin */
  okunPolicy: boolean;
  adminDelay: bigint;
  recoveryDelay: bigint;
  tick: Address | null;
  tickGroup: Hex | null;
  trades: { perHour: number; usedThisHour: number; resetsAt: number } | null;
  raw: any;
}

const ZERO = "0x0000000000000000000000000000000000000000";

export async function readInstalled(safe: Address): Promise<Installed> {
  const cfg = (await safeConfig(safe)) as any;
  const f = cfg.fengce;
  const guardOn = String(cfg.guard).toLowerCase() === ENGINE.guard.toLowerCase();
  const moduleGuardOn = String(cfg.moduleGuard).toLowerCase() === ENGINE.guard.toLowerCase();
  const set = !!f?.set;
  const bindings = set ? await guardBindings(safe) : [];
  const amountGt = bindings.find((b) => b.source === 5);
  const tick = f && f.tick && String(f.tick) !== ZERO ? (getAddress(f.tick) as Address) : null;
  let trades: Installed["trades"] = null;
  if (tick && f.tickGroup) {
    const [, pin, period, periodIndex, , state] = (await client.readContract({ address: tick, abi: TickArtifact.abi as any, functionName: "groupOf", args: [f.tickGroup] })) as [Address, Hex, bigint, bigint, bigint, Hex];
    const n = PREPARED ? Number(Object.entries(PREPARED.counterPins).find(([, p]) => p.toLowerCase() === String(pin).toLowerCase())?.[0] ?? 0) : 0;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const current = now / period;
    const used = current === periodIndex && state.length > 2 ? Number(BigInt(state) & 15n) : 0;
    trades = { perHour: n, usedThisHour: used, resetsAt: Number((current + 1n) * period) };
  }
  return {
    safe: getAddress(safe),
    owners: cfg.owners,
    threshold: Number(cfg.threshold),
    version: cfg.version,
    guardOn,
    moduleGuardOn,
    set,
    pinId: set ? f.pinId : null,
    maxPerBuy: amountGt ? amountGt.param : null,
    okunPolicy: !!PREPARED && set && String(f.pinId).toLowerCase() === PREPARED.maxBuyPin.toLowerCase(),
    adminDelay: set ? BigInt(f.adminDelay) : 0n,
    recoveryDelay: set ? BigInt(f.recoveryDelay) : 0n,
    tick,
    tickGroup: tick ? f.tickGroup : null,
    trades,
    raw: cfg,
  };
}

export const usdt0 = (base: bigint | null) => (base === null ? "–" : `${(Number(base) / 10 ** TOKENS.USDT0.decimals).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

// ------------------------------------------------------------------ events (installs, scheduled changes, agent calls)

let snap: Promise<Snapshot | null> | null = null;
export function loadSnapshot(): Promise<Snapshot | null> {
  const base = location.pathname.split("/").filter(Boolean).length > 0 && !location.pathname.endsWith(".html") ? "../" : "./";
  snap ??= fetch(`${base}events-snapshot.json`).then((r) => (r.ok ? (r.json() as Promise<Snapshot>) : null)).catch(() => null);
  return snap;
}

export async function safeHistory(safe: Address): Promise<{ h: History; ev: ReturnType<typeof safeEvents>; scheduled: { id: Hex; data: Hex; readyAt: number; done: boolean; tx: Hex; block: string }[] }> {
  const h = await syncHistory(await loadSnapshot());
  const ev = safeEvents(safe, h);
  const mine = h.events.filter((e) => e.source === "guard" && e.safe?.toLowerCase() === safe.toLowerCase());
  const closed = new Set(mine.filter((e) => e.event === "AdminExecuted" || e.event === "AdminCancelled").map((e) => String(e.args.id)));
  const scheduled = mine
    .filter((e) => e.event === "AdminScheduled")
    .map((e) => ({ id: String(e.args.id) as Hex, data: String(e.args.data) as Hex, readyAt: Number(e.args.readyAt), done: closed.has(String(e.args.id)), tx: e.tx, block: e.block }));
  return { h, ev, scheduled };
}
