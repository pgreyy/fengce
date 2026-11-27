// Plain-language rules: what a policy circuit refuses, worked out by running it (eth_call) on a set of example
// transactions built from the rule's own facts (each amount cap gives "at the cap" and "just over"; tokens USDT0, USDC
// and OKB; proceeds elsewhere or not; sent by an agent or not; each recipient named in a rule or another one). Every
// example is a real transaction, so impossible combinations (paid in USDT0 and USDC at once) never appear. Used by the
// Add a circuit confirm sheets (what changes, what gets looser), the mapping step (never refuses / never allows) and
// My wallet (what a scheduled change does).
import { decodeFunctionData, encodeAbiParameters, getAddress, hexToBigInt, keccak256, numberToHex, pad, parseAbi, toHex, type Address, type Hex } from "viem";
import { FengceGuardArtifact, PinRegistryArtifact, parseSchema, type SchemaFile } from "@fengce/sdk";
import { client } from "../lib/chain";
import { ENGINE, TOKENS } from "./engine";
import { PREPARED } from "./reads";

const SRC = { Value: 1, Amount: 3, AmountGt: 5, ToIs: 6, TokenIs: 7, ActorIs: 10, RecipientIsForeign: 14 } as const;
const KIND = { uint: 0, bool: 1, flag: 2 } as const;
const evalAbi = parseAbi(["function eval(uint256 id, bytes input) view returns (bytes)"]);

export interface RuleField {
  kind: 0 | 1 | 2; // Schema.Kind: Uint, Bool, Flag
  offset: number;
  width: number;
  value: bigint; // Flag only
}
export interface RuleDef {
  cpu: Address;
  id: bigint;
  nIn: number;
  nState: number;
  fields: RuleField[];
  bindings: { source: number; param: bigint }[]; // one per non-flag field, in field order
  /** the Limits page's own max per buy (pin from deployments/limits-xlayer-196.json) */
  maxBuy: boolean;
}

/** A rule from a schema (Catalog listings, imported circuits). */
export function ruleFromSchema(schema: SchemaFile, cpu: Address, id: bigint, nState = 0): RuleDef {
  const s = parseSchema(schema);
  const fields = s.fields.map((f) => ({ kind: KIND[f.kind as keyof typeof KIND] as 0 | 1 | 2, offset: f.offset, width: f.width, value: BigInt(f.value ?? 0) }));
  const bindings = s.fields
    .filter((f) => f.kind !== "flag")
    .map((f) => {
      const b = s.bindings!.find((x) => x.field === f.name)!;
      return { source: ["To", "Value", "Token", "Amount", "Kind", "AmountGt", "ToIs", "TokenIs", "Selector", "Actor", "ActorIs", "TokenOut", "MinAmountOut", "Recipient", "RecipientIsForeign"].indexOf(b.source), param: BigInt(b.param ?? 0) };
    });
  return { cpu, id, nIn: s.nIn, nState, fields, bindings, maxBuy: false };
}

async function pinInfo(pinId: Hex): Promise<{ cpu: Address; id: bigint; nIn: number; nState: number }> {
  const c = (await client.readContract({ address: ENGINE.pinRegistry, abi: PinRegistryArtifact.abi as never, functionName: "circuitPin", args: [pinId] })) as { processor: Address; circuitId: bigint; nIn: number; nState: number };
  return { cpu: getAddress(c.processor) as Address, id: c.circuitId, nIn: Number(c.nIn), nState: Number(c.nState) };
}

/** The rule a scheduled (or direct) `configure` call would set, or null when `data` is not a configure call. */
export async function ruleFromConfigure(data: Hex): Promise<RuleDef | null> {
  let input: any;
  try {
    const d = decodeFunctionData({ abi: FengceGuardArtifact.abi as any, data });
    if (d.functionName !== "configure") return null;
    input = (d.args as any[])[0];
  } catch {
    return null;
  }
  const p = await pinInfo(input.pinId);
  return {
    ...p,
    fields: (input.layout.fields as any[]).map((f) => ({ kind: Number(f.kind) as 0 | 1 | 2, offset: Number(f.offset), width: Number(f.width), value: BigInt(f.fixedValue) })),
    bindings: (input.bindings as any[]).map((b) => ({ source: Number(b.source), param: BigInt(b.param) })),
    maxBuy: !!PREPARED && String(input.pinId).toLowerCase() === PREPARED.maxBuyPin.toLowerCase(),
  };
}

