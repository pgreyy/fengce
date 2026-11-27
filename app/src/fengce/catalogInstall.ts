// Limits → Add a circuit: the Safe transactions that add a Fengce Catalog circuit, as pure functions (the fork check in
// app/scripts/catalog-fork.mts builds the same calls). The install fee is paid inside the Safe batch (Catalog.payInstall);
// the owner sends it as the value of execTransaction, so the Safe needs no OKB of its own.
import { encodeFunctionData, encodePacked, keccak256, type Address, type Hex } from "viem";
import { BINDING_SOURCES, CatalogArtifact, FengceGuardArtifact, TickArtifact, parseSchema, toLayout, type SchemaFile } from "@fengce/sdk";
import { DELAYS, ENGINE, ROUTER_SELECTORS, configureInput, type Call, type Prepared } from "./engine";
import { V3, V3_DEFAULTS, v3InstallCalls } from "./v3";

const guardAbi = FengceGuardArtifact.abi as any;
const tickAbi = TickArtifact.abi as any;
const catalogAbi = CatalogArtifact.abi as any;
const safeAbi = [
  { type: "function", name: "setGuard", inputs: [{ name: "guard", type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "setModuleGuard", inputs: [{ name: "moduleGuard", type: "address" }], outputs: [], stateMutability: "nonpayable" },
] as const;

/** Tick salt per Catalog pin: one group per Safe and circuit. */
export const catalogSalt = (pinId: Hex) => keccak256(encodePacked(["string", "bytes32"], ["fengce.catalog.v1", pinId]));
export const catalogGroupId = (safe: Address, pinId: Hex) =>
  keccak256(`0x${safe.slice(2).toLowerCase().padStart(64, "0")}${catalogSalt(pinId).slice(2)}` as Hex);

function bindingsOf(schema: SchemaFile) {
  const s = parseSchema(schema);
  return s.fields
    .filter((f) => f.kind !== "flag")
    .map((f) => {
      const b = s.bindings?.find((x) => x.field === f.name);
      if (!b) throw new Error(`field ${f.name} has no binding`);
      return { source: BINDING_SOURCES.indexOf(b.source), param: BigInt(b.param ?? 0) };
    });
}

export interface CatalogPlanInput {
  safe: Address;
  catalog: Address;
  pinId: Hex;
  installFee: bigint;
  schema: SchemaFile; // the circuit's schema with its bindings (netlistHash filled)
  stateful: boolean;
  /** Safe already runs a Fengce guard (configured): changes go through the timelock */
  fengceSet: boolean;
  /** the guard that takes the change: the Safe's own when set; for a Safe with no guard, guard v3 when deployed */
  guard: Address;
  /** stateful: Tick period in seconds */
  period?: bigint;
  /** stateful on a Safe without Fengce: the base max per buy (USDT0 base units) the guard needs as its stateless policy */
  baseMaxPerBuy?: bigint;
  prepared?: Prepared | null;
  /** stateful: this Safe's Tick group for the pin exists already (re-adding) */
  groupExists?: boolean;
}

export interface CatalogPlan {
  /** Safe transaction 1: one MultiSend batch (empty when nothing needs a batch) */
  batch: Call[];
  /** OKB the owner sends with the batch (the install fee) */
  value: bigint;
  /** On a Safe that already runs Fengce: the scheduled change */
  schedule: Call | null;
  groupId: Hex | null;
}

/**
 * Listings are free during launch: a free listing never calls Catalog.payInstall. A paid listing is paid as the first
 * call while the Safe has no guard yet (the guard reads only known calls, so it would refuse payInstall later); on a
 * Safe that already has a guard it is refused here with a plain message. Stateful circuits need Tick setup calls,
 * which also run only before the guard is on.
 */
export function catalogPlan(i: CatalogPlanInput): CatalogPlan {
  const groupId = i.stateful ? catalogGroupId(i.safe, i.pinId) : null;
  const G = i.guard;
  if (i.fengceSet) {
    if (i.installFee > 0n) throw new Error("Paid circuits must be added at Safe creation for now.");
    if (i.stateful) throw new Error("Stateful circuits are added when limits are first installed: once the guard is on, it does not run Tick setup calls.");
    const target = encodeFunctionData({ abi: guardAbi, functionName: "configure", args: [policyInput(i.pinId, i.schema)] });
    const schedule: Call = { to: G, value: 0n, label: "Schedule: use this circuit as your policy (applies after the wait)", data: encodeFunctionData({ abi: guardAbi, functionName: "scheduleAdmin", args: [G, target] }) };
    return { batch: [], value: 0n, schedule, groupId };
  }
  const fee: Call[] = i.installFee > 0n ? [{ to: i.catalog, value: i.installFee, label: "Pay the install fee (Catalog.payInstall: 80% designer, 20% treasury)", data: encodeFunctionData({ abi: catalogAbi, functionName: "payInstall", args: [i.pinId] }) }] : [];
  const tickSetup: Call[] = [];
  if (i.stateful) {
    if (!i.period || i.period <= 0n) throw new Error("choose a period");
    if (!i.groupExists)
      tickSetup.push(
        { to: ENGINE.tick, value: 0n, label: "Keep the circuit's state per period (Tick.createGroup)", data: encodeFunctionData({ abi: tickAbi, functionName: "createGroup", args: [catalogSalt(i.pinId), i.pinId, i.period, toLayout(parseSchema(i.schema)), bindingsOf(i.schema)] }) },
        { to: ENGINE.tick, value: 0n, label: "Add this Safe to the group (Tick.setMember)", data: encodeFunctionData({ abi: tickAbi, functionName: "setMember", args: [groupId, i.safe, true] }) },
      );
    tickSetup.push({ to: G, value: 0n, label: "Run it on every transaction (configureTick)", data: encodeFunctionData({ abi: guardAbi, functionName: "configureTick", args: [ENGINE.tick, groupId] }) });
  }
  if (!i.prepared) throw new Error("the limit circuits are not pinned yet");
  const policy = i.stateful ? undefined : policyInput(i.pinId, i.schema);
  if (V3 && G.toLowerCase() === V3.guard.toLowerCase()) {
    // guard v3, with the default rules (Tilt-shield on at 4 buys in the same half hour); the circuit is the policy, or
    // for a stateful circuit a Tick group next to a base max per buy
    const calls = v3InstallCalls(i.safe, { ...V3_DEFAULTS, maxPerBuy: i.baseMaxPerBuy ?? 1_000_000n, tradesPerHour: 0 }, i.prepared, policy);
    const at = calls.findIndex((c) => c.label.includes("setRules"));
    calls.splice(at, 0, ...tickSetup);
    return { batch: [...fee, ...calls], value: i.installFee, schedule: null, groupId };
  }
  // guard v2 (before v3 was deployed)
  const configure = i.stateful
    ? encodeFunctionData({ abi: guardAbi, functionName: "configure", args: [configureInput({ maxPerBuy: i.baseMaxPerBuy ?? 1_000_000n, tradesPerHour: 0 }, i.prepared)] })
    : encodeFunctionData({ abi: guardAbi, functionName: "configure", args: [policy] });
  const batch: Call[] = [
    ...fee,
    { to: G, value: 0n, label: i.stateful ? "Set the base max per buy (configure)" : "Use this circuit as your policy (configure)", data: configure },
    ...ROUTER_SELECTORS.map((sel) => ({ to: G, value: 0n, label: `Read swaps on SwapRouter02 (${sel})`, data: encodeFunctionData({ abi: guardAbi, functionName: "setDecoder", args: [ENGINE.router, sel, ENGINE.v3Decoder] }) as Hex })),
    ...(i.stateful ? [{ to: ENGINE.tick, value: 0n, label: "Let the guard advance it (Tick.setRelayer)", data: encodeFunctionData({ abi: tickAbi, functionName: "setRelayer", args: [G, true] }) }] : []),
    ...tickSetup,
    { to: i.safe, value: 0n, label: "Turn on the guard (Safe.setGuard)", data: encodeFunctionData({ abi: safeAbi, functionName: "setGuard", args: [G] }) },
    { to: i.safe, value: 0n, label: "Guard modules and agents too (Safe.setModuleGuard)", data: encodeFunctionData({ abi: safeAbi, functionName: "setModuleGuard", args: [G] }) },
  ];
  return { batch, value: i.installFee, schedule: null, groupId };
}

/** configure() input for a stateless Catalog circuit as the Safe's policy. */
export function policyInput(pinId: Hex, schema: SchemaFile) {
  return {
    pinId,
    layout: toLayout(parseSchema(schema)),
    bindings: bindingsOf(schema),
    recoveryDelay: DELAYS.recoveryDelay,
    recoveryWindow: DELAYS.recoveryWindow,
    adminDelay: DELAYS.adminDelay,
    preflightTokens: [] as Address[],
    preflightSpenders: [] as Address[],
    acceptExistingApprovals: false,
    acceptExistingModules: true, // as Limits → Build your own (policyChange.ts)
  };
}

/** Scheduled removal of a Catalog Tick circuit (configureTick to nothing), after the 1-day wait. */
export function removeTickCall(guard: Address = ENGINE.guard): Call {
  const target = encodeFunctionData({ abi: guardAbi, functionName: "configureTick", args: ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000000000000000000000000000"] });
  return { to: guard, value: 0n, label: "Schedule: stop running it (applies after the wait)", data: encodeFunctionData({ abi: guardAbi, functionName: "scheduleAdmin", args: [guard, target] }) };
}
