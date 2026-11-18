import type { Address, Hex } from "viem";
import type { SchemaFile } from "@fengce/sdk";

/** Known policies on X Layer: deployed circuits with a schema and plain-English description. */
export interface PolicyPreset {
  key: string;
  name: string;
  processor: Address;
  id: bigint;
  description: string;
  stateful?: boolean;
  /** schema with bindings for a cap; netlistHash is filled from the live netlist by the data layer */
  schema: (cap: bigint) => SchemaFile;
  vectors: { input: Hex; meaning: string }[];
}

const NAND_HASH: Hex = "0xc738359c3dde133a010e00bbc3dc1bd8685e3028a04e5df6e0f00cffa2ce2524";
const CMP_HASH: Hex = "0x3f79ea6c551d8b2206c10b8a38e6c27ad3f7da332028c32e3c1a25dfe6f31c9f";

export const PRESETS: PolicyPreset[] = [
  {
    key: "nand-limit",
    name: "Amount limit (NAND)",
    processor: "0x839bdD6fa7A66416A609A735e11DE5411B98574e",
    id: 2n,
    description:
      "Allows a transaction when its amount is at most the cap. Input a = amount is above the cap, input b = always 1; the circuit returns NAND(a, 1) = not a.",
    schema: (cap) => ({
      format: "fengce-schema/1",
      netlistHash: NAND_HASH,
      nIn: 2,
      fields: [
        { name: "overLimit", kind: "bool", offset: 0, width: 1 },
        { name: "one", kind: "flag", offset: 1, width: 1, value: 1 },
      ],
      bindings: [{ field: "overLimit", source: "AmountGt", param: cap.toString() }],
    }),
    vectors: [
      { input: "0x02", meaning: "amount within the cap" },
      { input: "0x03", meaning: "amount above the cap" },
    ],
  },
  {
    key: "nor-swap",
    name: "Swap guard (NOR)",
    processor: "0x87BFCa3494Aa228fF589ab9B642143A5e8c8F9a6",
    id: 52n,
    description:
      "Allows only when the amount is at most the cap and any swap or lending proceeds go back to the account. Input a = amount above the cap, input b = proceeds go elsewhere; the circuit returns NOR(a, b).",
    schema: (cap) => ({
      format: "fengce-schema/1",
      netlistHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
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
      { input: "0x00", meaning: "within cap, proceeds to the account" },
      { input: "0x01", meaning: "above the cap" },
      { input: "0x02", meaning: "proceeds go elsewhere" },
      { input: "0x03", meaning: "both" },
    ],
  },
  {
    key: "comparator16",
    name: "16-bit comparator (a >= b)",
    processor: "0xF9bBdc7f678eb3A49D338ffAcDaaD9339de50a0F",
    id: 7n,
    description: "Returns 1 when a >= b for two 16-bit numbers (a = inputs 0 to 15, b = inputs 16 to 31). Used as a threshold rule.",
    schema: () => ({
      format: "fengce-schema/1",
      netlistHash: CMP_HASH,
      nIn: 32,
      fields: [
        { name: "a", kind: "uint", offset: 0, width: 16 },
        { name: "b", kind: "uint", offset: 16, width: 16 },
      ],
    }),
    vectors: [
      { input: "0xae019001", meaning: "a = 430, b = 400" },
      { input: "0x9001ae01", meaning: "a = 400, b = 430" },
      { input: "0x90019001", meaning: "a = b = 400" },
    ],
  },
  {
    key: "toggle-cap",
    name: "One spend per period (stateful toggle)",
    processor: "0xE2a6c6393b5A8B99cb481035eB8e244C66641cd7",
    id: 18n,
    stateful: true,
    description:
      "Stateful (one LATCH): new state = state XOR spend, output = new state. Used with Tick: the first spend in a period is allowed, the next is denied until the period resets.",
    schema: () => ({
      format: "fengce-schema/1",
      netlistHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      nIn: 1,
      fields: [{ name: "spend", kind: "flag", offset: 0, width: 1, value: 1 }],
    }),
    vectors: [],
  },
];

export function presetFor(processor: string, id: bigint): PolicyPreset | undefined {
  return PRESETS.find((p) => p.processor.toLowerCase() === processor.toLowerCase() && p.id === id);
}