/** The rule a Safe runs now, read from its Fengce guard's storage (v2 and v3 share the Config layout: _configs at slot 5;
 * pinId at +1, fields at +4 (two slots each: packed kind|offset|width, then fixedValue), bindings at +5). */
export async function currentRule(safe: Address, guard: Address): Promise<RuleDef | null> {
  const base = hexToBigInt(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [safe, 5n])));
  const at = async (slot: bigint) => {
    const v = await client.getStorageAt({ address: guard, slot: numberToHex(slot, { size: 32 }) });
    return v ? hexToBigInt(v) : 0n;
  };
  const [setWord, pinWord, nf, nb] = await Promise.all([at(base), at(base + 1n), at(base + 4n), at(base + 5n)]);
  if ((setWord & 0xffn) === 0n || nf === 0n || nf > 64n) return null;
  const fd = hexToBigInt(keccak256(pad(numberToHex(base + 4n), { size: 32 })));
  const bd = hexToBigInt(keccak256(pad(numberToHex(base + 5n), { size: 32 })));
  const fields = await Promise.all(
    [...Array(Number(nf)).keys()].map(async (i) => {
      const [w, v] = await Promise.all([at(fd + BigInt(2 * i)), at(fd + BigInt(2 * i + 1))]);
      return { kind: Number(w & 0xffn) as 0 | 1 | 2, offset: Number((w >> 8n) & 0xffffffffn), width: Number((w >> 40n) & 0xffffffffn), value: v };
    }),
  );
  const bindings = await Promise.all([...Array(Number(nb)).keys()].map(async (i) => ({ source: Number((await at(bd + BigInt(2 * i))) & 0xffn), param: await at(bd + BigInt(2 * i + 1)) })));
  const pinId = numberToHex(pinWord, { size: 32 });
  const p = await pinInfo(pinId);
  return { ...p, fields, bindings, maxBuy: !!PREPARED && pinId.toLowerCase() === PREPARED.maxBuyPin.toLowerCase() };
}

// ------------------------------------------------------------------ examples

type Tok = "USDT0" | "USDC" | "OKB";
interface Example {
  token: Tok;
  amount: bigint; // base units of that token
  foreign: boolean;
  agent: boolean;
  to: Address;
}
const OTHER = "0x000000000000000000000000000000000000dEaD" as Address;
const TOKEN_ADDR: Record<Tok, Address> = { USDT0: TOKENS.USDT0.address, USDC: TOKENS.USDC.address, OKB: TOKENS.WOKB.address };
const DEC: Record<Tok, number> = { USDT0: 6, USDC: 6, OKB: 18 };

/** Only these facts can be summarised in plain words; any other source makes the rule "not comparable". */
const SUMMARISABLE = new Set<number>([SRC.Value, SRC.Amount, SRC.AmountGt, SRC.ToIs, SRC.TokenIs, SRC.ActorIs, SRC.RecipientIsForeign]);

function examples(rules: RuleDef[]): Example[] {
  const caps = new Set<bigint>();
  const tos = new Set<string>([OTHER]);
  let agentMatters = false;
  for (const r of rules)
    for (const b of r.bindings) {
      if (b.source === SRC.AmountGt) caps.add(b.param);
      if (b.source === SRC.ToIs) tos.add(getAddress(numberToHex(b.param, { size: 20 })));
      if (b.source === SRC.ActorIs) agentMatters = true;
    }
  const amounts = new Set<bigint>([1n]);
  for (const c of caps) (amounts.add(c), amounts.add(c + 1n));
  const out: Example[] = [];
  for (const token of ["USDT0", "USDC", "OKB"] as Tok[])
    for (const amount of [...amounts].sort((a, b) => (a < b ? -1 : 1)))
      for (const foreign of [false, true])
        for (const agent of agentMatters ? [false, true] : [false])
          for (const to of tos) out.push({ token, amount, foreign, agent, to: to as Address });
  return out;
}

