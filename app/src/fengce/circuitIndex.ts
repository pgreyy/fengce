// Every TapeOut circuit on X Layer for Limits → Add a circuit: the snapshot in public/circuits-index.json (written by
// app/scripts/circuits-index.mts, refreshed with the event snapshot) plus anything taped out since, read on load from
// the TapeOut factory and processors. DeWeb apps (a circuit whose site container is opened) are marked and never offered
// as limits. Tape names are "<circuit id>.2.<processor number>", e.g. 6.2.180.tape.
import { getAddress, isAddress, parseAbi, toHex, type Address, type Hex } from "viem";
import { client } from "../lib/chain";

export const FACTORY = "0x1f09DAeFA827f02CBb40967cc91b259763760761" as const;
const OPENER = "0x536adD8F30f03b69f6fbF29d425A816A0dC50106" as const;
const SITES = "0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6" as const;
const MC = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const fAbi = parseAbi(["function cpuCount() view returns (uint256)", "function cpuAt(uint256) view returns (address)"]);
export const cpuAbi = parseAbi([
  "function nextId() view returns (uint256)",
  "function circuitInfo(uint256) view returns (uint32,uint32,uint32,uint32)",
  "function eval(uint256,bytes) view returns (bytes)",
  "function netlist(uint256) view returns (bytes)",
  "function ownerOf(uint256) view returns (address)",
]);
const oAbi = parseAbi(["function accountOf(address circuits, uint256 tokenId) view returns (address)"]);
const sAbi = parseAbi(["function isOpenedContainer(address container) view returns (bool)"]);

export interface Circuit {
  p: number; // processor number (TapeOut factory index)
  cpu: Address;
  id: number;
  nIn: number;
  nOut: number;
  nState: number;
  gates: number;
  app: boolean;
  tt: string; // output bit 0 for inputs 0..2^nIn-1 ("" when not run)
  tape: string;
}

type Row = [number, number, number, number, number, number, 0 | 1, string];
interface IndexFile {
  block: string;
  processors: Address[];
  next: number[];
  circuits: Row[];
}

const toCircuit = (processors: Address[], r: Row): Circuit => ({ p: r[0], cpu: processors[r[0]], id: r[1], nIn: r[2], nOut: r[3], nState: r[4], gates: r[5], app: r[6] === 1, tt: r[7], tape: `${r[1]}.2.${r[0]}` });

async function mc<T>(calls: any[], chunk = 200): Promise<(T | null)[]> {
  const out: (T | null)[] = [];
  for (let i = 0; i < calls.length; i += chunk) {
    const r = await client.multicall({ contracts: calls.slice(i, i + chunk), multicallAddress: MC, allowFailure: true });
    out.push(...r.map((x) => (x.status === "success" ? (x.result as T) : null)));
  }
  return out;
}

let loading: Promise<{ circuits: Circuit[]; block: string; fresh: number }> | null = null;

let snapshotReady: Promise<Circuit[]> | null = null;
let resolveSnapshot: (c: Circuit[]) => void = () => undefined;

/** The snapshot alone, as soon as it is read (search and Import by ID work at once). */
export function snapshotCircuits(): Promise<Circuit[]> {
  snapshotReady ??= new Promise((r) => (resolveSnapshot = r));
  void loadCircuits();
  return snapshotReady;
}

/** The snapshot, then circuits taped out after it (read live). Cached for the page. */
export function loadCircuits(): Promise<{ circuits: Circuit[]; block: string; fresh: number }> {
  snapshotReady ??= new Promise((r) => (resolveSnapshot = r));
  loading ??= (async () => {
    // pages live one folder deep (/limits/), as for the event snapshot (reads.ts loadSnapshot)
    const base = location.pathname.split("/").filter(Boolean).length > 0 && !location.pathname.endsWith(".html") ? "../" : "./";
    const f = (await (await fetch(`${base}circuits-index.json`)).json()) as IndexFile;
    const processors = [...f.processors];
    let fresh = 0;
    const rows: Row[] = [...f.circuits];
    resolveSnapshot(rows.map((r) => toCircuit(processors, r)));
    try {
      const n = Number(await client.readContract({ address: FACTORY, abi: fAbi, functionName: "cpuCount" }));
      const added = (await mc<Address>([...Array(Math.max(0, n - processors.length)).keys()].map((i) => ({ address: FACTORY, abi: fAbi, functionName: "cpuAt", args: [BigInt(processors.length + i)] })))) as Address[];
      processors.push(...added);
      const next = await mc<bigint>(processors.map((a) => ({ address: a, abi: cpuAbi, functionName: "nextId" })));
      const todo: { p: number; id: number }[] = [];
      next.forEach((x, p) => {
        for (let id = (f.next[p] ?? 0) + 1; id <= Number(x ?? 0n); id++) todo.push({ p, id }); // nextId(): highest id so far
      });
      if (todo.length) {
        const infos = await mc<readonly [number, number, number, number]>(todo.map((c) => ({ address: processors[c.p], abi: cpuAbi, functionName: "circuitInfo", args: [BigInt(c.id)] })));
        const accts = await mc<Address>(todo.map((c) => ({ address: OPENER, abi: oAbi, functionName: "accountOf", args: [processors[c.p], BigInt(c.id)] })));
        const opened = await mc<boolean>(accts.map((a) => ({ address: SITES, abi: sAbi, functionName: "isOpenedContainer", args: [a ?? "0x0000000000000000000000000000000000000000"] })));
        todo.forEach((c, i) => {
          const x = infos[i];
          if (x) rows.push([c.p, c.id, Number(x[0]), Number(x[1]), Number(x[2]), Number(x[3]), opened[i] ? 1 : 0, ""]);
        });
        fresh = todo.length;
      }
    } catch {
      // the snapshot alone still answers
    }
    return { circuits: rows.map((r) => toCircuit(processors, r)), block: f.block, fresh };
  })();
  return loading;
}

