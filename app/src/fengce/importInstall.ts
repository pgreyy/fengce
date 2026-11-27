// Import any TapeOut circuit as a limit: each input bit is fed by one guard fact (or fixed to 0 or 1), the circuit is
// pinned in PinRegistry with that schema, then installed like any other policy. Pure functions, shared by the page and
// the fork check (app/scripts/import-fork.mts). No install fee: unlisted circuits are not in the Catalog.
import { decodeErrorResult, encodeFunctionData, getAddress, keccak256, type Address, type Hex } from "viem";
import { FengceGuardArtifact, PinRegistryArtifact, parseSchema, schemaHash, toLayout, type SchemaFile } from "@fengce/sdk";
import { client } from "../lib/chain";
import { ENGINE, TOKENS, type Call, type Prepared } from "./engine";
import { cpuAbi, type Circuit } from "./circuitIndex";
import { policyInput } from "./catalogInstall";
import { V3, V3_DEFAULTS, scheduleCall, v3InstallCalls } from "./v3";

const regAbi = PinRegistryArtifact.abi as any;

/** What can feed one input bit. The v3 rules (quiet hours, hold lock, agent cap, Tilt-shield) are decided inside guard
 * v3 on its own circuits and are not facts a policy circuit can read. */
export type Fact =
  | { kind: "amountGt"; usdt0: string }
  | { kind: "tokenIs"; token: keyof typeof TOKENS }
  | { kind: "toIs"; to: string }
  | { kind: "foreign" }
  | { kind: "agent" }
  | { kind: "one" }
  | { kind: "zero" };

export const FACT_LABEL: Record<Fact["kind"], string> = {
  amountGt: "Amount over a cap (USDT0)",
  tokenIs: "Token paid is",
  toIs: "Recipient or spender is",
  foreign: "Swap proceeds go to another address",
  agent: "Sent by an agent (through AgentExecutor)",
  one: "Always 1",
  zero: "Always 0",
};
export const NOT_WIRABLE = ["Inside quiet hours", "Within a hold lock", "Over an agent's daily cap", "Tilt-shield tripped"];

/** The schema for a mapping, or the reason it is incomplete. */
export function importSchema(c: Circuit, netlist: Hex, facts: Fact[], agentExecutor: Address): SchemaFile | { error: string } {
  if (facts.length !== c.nIn) return { error: "Map every input." };
  const fields: SchemaFile["fields"] = [];
  const bindings: NonNullable<SchemaFile["bindings"]> = [];
  for (let i = 0; i < c.nIn; i++) {
    const f = facts[i];
    const name = `in${i}`;
    if (f.kind === "one" || f.kind === "zero") {
      fields.push({ name, kind: "flag", offset: i, width: 1, value: f.kind === "one" ? 1 : 0 });
      continue;
    }
    fields.push({ name, kind: "bool", offset: i, width: 1 });
    if (f.kind === "amountGt") {
      if (!/^\d+(\.\d{1,6})?$/.test(f.usdt0) || Number(f.usdt0) <= 0) return { error: `Input ${i}: enter a cap above 0.` };
      bindings.push({ field: name, source: "AmountGt", param: String(Math.round(Number(f.usdt0) * 1e6)) });
    } else if (f.kind === "tokenIs") bindings.push({ field: name, source: "TokenIs", param: BigInt(TOKENS[f.token].address).toString() });
    else if (f.kind === "toIs") {
      if (!/^0x[0-9a-fA-F]{40}$/.test(f.to)) return { error: `Input ${i}: enter an address.` };
      bindings.push({ field: name, source: "ToIs", param: BigInt(getAddress(f.to)).toString() });
    } else if (f.kind === "foreign") bindings.push({ field: name, source: "RecipientIsForeign" });
    else bindings.push({ field: name, source: "ActorIs", param: BigInt(agentExecutor).toString() });
  }
  if (!bindings.length) return { error: "Wire at least one input to a fact; with only fixed inputs the circuit decides the same way every time." };
  return parseSchema({ format: "fengce-schema/1", netlistHash: keccak256(netlist), nIn: c.nIn, fields, bindings });
}

