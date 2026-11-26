// Builds the "trades per hour" counter circuit as a TAP-02 netlist and checks it on every input and state.
//
// Inputs (nIn = 7, bit 0 first): kind[0..2] = TxFacts.Kind of the call (Swap = 4), n[3..6] = N, the most swaps allowed
// in one Tick period (fixed per pin with Flag fields). State (nState = 4): count[0..3], swaps so far this period.
// Output (nOut = 1): allow.
//   isSwap = kind == 4
//   allow  = !isSwap OR count < N
//   next   = isSwap ? count + 1 : count      (Tick stores it only when allow is 1, so count + 1 <= N <= 15)
// Tick resets the state to zero at the start of each period (period 3600 s: each clock hour, UTC).
//
// Usage: npx tsx scripts/build-trade-counter.ts   (writes ../circuits/trade-counter.json)
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { toHex, type Hex } from "viem";
import { evaluateLocally, parseNetlist } from "../src/evaluate.js";

type Rec = { op: "nand"; a: number; b: number } | { op: "latch"; d: number };
const N_IN = 7;
const N_STATE = 4;
const recs: Rec[] = [];
const ZERO = 0;
const ONE = 1;
const input = (i: number) => 2 + i;
let next = 2 + N_IN;
const nand = (a: number, b: number) => {
  recs.push({ op: "nand", a, b });
  return next++;
};
const not = (a: number) => nand(a, a);
const and = (a: number, b: number) => not(nand(a, b));
const or = (a: number, b: number) => nand(not(a), not(b));
const xor = (a: number, b: number) => {
  const t = nand(a, b);
  return nand(nand(a, t), nand(b, t));
};
const mux = (sel: number, whenOne: number, whenZero: number) => nand(nand(sel, whenOne), nand(not(sel), whenZero));

// LATCHes first (their outputs are read by the gates); their d inputs point forward and are patched at the end.
const latchIx: number[] = [];
const count: number[] = [];
for (let i = 0; i < N_STATE; i++) {
  latchIx.push(recs.length);
  recs.push({ op: "latch", d: ZERO });
  count.push(next++);
}
const kind = [input(0), input(1), input(2)];
const n = [input(3), input(4), input(5), input(6)];

const isSwap = and(kind[2], and(not(kind[1]), not(kind[0])));
// count < n, most significant bit first: lt = (!c3 & n3) | (c3 == n3) & ((!c2 & n2) | ...)
let lt = ZERO;
for (let i = 0; i < N_STATE; i++) {
  const ltHere = and(not(count[i]), n[i]);
  const eq = not(xor(count[i], n[i]));
  lt = or(ltHere, and(eq, lt));
}
// count + 1
const inc: number[] = [];
let carry = ONE;
for (let i = 0; i < N_STATE; i++) {
  inc.push(xor(count[i], carry));
  carry = and(count[i], carry);
}
const nextCount = count.map((c, i) => mux(isSwap, inc[i], c));
nextCount.forEach((s, i) => ((recs[latchIx[i]] as { op: "latch"; d: number }).d = s));
// allow = !isSwap | lt = NAND(isSwap, !lt); it must be the last signal (outputs are the last nOut signals).
nand(isSwap, not(lt));

const u24 = (v: number) => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
const bytes: number[] = [];
for (const r of recs) bytes.push(...(r.op === "nand" ? [0, ...u24(r.a), ...u24(r.b)] : [1, ...u24(r.d)]));
const netlist = toHex(new Uint8Array(bytes)) as Hex;
const gates = recs.filter((r) => r.op === "nand").length;
const latches = recs.length - gates;

// ------------------------------------------------------------------ exhaustive check
const reference = (k: number, nn: number, c: number) => {
  const swap = k === 4;
  return { allow: !swap || c < nn ? 1 : 0, next: swap ? (c + 1) & 15 : c };
};
const packBits = (v: number, n: number) => toHex(new Uint8Array(Math.ceil(n / 8)).map((_, byte) => (v >> (byte * 8)) & 255)) as Hex;
const CPU = "0x0000000000000000000000000000000000000c01";
const cache = new Map([[`0x0000000000000000000000000000000000000C01:1`, { cpu: CPU, id: 1n, nIn: N_IN, nOut: 1, nState: N_STATE, records: parseNetlist(netlist) }]]);
let checked = 0;
for (let k = 0; k < 8; k++)
  for (let nn = 0; nn < 16; nn++)
    for (let c = 0; c < 16; c++) {
      const want = reference(k, nn, c);
      const r = await evaluateLocally({} as never, CPU as never, 1n, packBits(k | (nn << 3), N_IN), packBits(c, N_STATE), cache as never);
      const allow = parseInt(r.output.slice(2), 16) & 1;
      const nxt = parseInt(r.newState.slice(2), 16) & 15;
      if (allow !== want.allow || (want.allow && nxt !== want.next)) {
        throw new Error(`mismatch kind=${k} N=${nn} count=${c}: got allow ${allow} next ${nxt}, want ${JSON.stringify(want)}`);
      }
      checked++;
    }

const out = resolve(import.meta.dirname, "../../circuits/trade-counter.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify(
    {
      name: "Trades per period counter",
      description:
        "Allows any call that is not a swap. Allows a swap while the swaps counted this period are fewer than N, and counts it. Tick resets the count each period.",
      nIn: N_IN,
      nOut: 1,
      nState: N_STATE,
      gates,
      latches,
      inputs: { kind: { offset: 0, width: 3 }, n: { offset: 3, width: 4 } },
      state: { count: { offset: 0, width: 4 } },
      checked: `${checked} cases (every kind 0-7, N 0-15, count 0-15) against the reference, with the SDK's TAP-02 evaluator`,
      netlist,
    },
    null,
    2,
  ) + "\n",
);
console.log(`trade counter: ${gates} NAND + ${latches} LATCH, ${bytes.length} bytes, ${checked} cases checked -> ${out}`);