function factOf(b: { source: number; param: bigint }, e: Example, agentExecutors: Set<string>): bigint {
  switch (b.source) {
    case SRC.AmountGt:
      return e.amount > b.param ? 1n : 0n;
    case SRC.TokenIs:
      return BigInt(TOKEN_ADDR[e.token]) === b.param ? 1n : 0n;
    case SRC.ToIs:
      return BigInt(e.to) === b.param ? 1n : 0n;
    case SRC.ActorIs:
      return e.agent && agentExecutors.has(numberToHex(b.param, { size: 20 }).toLowerCase()) ? 1n : 0n;
    case SRC.RecipientIsForeign:
      return e.foreign ? 1n : 0n;
    case SRC.Amount:
      return e.amount;
    case SRC.Value:
      return 0n;
    default:
      return 0n;
  }
}

function inputOf(r: RuleDef, e: Example, ex: Set<string>): Hex {
  let v = 0n;
  let k = 0;
  for (const f of r.fields) {
    const raw = f.kind === 2 ? f.value : factOf(r.bindings[k++], e, ex);
    v |= (raw & ((1n << BigInt(f.width)) - 1n)) << BigInt(f.offset);
  }
  const n = Math.max(1, Math.ceil(r.nIn / 8));
  const be = toHex(v, { size: n }).slice(2).match(/../g)!;
  return `0x${be.reverse().join("")}` as Hex; // little-endian, as the guard packs it
}

async function decide(r: RuleDef, list: Example[], ex: Set<string>): Promise<boolean[]> {
  const cache = new Map<string, Promise<boolean>>();
  return Promise.all(
    list.map((e) => {
      const input = inputOf(r, e, ex);
      if (!cache.has(input))
        cache.set(input, (client.readContract({ address: r.cpu, abi: evalAbi, functionName: "eval", args: [r.id, input] }) as Promise<Hex>).then((o) => (parseInt(o.slice(2, 4) || "0", 16) & 1) === 1));
      return cache.get(input)!;
    }),
  );
}

// ------------------------------------------------------------------ words

const fmt = (t: Tok, a: bigint) => `${(Number(a) / 10 ** DEC[t]).toLocaleString("en-US", { maximumFractionDigits: DEC[t] })}`;

/** Plain phrases for a set of examples ("USDT0 payments over 30", "all OKB payments"). */
function phrases(list: Example[], hit: boolean[]): string[] {
  const out: string[] = [];
  for (const token of ["USDT0", "USDC", "OKB"] as Tok[]) {
    const mine = list.map((e, i) => ({ e, h: hit[i] })).filter((x) => x.e.token === token);
    if (!mine.some((x) => x.h)) continue;
    // which other facts matter for this token
    const keyOf = (e: Example) => `${e.foreign}|${e.agent}|${e.to}`;
    const groups = new Map<string, { e: Example; h: boolean }[]>();
    for (const x of mine) groups.set(keyOf(x.e), [...(groups.get(keyOf(x.e)) ?? []), x]);
    const sig = (g: { e: Example; h: boolean }[]) => g.map((x) => (x.h ? 1 : 0)).join("");
    const sigs = new Set([...groups.values()].map(sig));
    const amountWords = (g: { e: Example; h: boolean }[]) => {
      const a = g.map((x) => x.e.amount);
      const h = g.map((x) => x.h);
      if (h.every(Boolean)) return "";
      const first = h.indexOf(true);
      if (first > 0 && h.slice(first).every(Boolean)) return ` over ${fmt(token, a[first - 1])}`;
      const last = h.lastIndexOf(true);
      if (first === 0 && h.slice(0, last + 1).every(Boolean) && h.slice(last + 1).every((x) => !x)) return ` up to ${fmt(token, a[last])}`;
      return " of some sizes";
    };
    if (sigs.size === 1) {
      const g = [...groups.values()][0];
      const w = amountWords(g);
      out.push(w ? `${token} payments${w}` : `all ${token} payments`);
      continue;
    }
    for (const [k, g] of groups) {
      if (!g.some((x) => x.h)) continue;
      const [foreign, agent, to] = k.split("|");
      const extra = [foreign === "true" ? "when the proceeds go to another address" : null, agent === "true" ? "sent by an agent" : null, to !== OTHER ? `to ${to.slice(0, 6)}…${to.slice(-4)}` : null].filter(Boolean).join(", ");
      const w = amountWords(g);
      out.push(`${w ? `${token} payments${w}` : `all ${token} payments`}${extra ? ` ${extra}` : ""}`);
    }
  }
  return [...new Set(out)];
}

