// FengceGuardV3 in the app: the install the owner signs (built the same way as contracts/script/V3Lib.sol), the rules
// read back from chain, and rule changes (a change that tightens applies at once; anything else is scheduled and waits
// 1 day). Addresses come from deployments/m2-demo-xlayer-196.json, written by scripts/m2-onchain.sh.
// configure, setDecoder, configureTick, scheduleAdmin and configOf have the same signatures as in v2, so the v2 ABI
// encodes them; only the v3 functions are listed here.
import { encodeAbiParameters, encodeFunctionData, getAddress, hexToBigInt, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { FengceGuardArtifact, TickArtifact, toLayout, type SchemaFile } from "@fengce/sdk";
import m2json from "../../../deployments/m2-demo-xlayer-196.json";
import { client } from "../lib/chain";
import { ENGINE, ROUTER_SELECTORS, TICK_SALT, TOKENS, TRADE_PERIOD, configureInput, counterSchema, tickGroupId, type Call, type Prepared } from "./engine";

interface M2 {
  guard?: string;
  tiltLatchPin?: Hex;
  tiltLatchNetlistHash?: Hex;
  safe?: string;
}
const m2 = m2json as M2 | undefined;

export const V3 =
  m2?.guard && m2.tiltLatchPin && m2.tiltLatchNetlistHash
    ? { guard: getAddress(m2.guard) as Address, latchPin: m2.tiltLatchPin, latchNetlistHash: m2.tiltLatchNetlistHash, demoSafe: m2.safe ? (getAddress(m2.safe) as Address) : null }
    : null;

const RULES = "(bool quietOn, uint8 quietStart, uint8 quietEnd, uint32 holdSeconds, bool tiltOn, bytes32 tiltCountGroup, bytes32 tiltLatchGroup, uint16 tiltMultX10, uint32 tiltCooldown, address quoteToken, address partner)";
export const v3Abi = parseAbi([
  `function setRules(${RULES} r)`,
  `function rulesOf(address safe) view returns (${RULES})`,
  "function setAgentCap(address module, address agent, bool on, uint256 perDay)",
  "function extsload(bytes32 slot) view returns (bytes32)",
]);
const guardAbi = FengceGuardArtifact.abi as any;
const tickAbi = TickArtifact.abi as any;
const safeAbi = parseAbi(["function setGuard(address guard)", "function setModuleGuard(address moduleGuard)"]);

export interface Rules {
  quietOn: boolean;
  quietStart: number;
  quietEnd: number;
  holdSeconds: number;
  tiltOn: boolean;
  tiltCountGroup: Hex;
  tiltLatchGroup: Hex;
  tiltMultX10: number;
  tiltCooldown: number;
  quoteToken: Address;
  partner: Address;
}

/** Tilt-shield groups on Tick (V3Lib: salts "fengce.tilt-count.v1" and "fengce.tilt-latch.v1"). */
const TILT_COUNT_SALT = keccak256(toHex("fengce.tilt-count.v1"));
const TILT_LATCH_SALT = keccak256(toHex("fengce.tilt-latch.v1"));
export const TILT_WINDOW = 1800n; // UTC half hours
const LATCH_PERIOD = BigInt(100 * 365 * 86_400); // never resets by the clock
const group = (safe: Address, salt: Hex) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [safe, salt]));
export const countGroup = (safe: Address) => group(safe, TILT_COUNT_SALT);
export const latchGroup = (safe: Address) => group(safe, TILT_LATCH_SALT);

function latchSchema(netlistHash: Hex): SchemaFile {
  return {
    format: "fengce-schema/1",
    netlistHash,
    nIn: 3,
    fields: [
      { name: "isBuy", kind: "bool", offset: 0, width: 1 },
      { name: "trip", kind: "bool", offset: 1, width: 1 },
      { name: "clear", kind: "bool", offset: 2, width: 1 },
    ],
  };
}

/** What the owner chooses on Limits. */
export interface V3Settings {
  maxPerBuy: bigint; // USDT0 base units
  tradesPerHour: number; // 0 = off (set at install)
  tiltOn: boolean;
  tiltAfter: number; // buys in the same half hour that trip it (set at install; 4 by default)
  tiltCooldownHours: number;
  quietOn: boolean;
  quietStart: number; // UTC hour
  quietEnd: number; // UTC hour, exclusive
  holdHours: number; // 0 = off
  /** optional partner: can approve a scheduled change early; loosening then waits 7 days unless they approve */
  partner?: Address;
}
export const V3_DEFAULTS: Omit<V3Settings, "maxPerBuy" | "tradesPerHour"> = { tiltOn: true, tiltAfter: 4, tiltCooldownHours: 6, quietOn: false, quietStart: 1, quietEnd: 7, holdHours: 0 };

