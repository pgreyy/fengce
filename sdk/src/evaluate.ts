import { type Address, type Hex, type PublicClient, decodeFunctionData, getAddress, hexToBytes, parseAbi, toHex } from "viem";
import { processorAbi } from "./abi.js";
import { BINDING_SOURCES, type SchemaFile, encodeInputs, parseSchema } from "./schema.js";

/** One decoded netlist record (TAP-02 section 2). */
export type NetRecord =
  | { op: "nand"; a: number; b: number }
  | { op: "latch"; d: number }
  | { op: "ref"; cpu: Address; id: bigint; nIns: number; nOuts: number; ins: number[] };

export interface LoadedCircuit {
  cpu: Address;
  id: bigint;
  nIn: number;
  nOut: number;
  nState: number;
  records: NetRecord[];
}

/** Strict full decoder (same rules as src/core/Netlist.sol). */
export function parseNetlist(netlist: Hex): NetRecord[] {
  const b = hexToBytes(netlist);
  const u24 = (i: number) => (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
  const out: NetRecord[] = [];
  let i = 0;
  while (i < b.length) {
    const op = b[i];
    if (op === 0) {
      if (b.length - i < 7) throw new Error(`netlist truncated at ${i}`);
      out.push({ op: "nand", a: u24(i + 1), b: u24(i + 4) });
      i += 7;
    } else if (op === 1) {
      if (b.length - i < 4) throw new Error(`netlist truncated at ${i}`);
      out.push({ op: "latch", d: u24(i + 1) });
      i += 4;
    } else if (op === 2) {
      if (b.length - i < 31) throw new Error(`netlist truncated at ${i}`);
      const nIns = b[i + 29];
      const len = 31 + 3 * nIns;
      if (b.length - i < len) throw new Error(`netlist truncated at ${i}`);
      const cpu = getAddress(toHex(b.slice(i + 1, i + 21)));
      const id = BigInt(toHex(b.slice(i + 21, i + 29)));
      const ins = [...Array(nIns).keys()].map((k) => u24(i + 31 + 3 * k));
      out.push({ op: "ref", cpu, id, nIns, nOuts: b[i + 30], ins });
      i += len;
    } else {
      throw new Error(`bad opcode 0x${op.toString(16)} at ${i}`);
    }
  }
  return out;
}

/** Loads a circuit and, recursively, every circuit it references, from chain (cached). */
export async function loadCircuit(
  client: PublicClient,
  cpu: Address,
  id: bigint,
  cache: Map<string, LoadedCircuit> = new Map(),
  blockNumber?: bigint,
): Promise<Map<string, LoadedCircuit>> {
  const key = `${getAddress(cpu)}:${id}`;
  if (cache.has(key)) return cache;
  const [info, netlist] = await Promise.all([
    client.readContract({ address: cpu, abi: processorAbi, functionName: "circuitInfo", args: [id], blockNumber }),
    client.readContract({ address: cpu, abi: processorAbi, functionName: "netlist", args: [id], blockNumber }),
  ]);
  const [nIn, nOut, nState] = info as readonly [number, number, number, number];
  const records = parseNetlist(netlist as Hex);
  cache.set(key, { cpu: getAddress(cpu), id, nIn, nOut, nState, records });
  for (const r of records) if (r.op === "ref") await loadCircuit(client, r.cpu, r.id, cache, blockNumber);
  return cache;
}

const unpack = (hex: Hex, n: number): number[] => {
  const b = hexToBytes(hex);
  return [...Array(n).keys()].map((i) => (i >> 3 < b.length ? (b[i >> 3] >> (i & 7)) & 1 : 0)); // lenient read, like the contracts
};
const pack = (bits: number[]): Hex => {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((v, i) => v && (out[i >> 3] |= 1 << (i & 7)));
  return toHex(out);
};

/** One beat (TAP-02 section 4) on bit arrays. */
function beat(c: LoadedCircuit, state: number[], inputs: number[], all: Map<string, LoadedCircuit>): { newState: number[]; outputs: number[] } {
  const s: number[] = [0, 1, ...inputs];
  const newState = [...state];
  const latches: { stateIx: number; d: number }[] = [];
  let st = 0;
  for (const r of c.records) {
    if (r.op === "nand") s.push(1 - (s[r.a] & s[r.b]));
    else if (r.op === "latch") {
      latches.push({ stateIx: st, d: r.d });
      s.push(state[st]);
      st += 1;
    } else {
      const sub = all.get(`${r.cpu}:${r.id}`)!;
      const block = state.slice(st, st + sub.nState);
      const res = beat(sub, block, r.ins.map((ix) => s[ix]), all);
      res.newState.forEach((v, k) => (newState[st + k] = v));
      s.push(...res.outputs);
      st += sub.nState;
    }
  }
  for (const l of latches) newState[l.stateIx] = s[l.d];
  return { newState, outputs: s.slice(s.length - c.nOut) };
}

/**
 * Evaluates a circuit locally from its on-chain netlist bytes, the same way the processor's step() does.
 * `input` and `state` are packed bit 0 first (missing bytes read as 0, extra bits ignored, as on chain).
 * Returns the packed outputs and new state (exactly ceil(n/8) bytes, zero padding).
 */
export async function evaluateLocally(
  client: PublicClient,
  processor: Address,
  circuitId: bigint,
  input: Hex,
  state: Hex = "0x",
  cache?: Map<string, LoadedCircuit>,
): Promise<{ output: Hex; newState: Hex }> {
  const all = await loadCircuit(client, processor, circuitId, cache);
  const c = all.get(`${getAddress(processor)}:${circuitId}`)!;
  const r = beat(c, unpack(state, c.nState), unpack(input, c.nIn), all);
  return { output: pack(r.outputs), newState: pack(r.newState) };
}

// ------------------------------------------------------------------ gate-by-gate trace

/** One record of a traced beat. Signal indices follow TAP-02: 0 = constant 0, 1 = constant 1, 2.. = inputs, then one
 * signal per NAND or LATCH and nOuts signals per REF, in record order. */
export interface TraceRecord {
  op: "nand" | "latch" | "ref";
  /** signal indices read by this record (NAND: a, b; LATCH: d, read after the beat; REF: its inputs) */
  ins: number[];
  /** signal indices this record writes */
  outs: number[];
  /** topological level: 1 + the highest level of the signals it reads (constants, inputs and latch outputs are level 0) */
  level: number;
  /** REF only: the referenced circuit and its own trace for this beat */
  ref?: { cpu: Address; id: bigint; trace: CircuitTrace };
}

export interface CircuitTrace {
  cpu: Address;
  id: bigint;
  nIn: number;
  nOut: number;
  nState: number;
  /** value (0 or 1) of every signal */
  values: number[];
  /** level of every signal (0 for constants, inputs and latch outputs) */
  levels: number[];
  records: TraceRecord[];
  /** signal indices of the outputs (the last nOut signals) */
  outputs: number[];
  /** highest level in this circuit */
  depth: number;
  newState: number[];
}

function traceBeat(c: LoadedCircuit, state: number[], inputs: number[], all: Map<string, LoadedCircuit>): CircuitTrace {
  const values: number[] = [0, 1, ...inputs];
  const levels: number[] = values.map(() => 0);
  const newState = [...state];
  const records: TraceRecord[] = [];
  const latches: { stateIx: number; d: number }[] = [];
  let st = 0;
  let depth = 0;
  for (const r of c.records) {
    if (r.op === "nand") {
      const level = 1 + Math.max(levels[r.a], levels[r.b]);
      records.push({ op: "nand", ins: [r.a, r.b], outs: [values.length], level });
      values.push(1 - (values[r.a] & values[r.b]));
      levels.push(level);
      depth = Math.max(depth, level);
    } else if (r.op === "latch") {
      latches.push({ stateIx: st, d: r.d });
      records.push({ op: "latch", ins: [r.d], outs: [values.length], level: 0 });
      values.push(state[st]);
      levels.push(0);
      st += 1;
    } else {
      const sub = all.get(`${r.cpu}:${r.id}`)!;
      const t = traceBeat(sub, state.slice(st, st + sub.nState), r.ins.map((ix) => values[ix]), all);
      t.newState.forEach((v, k) => (newState[st + k] = v));
      const level = 1 + Math.max(0, ...r.ins.map((ix) => levels[ix]));
      const outs = t.outputs.map((_, k) => values.length + k);
      records.push({ op: "ref", ins: r.ins, outs, level, ref: { cpu: r.cpu, id: r.id, trace: t } });
      for (const o of t.outputs) {
        values.push(t.values[o]);
        levels.push(level);
      }
      st += sub.nState;
      depth = Math.max(depth, level);
    }
  }
  for (const l of latches) newState[l.stateIx] = values[l.d];
  const outputs = [...Array(c.nOut).keys()].map((k) => values.length - c.nOut + k);
  return { cpu: c.cpu, id: c.id, nIn: c.nIn, nOut: c.nOut, nState: c.nState, values, levels, records, outputs, depth, newState };
}

/**
 * Evaluates a circuit like {@link evaluateLocally} and also returns every gate's output and its topological level
 * (REF sub-circuits nested), for gate-by-gate display. `output` and `newState` are packed exactly as evaluateLocally
 * returns them.
 */
export async function evaluateTrace(
  client: PublicClient,
  processor: Address,
  circuitId: bigint,
  input: Hex,
  state: Hex = "0x",
  cache?: Map<string, LoadedCircuit>,
): Promise<{ output: Hex; newState: Hex; trace: CircuitTrace }> {
  const all = await loadCircuit(client, processor, circuitId, cache);
  const c = all.get(`${getAddress(processor)}:${circuitId}`)!;
  const trace = traceBeat(c, unpack(state, c.nState), unpack(input, c.nIn), all);
  return { output: pack(trace.outputs.map((o) => trace.values[o])), newState: pack(trace.newState), trace };
}

// ------------------------------------------------------------------ pre-sign check

const tokenAbi = parseAbi(["function transfer(address,uint256)", "function approve(address,uint256)"]);

/** Facts for a plain native transfer, an ERC-20 transfer or an ERC-20 approve (the offline subset of TxFacts.decode). */
export function localFacts(account: Address, tx: { to: Address; value?: bigint; data?: Hex }) {
  const value = tx.value ?? 0n;
  const data = tx.data ?? "0x";
  const base = { account, to: tx.to, value, token: "0x0000000000000000000000000000000000000000" as Address, amount: value, selector: "0x00000000", kind: 0 };
  if (data === "0x") return base;
  if (value !== 0n || data.length !== 2 + 68 * 2) throw new Error("preSign handles native transfers, ERC-20 transfer and approve only; use the simulator for other calls");
  const d = decodeFunctionData({ abi: tokenAbi, data });
  const [who, amount] = d.args as [Address, bigint];
  return { ...base, to: who, token: tx.to, amount, selector: data.slice(0, 10), kind: d.functionName === "transfer" ? 1 : 2 };
}

function sourceValue(f: ReturnType<typeof localFacts>, source: string, param: bigint): bigint {
  switch (source) {
    case "To": return BigInt(f.to);
    case "Value": return f.value;
    case "Token": return BigInt(f.token);
    case "Amount": return f.amount;
    case "Kind": return BigInt(f.kind);
    case "AmountGt": return f.amount > param ? 1n : 0n;
    case "ToIs": return BigInt(f.to) === param ? 1n : 0n;
    case "TokenIs": return BigInt(f.token) === param ? 1n : 0n;
    case "Selector": return BigInt(f.selector);
    case "Actor": case "TokenOut": case "MinAmountOut": case "Recipient": case "Deadline": case "Action":
    case "Outflow": case "AllowanceIncrease": return 0n;
    case "ActorIs": return 0n;
    case "RecipientIsForeign": case "OutflowGt": case "AllowanceIncreaseGt": return 0n;
    default: throw new Error(`unknown source ${source}`);
  }
}

/**
 * Before signing: decode the Safe transaction into facts, encode the circuit input with the policy schema,
 * and evaluate the pinned circuit locally. Returns what the guard will decide (output bit 0), with no RPC
 * write and no simulation contract. Covers the offline subset of facts; outcome facts are 0 here.
 */
export async function preSign(
  client: PublicClient,
  policy: { processor: Address; circuitId: bigint; schema: SchemaFile },
  account: Address,
  tx: { to: Address; value?: bigint; data?: Hex },
) {
  const schema = parseSchema(policy.schema);
  if (!schema.bindings) throw new Error("schema has no bindings");
  if (!BINDING_SOURCES.length) throw new Error("no sources");
  const facts = localFacts(account, tx);
  const values: Record<string, bigint> = {};
  for (const b of schema.bindings) values[b.field] = sourceValue(facts, b.source, BigInt(b.param ?? 0));
  const input = encodeInputs(schema, values);
  const { output } = await evaluateLocally(client, policy.processor, policy.circuitId, input);
  const allow = (hexToBytes(output)[0] & 1) === 1;
  return { facts, input, output, decision: allow ? ("allow" as const) : ("deny" as const) };
}
