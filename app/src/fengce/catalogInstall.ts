// Limits → Add a circuit: the Safe transactions that add a Fengce Catalog circuit, as pure functions (the fork check in
// app/scripts/catalog-fork.mts builds the same calls). The install fee is paid inside the Safe batch (Catalog.payInstall);
// the owner sends it as the value of execTransaction, so the Safe needs no OKB of its own.
import { encodeFunctionData, encodePacked, keccak256, type Address, type Hex } from "viem";
import { BINDING_SOURCES, CatalogArtifact, FengceGuardArtifact, TickArtifact, parseSchema, toLayout, type SchemaFile } from "@fengce/sdk";
import { DELAYS, ENGINE, ROUTER_SELECTORS, configureInput, type Call, type Prepared } from "./engine";

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
  /** Safe already runs FengceGuard (configured): changes go through the 1-day timelock */
  fengceSet: boolean;
  /** stateful: Tick period in seconds */
  period?: bigint;
  /** stateful on a Safe without Fengce: the base max per buy (USDT0 base units) the guard needs as its stateless policy */
  baseMaxPerBuy?: bigint;
  prepared?: Prepared | null;
  /** stateful: this Safe's Tick group for the pin exists already (re-adding) */
  groupExists?: boolean;
  /** Tick relayer already allowed for the guard */
  relayerSet?: boolean;
}

export interface CatalogPlan {
  /** Safe transaction 1: one MultiSend batch (empty when nothing needs a batch) */
  batch: Call[];
  /** OKB the owner sends with the batch (the install fee) */
  value: bigint;
  /** Safe transaction 2 on a Safe that already runs Fengce: the scheduled change (the guard refuses its own settings in a batch) */
  schedule: Call | null;
  groupId: Hex | null;
}

export function catalogPlan(i: CatalogPlanInput): CatalogPlan {
  const batch: Call[] = [];
  const fee: Call = { to: i.catalog, value: i.installFee, label: i.installFee > 0n ? "Pay the install fee (Catalog.payInstall: 80% designer, 20% treasury)" : "Record the install (Catalog.payInstall, free listing)", data: encodeFunctionData({ abi: catalogAbi, functionName: "payInstall", args: [i.pinId] }) };
  const groupId = i.stateful ? catalogGroupId(i.safe, i.pinId) : null;
  const tickSetup: Call[] = [];
  if (i.stateful) {
    if (!i.period || i.period <= 0n) throw new Error("choose a period");
    if (!i.groupExists)
      tickSetup.push(
        { to: ENGINE.tick, value: 0n, label: "Keep the circuit's state per period (Tick.createGroup)", data: encodeFunctionData({ abi: tickAbi, functionName: "createGroup", args: [catalogSalt(i.pinId), i.pinId, i.period, toLayout(parseSchema(i.schema)), bindingsOf(i.schema)] }) },
        { to: ENGINE.tick, value: 0n, label: "Add this Safe to the group (Tick.setMember)", data: encodeFunctionData({ abi: tickAbi, functionName: "setMember", args: [groupId, i.safe, true] }) },
      );
    if (!i.relayerSet) tickSetup.push({ to: ENGINE.tick, value: 0n, label: "Let the guard advance it (Tick.setRelayer)", data: encodeFunctionData({ abi: tickAbi, functionName: "setRelayer", args: [ENGINE.guard, true] }) });
  }
  const configureTick = groupId ? encodeFunctionData({ abi: guardAbi, functionName: "configureTick", args: [ENGINE.tick, groupId] }) : null;

  if (!i.fengceSet) {
    // first install: everything in one batch, guard turned on last
    let configure: Hex;
    if (i.stateful) {
      if (!i.prepared || i.baseMaxPerBuy === undefined) throw new Error("a base max per buy is needed");
      configure = encodeFunctionData({ abi: guardAbi, functionName: "configure", args: [configureInput({ maxPerBuy: i.baseMaxPerBuy, tradesPerHour: 0 }, i.prepared)] });
    } else {
      configure = encodeFunctionData({ abi: guardAbi, functionName: "configure", args: [policyInput(i.pinId, i.schema)] });
    }
    batch.push(
      fee,
      { to: ENGINE.guard, value: 0n, label: i.stateful ? "Set the base max per buy (FengceGuard.configure)" : "Use this circuit as your policy (FengceGuard.configure)", data: configure },
      ...ROUTER_SELECTORS.map((sel) => ({ to: ENGINE.guard, value: 0n, label: `Read swaps on SwapRouter02 (${sel})`, data: encodeFunctionData({ abi: guardAbi, functionName: "setDecoder", args: [ENGINE.router, sel, ENGINE.v3Decoder] }) as Hex })),
      ...tickSetup,
      ...(configureTick ? [{ to: ENGINE.guard, value: 0n, label: "Run it on every transaction (FengceGuard.configureTick)", data: configureTick }] : []),
      { to: i.safe, value: 0n, label: "Turn on the guard (Safe.setGuard)", data: encodeFunctionData({ abi: safeAbi, functionName: "setGuard", args: [ENGINE.guard] }) },
      { to: i.safe, value: 0n, label: "Guard modules and agents too (Safe.setModuleGuard)", data: encodeFunctionData({ abi: safeAbi, functionName: "setModuleGuard", args: [ENGINE.guard] }) },
    );
    return { batch, value: i.installFee, schedule: null, groupId };
  }

  // Safe already runs Fengce: the fee and any Tick setup go in the batch; the guard setting itself is scheduled (1 day)
  if (i.installFee > 0n || tickSetup.length) batch.push(fee, ...tickSetup);
  const target = configureTick ?? encodeFunctionData({ abi: guardAbi, functionName: "configure", args: [policyInput(i.pinId, i.schema)] });
  const schedule: Call = { to: ENGINE.guard, value: 0n, label: i.stateful ? "Schedule: run it on every transaction (applies after 1 day)" : "Schedule: use this circuit as your policy (applies after 1 day)", data: encodeFunctionData({ abi: guardAbi, functionName: "scheduleAdmin", args: [ENGINE.guard, target] }) };
  return { batch, value: i.installFee, schedule, groupId };
}

/** configure() input for a stateless Catalog circuit as the Safe's policy. */
function policyInput(pinId: Hex, schema: SchemaFile) {
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
export function removeTickCall(): Call {
  const target = encodeFunctionData({ abi: guardAbi, functionName: "configureTick", args: ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000000000000000000000000000"] });
  return { to: ENGINE.guard, value: 0n, label: "Schedule: stop running it (applies after 1 day)", data: encodeFunctionData({ abi: guardAbi, functionName: "scheduleAdmin", args: [ENGINE.guard, target] }) };
}