export function rulesFor(safe: Address, s: V3Settings, partner: Address = "0x0000000000000000000000000000000000000000"): Rules {
  return {
    quietOn: s.quietOn,
    quietStart: s.quietStart,
    quietEnd: s.quietEnd,
    holdSeconds: Math.round(s.holdHours * 3600),
    tiltOn: s.tiltOn,
    tiltCountGroup: countGroup(safe),
    tiltLatchGroup: latchGroup(safe),
    tiltMultX10: 30, // a buy over 3x the usual size also trips it
    tiltCooldown: Math.round(s.tiltCooldownHours * 3600),
    quoteToken: TOKENS.USDT0.address,
    partner,
  };
}

/** Every call of the one-signature v3 install on a Safe with no guard, guard turned on last. The Tilt-shield groups are
 * always created, so turning Tilt-shield on later is a tightening that applies at once. */
/** `policy` replaces max per buy as the guard's policy (a Catalog or imported circuit). */
export function v3InstallCalls(safe: Address, s: V3Settings, prepared: Prepared, policy?: unknown): Call[] {
  if (!V3) throw new Error("FengceGuardV3 is not deployed");
  const G = V3.guard;
  const n = s.tiltAfter - 1;
  const countPin = prepared.counterPins[String(n)];
  if (!countPin) throw new Error(`no counter pin for N = ${n}`);
  const kind = [{ source: 4, param: 0n }];
  const calls: Call[] = [
    policy
      ? { to: G, value: 0n, label: "Use this circuit as your policy (FengceGuardV3.configure)", data: encodeFunctionData({ abi: guardAbi, functionName: "configure", args: [policy] }) }
      : { to: G, value: 0n, label: "Set max per buy (FengceGuardV3.configure)", data: encodeFunctionData({ abi: guardAbi, functionName: "configure", args: [configureInput({ maxPerBuy: s.maxPerBuy, tradesPerHour: 0 }, prepared)] }) },
    ...ROUTER_SELECTORS.map((sel) => ({ to: G, value: 0n, label: `Read swaps on SwapRouter02 (${sel})`, data: encodeFunctionData({ abi: guardAbi, functionName: "setDecoder", args: [ENGINE.router, sel, ENGINE.v3Decoder] }) as Hex })),
    { to: ENGINE.tick, value: 0n, label: "Let the guard advance your counters (Tick.setRelayer)", data: encodeFunctionData({ abi: tickAbi, functionName: "setRelayer", args: [G, true] }) },
  ];
  if (s.tradesPerHour > 0) {
    const pin = prepared.counterPins[String(s.tradesPerHour)];
    if (!pin) throw new Error(`no pin for ${s.tradesPerHour} trades per hour`);
    const tg = tickGroupId(safe);
    calls.push(
      { to: ENGINE.tick, value: 0n, label: `Count swaps per hour (Tick.createGroup, ${s.tradesPerHour} per hour)`, data: encodeFunctionData({ abi: tickAbi, functionName: "createGroup", args: [TICK_SALT, pin, TRADE_PERIOD, toLayout(counterSchema(s.tradesPerHour)), kind] }) },
      { to: ENGINE.tick, value: 0n, label: "Add this Safe to its counter (Tick.setMember)", data: encodeFunctionData({ abi: tickAbi, functionName: "setMember", args: [tg, safe, true] }) },
      { to: G, value: 0n, label: "Use the counter (FengceGuardV3.configureTick)", data: encodeFunctionData({ abi: guardAbi, functionName: "configureTick", args: [ENGINE.tick, tg] }) },
    );
  }
  calls.push(
    { to: ENGINE.tick, value: 0n, label: `Tilt-shield: count buys per half hour (counter circuit #7, trips at ${s.tiltAfter})`, data: encodeFunctionData({ abi: tickAbi, functionName: "createGroup", args: [TILT_COUNT_SALT, countPin, TILT_WINDOW, toLayout(counterSchema(n)), kind] }) },
    { to: ENGINE.tick, value: 0n, label: "Tilt-shield: add this Safe to the count (Tick.setMember)", data: encodeFunctionData({ abi: tickAbi, functionName: "setMember", args: [countGroup(safe), safe, true] }) },
    { to: ENGINE.tick, value: 0n, label: "Tilt-shield: the pause latch circuit (Tick.createGroup)", data: encodeFunctionData({ abi: tickAbi, functionName: "createGroup", args: [TILT_LATCH_SALT, V3.latchPin, LATCH_PERIOD, toLayout(latchSchema(V3.latchNetlistHash)), [...kind, ...kind, ...kind]] }) },
    { to: ENGINE.tick, value: 0n, label: "Tilt-shield: add this Safe to the latch (Tick.setMember)", data: encodeFunctionData({ abi: tickAbi, functionName: "setMember", args: [latchGroup(safe), safe, true] }) },
    { to: G, value: 0n, label: s.partner ? "Rules and your partner (FengceGuardV3.setRules)" : "Quiet hours, hold lock and Tilt-shield (FengceGuardV3.setRules)", data: encodeFunctionData({ abi: v3Abi, functionName: "setRules", args: [rulesFor(safe, s, s.partner)] }) },
    { to: safe, value: 0n, label: "Turn on the guard (Safe.setGuard)", data: encodeFunctionData({ abi: safeAbi, functionName: "setGuard", args: [G] }) },
    { to: safe, value: 0n, label: "Guard modules and agents too (Safe.setModuleGuard)", data: encodeFunctionData({ abi: safeAbi, functionName: "setModuleGuard", args: [G] }) },
  );
  return calls;
}