/** Plain name of a 1- or 2-input truth table (output bit 0; index = a + 2b). */
export function describe(c: Circuit): string {
  if (c.nIn === 2) {
    const names: Record<string, string> = {
      "1110": "NAND: 0 only when a and b",
      "0001": "AND: 1 only when a and b",
      "0111": "OR: 1 when a or b",
      "1000": "NOR: 1 only when neither",
      "0110": "XOR: 1 when exactly one",
      "1001": "XNOR: 1 when both match",
      "1011": "a implies b: 0 only when a and not b",
      "1101": "b implies a: 0 only when b and not a",
      "0100": "a and not b",
      "0010": "b and not a",
      "0101": "copies a",
      "0011": "copies b",
      "1010": "not a",
      "1100": "not b",
      "1111": "always 1",
      "0000": "always 0",
    };
    if (names[c.tt]) return names[c.tt];
  }
  if (c.nIn === 1 && c.tt) return c.tt === "10" ? "NOT" : c.tt === "01" ? "copies its input" : c.tt === "11" ? "always 1" : "always 0";
  return `${c.nIn} in · ${c.nOut} out${c.nState ? ` · ${c.nState} state bits` : ""}`;
}

/** Why a circuit cannot be a limit here, or null. */
/** Plain note for a circuit with memory (state bits kept between transactions by Tick). */
export const memoryNote = (c: Circuit) => `This circuit has memory (${c.nState} state bit${c.nState === 1 ? "" : "s"}). Circuits with memory can only be added when a Safe's limits are first set up.`;
export const MEMORY_SET = "Circuits with memory can only be added when a Safe's limits are first set up.";

/** Runs a circuit with memory one step from `state` (read-only): the new state and the outputs. */
export async function stepBits(c: Circuit, state: Hex, bits: number[]): Promise<{ state: Hex; out: number[] }> {
  let v = 0;
  bits.forEach((b, i) => (v |= (b & 1) << i));
  const [ns, o] = (await client.readContract({ address: c.cpu, abi: stepAbi, functionName: "step", args: [BigInt(c.id), state, toHex(v, { size: Math.max(1, Math.ceil(c.nIn / 8)) })] })) as [Hex, Hex];
  const ob = parseInt(o.slice(2, 4) || "0", 16);
  return { state: ns, out: [...Array(Math.min(8, c.nOut)).keys()].map((i) => (ob >> i) & 1) };
}
export const zeroState = (c: Circuit) => toHex(0, { size: Math.max(1, Math.ceil(c.nState / 8)) });
const stepAbi = parseAbi(["function step(uint256 id, bytes state, bytes inputs) view returns (bytes newState, bytes outputs)"]);

export function cannotUse(c: Circuit): string | null {
  if (c.app) return "That's a TapeOut app, not a circuit.";
  if (c.nIn < 0) return "This circuit could not be read on X Layer.";
  if (c.nOut < 1) return "Can't be used as a limit: it has no output bit to decide allow or refuse.";
  if (c.nIn < 1 || c.nIn > 8) return `Can't be used as a limit here: it has ${c.nIn} inputs, and this page wires one guard fact to each input bit, up to 8.`;
  return null;
}

export type Query = { kind: "tape"; p: number; id: number } | { kind: "id"; id: number } | { kind: "address"; address: Address } | { kind: "text"; text: string } | { kind: "bad" };

export function parseQuery(q: string): Query {
  const s = q.trim().toLowerCase().replace(/^tape:\/\//, "").replace(/\/$/, "");
  const t = /^(\d+)\.2\.(\d+)(\.tape)?$/.exec(s);
  if (t) return { kind: "tape", id: Number(t[1]), p: Number(t[2]) };
  const n = /^#?(\d{1,7})$/.exec(s);
  if (n) return { kind: "id", id: Number(n[1]) };
  if (isAddress(s)) return { kind: "address", address: getAddress(s) as Address };
  if (/^0x/.test(s)) return { kind: "bad" };
  return s ? { kind: "text", text: s } : { kind: "bad" };
}

/** A container address of a DeWeb site (an app), checked on chain. */
export async function isAppContainer(a: Address): Promise<boolean> {
  return (await client.readContract({ address: SITES, abi: sAbi, functionName: "isOpenedContainer", args: [a] }).catch(() => false)) as boolean;
}

/** Runs the circuit on one input (bits little-endian, input bit 0 = lowest bit of the first byte). */
export async function evalBits(c: Circuit, bits: number[]): Promise<number[]> {
  let v = 0;
  bits.forEach((b, i) => (v |= (b & 1) << i));
  const bytes = Math.max(1, Math.ceil(c.nIn / 8));
  const input = toHex(v, { size: bytes });
  const le = `0x${(input.slice(2).match(/../g) ?? []).reverse().join("")}` as Hex;
  const out = (await client.readContract({ address: c.cpu, abi: cpuAbi, functionName: "eval", args: [BigInt(c.id), le] })) as Hex;
  const o = parseInt(out.slice(2, 4) || "0", 16);
  return [...Array(Math.min(8, c.nOut)).keys()].map((i) => (o >> i) & 1);
}
