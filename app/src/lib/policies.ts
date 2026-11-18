import type { Address, Hex } from "viem";
import type { SchemaFile } from "@fengce/sdk";

export interface PolicyVector {
  input: Hex;
  state?: Hex; // stateful circuits: the state before the step
  decision: "allow" | "deny";
  reason: string;
}

/** Known policies on X Layer: deployed circuits with a schema, a plain description and the circuit construction. */
export interface PolicyPreset {
  key: string;
  name: string; // display name
  processor: Address;
  id: bigint;
  description: string; // what it does, in plain words (shown everywhere)
  construction: string; // how the circuit is built (shown on the detail page only)
  stateful?: boolean;
  /** schema with bindings for a cap; netlistHash is filled from the live netlist by the data layer */
  schema: (cap: bigint) => SchemaFile;
  vectors: PolicyVector[];
}

const ZERO: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

export const PRESETS: PolicyPreset[] = [
  {
    key: "nand-limit",
    name: "Stablecoin Transfer Limit",
    processor: "0x839bdD6fa7A66416A609A735e11DE5411B98574e",
    id: 2n,
    description: "Allows a transfer only when its amount is at most the cap set for the account.",
    construction:
      "One NAND gate built from 3 NAND records. Input a = the amount is above the cap, input b = always 1; output NAND(a, 1) = not a.",
    schema: (cap) => ({
      format: "fengce-schema/1",
      netlistHash: ZERO,
      nIn: 2,
      fields: [
        { name: "overLimit", kind: "bool", offset: 0, width: 1 },
        { name: "one", kind: "flag", offset: 1, width: 1, value: 1 },
      ],
      bindings: [{ field: "overLimit", source: "AmountGt", param: cap.toString() }],
    }),
    vectors: [
      { input: "0x02", decision: "allow", reason: "amount is within the cap (a = 0)" },
      { input: "0x03", decision: "deny", reason: "amount is above the cap (a = 1)" },
    ],
  },
  {
    key: "comparator16",
    name: "Numeric Transaction Limit",
    processor: "0xF9bBdc7f678eb3A49D338ffAcDaaD9339de50a0F",
    id: 7n,
    description: "Allows a transaction only when a value is at or below a fixed limit.",
    construction: "A 16-bit comparator (114 NAND gates): output 1 when a >= b, with a = inputs 0 to 15 (the limit) and b = inputs 16 to 31 (the value).",
    schema: () => ({
      format: "fengce-schema/1",
      netlistHash: ZERO,
      nIn: 32,
      fields: [
        { name: "a", kind: "uint", offset: 0, width: 16 },
        { name: "b", kind: "uint", offset: 16, width: 16 },
      ],
      // The bindings of sdk/examples/comparator16-limit.schema.json, used for its Quote: a = native value, b = amount.
      bindings: [
        { field: "a", source: "Value" },
        { field: "b", source: "Amount" },
      ],
    }),
    vectors: [
      { input: "0xae019001", decision: "allow", reason: "value 400 is below the limit 430" },
      { input: "0x9001ae01", decision: "deny", reason: "value 430 is above the limit 400" },
      { input: "0x90019001", decision: "allow", reason: "value 400 equals the limit 400" },
    ],
  },
  {
    key: "policy-floor",
    name: "Organization-Wide Policy Floor",
    processor: "0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF",
    id: 5n,
    description: "A team policy that must also satisfy an organization's minimum rule; both must allow.",
    construction:
      "Team policy: XOR built by REF from circuits #1 (AND), #2 (OR) and #3 (NAND) on the same processor; input a = amount above the team cap, b = 1. Floor: circuit #3 (NAND), which is inside the team policy's REF closure; used with FengceFloors, the decision is floor AND policy.",
    schema: (cap) => ({
      format: "fengce-schema/1",
      netlistHash: ZERO,
      nIn: 2,
      fields: [
        { name: "overLimit", kind: "bool", offset: 0, width: 1 },
        { name: "one", kind: "flag", offset: 1, width: 1, value: 1 },
      ],
      bindings: [{ field: "overLimit", source: "AmountGt", param: cap.toString() }],
    }),
    vectors: [
      { input: "0x02", decision: "allow", reason: "amount is within the team cap (a = 0)" },
      { input: "0x03", decision: "deny", reason: "amount is above the team cap (a = 1)" },
    ],
  },
  {
    key: "toggle-cap",
    name: "Periodic Spending Budget",
    processor: "0xE2a6c6393b5A8B99cb481035eB8e244C66641cd7",
    id: 18n,
    stateful: true,
    description: "Allows one spend per period; the budget resets at the start of each period.",
    construction:
      "A stateful toggle with one LATCH (5 gates): new state = state XOR spend, output = new state. Tick keeps the state per policy group, resets it to zero each period, and stores it only when the step allows.",
    schema: () => ({
      format: "fengce-schema/1",
      netlistHash: ZERO,
      nIn: 1,
      fields: [{ name: "spend", kind: "flag", offset: 0, width: 1, value: 1 }],
    }),
    vectors: [
      { input: "0x01", state: "0x00", decision: "allow", reason: "first spend in the period (state 0)" },
      { input: "0x01", state: "0x01", decision: "deny", reason: "second spend in the same period (state 1)" },
    ],
  },
  {
    key: "nor-swap",
    name: "Protected Swap Policy",
    processor: "0x87BFCa3494Aa228fF589ab9B642143A5e8c8F9a6",
    id: 52n,
    description: "Allows a swap only when the amount is within the cap and the proceeds return to the account.",
    construction: "A NOR gate (4 NAND gates): input a = amount above the cap, input b = proceeds go elsewhere; output NOR(a, b).",
    schema: (cap) => ({
      format: "fengce-schema/1",
      netlistHash: ZERO,
      nIn: 2,
      fields: [
        { name: "overLimit", kind: "bool", offset: 0, width: 1 },
        { name: "foreignRecipient", kind: "bool", offset: 1, width: 1 },
      ],
      bindings: [
        { field: "overLimit", source: "AmountGt", param: cap.toString() },
        { field: "foreignRecipient", source: "RecipientIsForeign" },
      ],
    }),
    vectors: [
      { input: "0x00", decision: "allow", reason: "within the cap, proceeds return to the account" },
      { input: "0x01", decision: "deny", reason: "amount is above the cap" },
      { input: "0x02", decision: "deny", reason: "proceeds go to another address" },
      { input: "0x03", decision: "deny", reason: "above the cap and proceeds go elsewhere" },
    ],
  },
];

export function presetFor(processor: string, id: bigint): PolicyPreset | undefined {
  return PRESETS.find((p) => p.processor.toLowerCase() === processor.toLowerCase() && p.id === id);
}