/** v3 rule state of a Safe, read from chain. */
export interface V3State {
  rules: Rules;
  /** Tilt-shield: buys counted in the current half hour, the trip point, and the pause */
  tilt: { count: number; tripAt: number | null; paused: boolean; trippedAt: number; resumesAt: number | null; windowEnds: number } | null;
}

/** FengceRulesV3.Store at LOCATION: rules(0) caps(1) spent(2) lastBuy(3) trippedAt(4). */
const LOCATION = 0x9a57f217486e173034fca5d4a86893cc651eefd65d7136fdc890c40c96dcea92n;

export async function readV3(safe: Address, prepared: Prepared | null): Promise<V3State> {
  if (!V3) throw new Error("FengceGuardV3 is not deployed");
  const r = (await client.readContract({ address: V3.guard, abi: v3Abi, functionName: "rulesOf", args: [safe] })) as unknown as Rules;
  const rules: Rules = { ...r, quietStart: Number(r.quietStart), quietEnd: Number(r.quietEnd), holdSeconds: Number(r.holdSeconds), tiltMultX10: Number(r.tiltMultX10), tiltCooldown: Number(r.tiltCooldown) };
  const zero = /^0x0+$/;
  if (zero.test(rules.tiltCountGroup) || zero.test(rules.tiltLatchGroup)) return { rules, tilt: null };
  const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [safe, LOCATION + 4n]));
  const [c, l, t] = await Promise.all([
    client.readContract({ address: ENGINE.tick, abi: tickAbi, functionName: "groupOf", args: [rules.tiltCountGroup] }) as Promise<unknown[]>,
    client.readContract({ address: ENGINE.tick, abi: tickAbi, functionName: "groupOf", args: [rules.tiltLatchGroup] }) as Promise<unknown[]>,
    client.readContract({ address: V3.guard, abi: v3Abi, functionName: "extsload", args: [slot] }) as Promise<Hex>,
  ]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const [, cPin, cPeriod, cIndex, , cState] = c as [Address, Hex, bigint, bigint, bigint, Hex];
  const count = now / cPeriod === cIndex && cState.length > 2 ? Number(BigInt(cState) & 15n) : 0;
  const n = prepared ? Number(Object.entries(prepared.counterPins).find(([, p]) => p.toLowerCase() === cPin.toLowerCase())?.[0] ?? 0) : 0;
  const lState = (l as unknown[])[5] as Hex;
  const trippedAt = Number(hexToBigInt(t));
  const paused = lState.length > 2 && (BigInt(lState) & 1n) === 1n;
  return {
    rules,
    tilt: { count, tripAt: n ? n + 1 : null, paused, trippedAt, resumesAt: paused && trippedAt ? trippedAt + rules.tiltCooldown : null, windowEnds: Number((now / cPeriod + 1n) * cPeriod) },
  };
}

/** A rule change as guard calls. Each one is sent directly (applies at once when it tightens) or, when the guard
 * refuses it directly, scheduled with scheduleAdmin (applies after the 1-day wait). */
export function v3ChangeCalls(safe: Address, cur: { maxPerBuy: bigint | null; rules: Rules }, s: V3Settings, prepared: Prepared): Call[] {
  if (!V3) throw new Error("FengceGuardV3 is not deployed");
  const out: Call[] = [];
  if (cur.maxPerBuy !== s.maxPerBuy)
    out.push({ to: V3.guard, value: 0n, label: `Max per buy ${Number(s.maxPerBuy) / 1e6} USDT0`, data: encodeFunctionData({ abi: guardAbi, functionName: "configure", args: [{ ...configureInput({ maxPerBuy: s.maxPerBuy, tradesPerHour: 0 }, prepared), acceptExistingModules: true }] }) });
  const next = { ...rulesFor(safe, s, cur.rules.partner), tiltCountGroup: cur.rules.tiltCountGroup, tiltLatchGroup: cur.rules.tiltLatchGroup, tiltMultX10: cur.rules.tiltMultX10 || 30 };
  const same = (Object.keys(next) as (keyof Rules)[]).every((k) => String(next[k]).toLowerCase() === String(cur.rules[k]).toLowerCase());
  if (!same) out.push({ to: V3.guard, value: 0n, label: "Quiet hours, hold lock and Tilt-shield", data: encodeFunctionData({ abi: v3Abi, functionName: "setRules", args: [next] }) });
  return out;
}

export function scheduleCall(c: Call): Call {
  return { to: c.to, value: 0n, label: `${c.label} (scheduled, applies after 1 day)`, data: encodeFunctionData({ abi: guardAbi, functionName: "scheduleAdmin", args: [c.to, c.data] }) };
}