const join = (p: string[]) => (p.length <= 1 ? p.join("") : `${p.slice(0, -1).join("; ")} and ${p[p.length - 1]}`);

export interface Comparison {
  /** plain words for the current rule ("max 30 USDT0 per buy"), or null when the Safe has none */
  current: string | null;
  /** plain words for the new rule ("refuses USDC payments over 30") */
  next: string;
  /** cases the current rule refuses that the new one lets through, as a sentence, or null */
  looser: string | null;
  neverRefuses: boolean;
  neverAllows: boolean;
  /** false when a rule uses facts that cannot be put in plain words (then only `next` is a generic sentence) */
  comparable: boolean;
}

function words(r: RuleDef, list: Example[], allow: boolean[]): string {
  if (r.maxBuy) {
    const cap = r.bindings.find((b) => b.source === SRC.AmountGt);
    if (cap) return `max ${fmt("USDT0", cap.param)} USDT0 per buy`;
  }
  const refused = allow.map((a) => !a);
  if (!refused.some(Boolean)) return "refuses nothing";
  if (!allow.some(Boolean)) return "refuses every payment";
  return `refuses ${join(phrases(list, refused))}`;
}

/** Compares a new rule with the Safe's current one (or with none). */
export async function compareRules(next: RuleDef, current: RuleDef | null, agentExecutors: Address[] = []): Promise<Comparison> {
  const ex = new Set(agentExecutors.map((a) => a.toLowerCase()));
  const rules = current ? [next, current] : [next];
  const comparable = rules.every((r) => r.nState === 0 && r.bindings.every((b) => SUMMARISABLE.has(b.source)));
  if (!comparable) {
    return { current: current ? (current.maxBuy ? `max per buy (circuit #2)` : "your current circuit") : null, next: next.nState ? "a rule with memory: it decides from the transactions before it in each period" : "a rule Fengce cannot put in plain words automatically", looser: null, neverRefuses: false, neverAllows: false, comparable: false };
  }
  const list = examples(rules);
  const [na, ca] = await Promise.all([decide(next, list, ex), current ? decide(current, list, ex) : Promise.resolve(null)]);
  const looserHits = ca ? list.map((_, i) => !ca[i] && na[i]) : null;
  return {
    current: current && ca ? words(current, list, ca) : null,
    next: words(next, list, na),
    looser: looserHits && looserHits.some(Boolean) ? `${join(phrases(list, looserHits))} will no longer be blocked` : null,
    neverRefuses: na.every(Boolean),
    neverAllows: !na.some(Boolean),
    comparable: true,
  };
}

/** One sentence for a confirm sheet. */
export function replaceSentence(c: Comparison): string {
  const after = c.next === "refuses nothing" ? "After the change, your Safe refuses nothing: it would have no limit." : `After the change, your Safe ${c.next.startsWith("max") ? `has ${c.next}` : c.next}.`;
  return c.current ? `This replaces your current rule: ${c.current}. ${after}` : after;
}
