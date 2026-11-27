// Builds the Tilt-shield latch as a TAP-02 netlist and checks it on every input and state.
//
// Inputs (nIn = 3, bit 0 first): isBuy, trip, clear. State (nState = 1): paused. Output (nOut = 1): allow.
//   held   = paused AND NOT clear          (the cooldown ended or the partner cleared it: clear = 1)
//   allow  = NOT (isBuy AND held)          (a buy while paused is refused; sells, sends and the tripping buy pass)
//   next   = trip OR held                  (Tick stores it only when allow is 1)
// FengceGuardV3 drives it through Tick.advanceFor: (1, 0, cooldownOver) on every buy, then (0, 1, 0) when the buy trips
// the shield (the counter circuit #7 reached N in the window, or the buy was 3x the usual size), and (0, 0, 1) when the
// partner clears it. The Tick group's period is very long, so the latch is never reset by the clock, only by `clear`.
//
// Usage: npx tsx scripts/build-tilt-latch.ts   (writes ../circuits/tilt-latch.json)
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { toHex, type Hex } from "viem";
import { evaluateLocally, parseNetlist } from "../src/evaluate.js";

type Rec = { op: "nand"; a: number; b: number } | { op: "latch"; d: number };
const N_IN = 3;
const recs: Rec[] = [];
const input = (i: number) => 2 + i;
let next = 2 + N_IN;
const nand = (a: number, b: number) => {
  recs.push({ op: "nand", a, b });
  return next++;
};
const not = (a: number) => nand(a, a);

recs.push({ op: "latch", d: 0 }); // patched below
const paused = next++;
const [isBuy, trip, clear] = [input(0), input(1), input(2)];
const h1 = nand(paused, not(clear)); // NOT held
const held = not(h1);
const nextPaused = nand(not(trip), h1); // trip OR held
(recs[0] as { op: "latch"; d: number }).d = nextPaused;
nand(isBuy, held); // allow: last signal

const u24 = (v: number) => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
const bytes: number[] = [];
for (const r of recs) bytes.push(...(r.op === "nand" ? [0, ...u24(r.a), ...u24(r.b)] : [1, ...u24(r.d)]));
const netlist = toHex(new Uint8Array(bytes)) as Hex;
const gates = recs.filter((r) => r.op === "nand").length;
const latches = recs.length - gates;

const CPU = "0x0000000000000000000000000000000000000c01";
const cache = new Map([[`0x0000000000000000000000000000000000000C01:1`, { cpu: CPU, id: 1n, nIn: N_IN, nOut: 1, nState: 1, records: parseNetlist(netlist) }]]);
let checked = 0;
for (let inp = 0; inp < 8; inp++)
  for (let p = 0; p < 2; p++) {
    const buy = inp & 1, tr = (inp >> 1) & 1, cl = (inp >> 2) & 1;
    const h = p & (cl ^ 1);
    const want = { allow: buy & h ? 0 : 1, next: tr | h };
    const r = await evaluateLocally({} as never, CPU as never, 1n, toHex(new Uint8Array([inp])), toHex(new Uint8Array([p])), cache as never);
    const allow = parseInt(r.output.slice(2), 16) & 1;
    const nx = parseInt(r.newState.slice(2), 16) & 1;
    if (allow !== want.allow || (want.allow && nx !== want.next)) throw new Error(`mismatch in=${inp} paused=${p}: got ${allow}/${nx}, want ${JSON.stringify(want)}`);
    checked++;
  }

const out = resolve(import.meta.dirname, "../../circuits/tilt-latch.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify(
    {
      name: "Tilt-shield latch",
      description: "Pauses buys after a trip. A buy is refused while the latch is set; sells and sends pass. Set by trip, cleared by clear (cooldown over or partner).",
      nIn: N_IN,
      nOut: 1,
      nState: 1,
      gates,
      latches,
      inputs: { isBuy: { offset: 0, width: 1 }, trip: { offset: 1, width: 1 }, clear: { offset: 2, width: 1 } },
      state: { paused: { offset: 0, width: 1 } },
      checked: `${checked} cases (every input and state) against the reference, with the SDK's TAP-02 evaluator`,
      netlist,
    },
    null,
    2,
  ) + "\n",
);
console.log(`tilt latch: ${gates} NAND + ${latches} LATCH, ${bytes.length} bytes, ${checked} cases checked -> ${out}`);