/** The pin id this circuit gets with this schema (simulated), and whether it is pinned already. */
export async function pinFor(c: Circuit, schema: SchemaFile, from: Address): Promise<{ pinId: Hex; exists: boolean }> {
  const args = [c.cpu, BigInt(c.id), schemaHash(schema), `0x${"0".repeat(64)}`] as const;
  try {
    const { result } = await client.simulateContract({ account: from, address: ENGINE.pinRegistry, abi: regAbi, functionName: "pin", args });
    return { pinId: result as Hex, exists: false };
  } catch (e) {
    let c2: any = e;
    for (let k = 0; k < 8 && c2; k++) {
      const data = typeof c2.data === "string" ? c2.data : c2.data?.data;
      if (typeof data === "string" && data.startsWith("0x")) {
        try {
          const d = decodeErrorResult({ abi: regAbi, data: data as Hex });
          if (d.errorName === "PinExists") return { pinId: (d.args as Hex[])[0], exists: true };
        } catch {
          // not a PinRegistry error
        }
      }
      c2 = c2.cause;
    }
    throw e;
  }
}

export function pinCall(c: Circuit, schema: SchemaFile): Call {
  return { to: ENGINE.pinRegistry, value: 0n, label: `Pin circuit ${c.tape} with this mapping (PinRegistry.pin)`, data: encodeFunctionData({ abi: regAbi, functionName: "pin", args: [c.cpu, BigInt(c.id), schemaHash(schema), `0x${"0".repeat(64)}`] }) };
}

export interface ImportPlan {
  /** owner wallet transaction first (pin), when the Safe already has a guard and the circuit is not pinned */
  ownerPin: Call | null;
  /** one Safe transaction: a MultiSend batch (no guard yet) or the scheduled change */
  batch: Call[];
  schedule: Call | null;
}

/** No guard yet: pin and install guard v3 with this circuit as the policy, one signature. With a guard: the owner's
 * wallet pins (the guard reads only known calls, so the Safe cannot call PinRegistry), then the Safe schedules the
 * change; it applies after the wait like any loosening. */
export function importPlan(o: { safe: Address; circuit: Circuit; schema: SchemaFile; pinId: Hex; pinned: boolean; fengceSet: boolean; guard: Address; prepared: Prepared }): ImportPlan {
  const policy = { ...policyInput(o.pinId, o.schema) };
  const pin = o.pinned ? [] : [pinCall(o.circuit, o.schema)];
  if (!o.fengceSet) {
    if (!V3) throw new Error("guard v3 is not deployed");
    return { ownerPin: null, batch: [...pin, ...v3InstallCalls(o.safe, { ...V3_DEFAULTS, maxPerBuy: 1_000_000n, tradesPerHour: 0 }, o.prepared, policy)], schedule: null };
  }
  const target = { to: o.guard, value: 0n, label: `Use ${o.circuit.tape} as your policy`, data: encodeConfigure(policy) };
  return { ownerPin: pin[0] ?? null, batch: [], schedule: scheduleCall(target) };
}

function encodeConfigure(policy: ReturnType<typeof policyInput>): Hex {
  return encodeFunctionData({ abi: FengceGuardArtifact.abi as any, functionName: "configure", args: [policy] });
}

/** Layout used by the guard for a schema (exported for checks). */
export const layoutOf = (s: SchemaFile) => toLayout(parseSchema(s));

/** The circuit's code fingerprint: netlist hash and processor code hash. */
export async function fingerprint(c: Circuit): Promise<{ netlist: Hex; netlistHash: Hex; cpuCodehash: Hex | null; owner: Address | null }> {
  const [netlist, code, owner] = await Promise.all([
    client.readContract({ address: c.cpu, abi: cpuAbi, functionName: "netlist", args: [BigInt(c.id)] }) as Promise<Hex>,
    client.getCode({ address: c.cpu }),
    (client.readContract({ address: c.cpu, abi: cpuAbi, functionName: "ownerOf", args: [BigInt(c.id)] }) as Promise<Address>).catch(() => null),
  ]);
  return { netlist, netlistHash: keccak256(netlist), cpuCodehash: code ? keccak256(code) : null, owner };
}
