import { type Hex, encodeAbiParameters, isHex, keccak256, toHex } from "viem";

/**
 * Schema file format "fengce-schema/1": the typed input layout of one circuit.
 *
 * {
 *   "format": "fengce-schema/1",
 *   "netlistHash": "0x…",            // keccak256 of the circuit netlist the layout is bound to
 *   "nIn": 2,                        // circuit input count
 *   "fields": [
 *     { "name": "overLimit", "kind": "bool", "offset": 0, "width": 1 },
 *     { "name": "one", "kind": "flag", "offset": 1, "width": 1, "value": 1 }
 *   ],
 *   "bindings": [ { "field": "overLimit", "source": "AmountGt", "param": "100" } ]   // optional, FengceGuard only
 * }
 *
 * Kinds: "uint" (1..256 bits, value < 2^width), "bool" (1 bit, 0 or 1), "flag" (1 bit fixed by the
 * schema in "value"; takes no caller value). Bits are packed least significant first (TAP-02).
 * Every input bit must belong to exactly one field.
 *
 * schemaHash = keccak256(abi.encode(netlistHash, nIn, fields)) with fields as
 * (uint8 kind, uint32 offset, uint32 width, uint256 fixedValue)[], kind uint=0 bool=1 flag=2.
 * This equals Schema.hash in src/core/Schema.sol and is what PinRegistry stores as schemaHash.
 * Field names and bindings are not part of the hash.
 */
export type FieldKind = "uint" | "bool" | "flag";

export interface SchemaField {
  name: string;
  kind: FieldKind;
  offset: number;
  width: number;
  value?: number | string; // flag only: 0 or 1
}

/** FengceGuard fact sources (TxFacts.Source in src/core/TxFacts.sol), in enum order. */
export const BINDING_SOURCES = [
  "To",
  "Value",
  "Token",
  "Amount",
  "Kind",
  "AmountGt",
  "ToIs",
  "TokenIs",
  "Selector",
  // policy context version 1 (docs/POLICY-INTERFACE.md)
  "Actor",
  "ActorIs",
  "TokenOut",
  "MinAmountOut",
  "Recipient",
  "RecipientIsForeign",
  "Deadline",
  "Action",
  // policy context version 2: outcome facts (FengceInspector)
  "Outflow",
  "OutflowGt",
  "AllowanceIncrease",
  "AllowanceIncreaseGt",
] as const;
export type BindingSource = (typeof BINDING_SOURCES)[number];

export interface SchemaBinding {
  field: string;
  source: BindingSource;
  param?: string | number;
}

export interface SchemaFile {
  format: "fengce-schema/1";
  netlistHash: Hex;
  nIn: number;
  fields: SchemaField[];
  bindings?: SchemaBinding[];
}

/** The on-chain Schema.Layout struct, ready for viem calls. */
export interface Layout {
  netlistHash: Hex;
  nIn: number;
  fields: { kind: number; offset: number; width: number; fixedValue: bigint }[];
}

export class SchemaError extends Error {}

const KIND_ID: Record<FieldKind, number> = { uint: 0, bool: 1, flag: 2 };
const MAX_IN = 65_536;

/** Parses and validates a schema (same rules as Schema.validate on-chain). Throws SchemaError. */
export function parseSchema(input: unknown): SchemaFile {
  const s = (typeof input === "string" ? JSON.parse(input) : input) as SchemaFile;
  if (!s || s.format !== "fengce-schema/1") throw new SchemaError('format must be "fengce-schema/1"');
  if (!isHex(s.netlistHash) || s.netlistHash.length !== 66) throw new SchemaError("netlistHash must be a 32-byte hex string");
  if (!Number.isInteger(s.nIn) || s.nIn < 0 || s.nIn > MAX_IN) throw new SchemaError(`nIn must be an integer in 0..${MAX_IN}`);
  if (!Array.isArray(s.fields)) throw new SchemaError("fields must be an array");
  const names = new Set<string>();
  const taken = new Uint8Array(s.nIn);
  let sum = 0;
  s.fields.forEach((f, k) => {
    if (typeof f.name !== "string" || !f.name) throw new SchemaError(`field ${k}: name required`);
    if (names.has(f.name)) throw new SchemaError(`field ${k}: duplicate name "${f.name}"`);
    names.add(f.name);
    if (!(f.kind in KIND_ID)) throw new SchemaError(`field ${f.name}: unknown kind "${f.kind}"`);
    if (!Number.isInteger(f.offset) || f.offset < 0) throw new SchemaError(`field ${f.name}: bad offset`);
    if (f.kind === "uint") {
      if (!Number.isInteger(f.width) || f.width < 1 || f.width > 256) throw new SchemaError(`field ${f.name}: uint width must be 1..256`);
      if (f.value !== undefined) throw new SchemaError(`field ${f.name}: only flags have a value`);
    } else {
      if (f.width !== 1) throw new SchemaError(`field ${f.name}: ${f.kind} width must be 1`);
      if (f.kind === "bool" && f.value !== undefined) throw new SchemaError(`field ${f.name}: only flags have a value`);
      if (f.kind === "flag" && !(BigInt(f.value ?? -1) === 0n || BigInt(f.value ?? -1) === 1n)) {
        throw new SchemaError(`field ${f.name}: flag value must be 0 or 1`);
      }
    }
    if (f.offset + f.width > s.nIn) throw new SchemaError(`field ${f.name}: bits ${f.offset}..${f.offset + f.width - 1} are outside nIn ${s.nIn}`);
    for (let b = f.offset; b < f.offset + f.width; b++) {
      if (taken[b]) throw new SchemaError(`field ${f.name}: bit ${b} overlaps another field`);
      taken[b] = 1;
    }
    sum += f.width;
  });
  if (sum < s.nIn) throw new SchemaError(`unmapped bits: fields cover ${sum} of ${s.nIn} inputs`);
  if (sum > s.nIn) throw new SchemaError(`width mismatch: fields cover ${sum} bits, nIn is ${s.nIn}`);
  for (const b of s.bindings ?? []) {
    const f = s.fields.find((x) => x.name === b.field);
    if (!f) throw new SchemaError(`binding: unknown field "${b.field}"`);
    if (f.kind === "flag") throw new SchemaError(`binding: flag "${b.field}" takes no binding`);
    if (!BINDING_SOURCES.includes(b.source)) throw new SchemaError(`binding ${b.field}: unknown source "${b.source}"`);
  }
  if (s.bindings) {
    const bound = new Set(s.bindings.map((b) => b.field));
    const need = s.fields.filter((f) => f.kind !== "flag");
    if (bound.size !== s.bindings.length || need.some((f) => !bound.has(f.name)) || bound.size !== need.length) {
      throw new SchemaError("bindings must cover every non-flag field exactly once");
    }
  }
  return s;
}

/** The on-chain Schema.Layout for this schema. */
export function toLayout(schema: SchemaFile): Layout {
  return {
    netlistHash: schema.netlistHash,
    nIn: schema.nIn,
    fields: schema.fields.map((f) => ({
      kind: KIND_ID[f.kind],
      offset: f.offset,
      width: f.width,
      fixedValue: f.kind === "flag" ? BigInt(f.value!) : 0n,
    })),
  };
}

const FIELDS_TYPE = {
  type: "tuple[]",
  components: [
    { name: "kind", type: "uint8" },
    { name: "offset", type: "uint32" },
    { name: "width", type: "uint32" },
    { name: "fixedValue", type: "uint256" },
  ],
} as const;

/** keccak256(abi.encode(netlistHash, nIn, fields)), equal to Schema.hash on-chain. */
export function schemaHash(schema: SchemaFile | Layout): Hex {
  const l = "format" in schema ? toLayout(parseSchema(schema)) : schema;
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint32" }, FIELDS_TYPE], [l.netlistHash, l.nIn, l.fields]));
}

/**
 * Strict encoder: one value per non-flag field (by name), packed LSB first into exactly ceil(nIn/8)
 * bytes. Throws on a missing or unknown name, a value wider than its field, or a bool that is not 0/1.
 * It never truncates.
 */
export function encodeInputs(schema: SchemaFile, values: Record<string, bigint | number | boolean | string>): Hex {
  const s = parseSchema(schema);
  const bytes = new Uint8Array(Math.ceil(s.nIn / 8));
  const known = new Set(s.fields.filter((f) => f.kind !== "flag").map((f) => f.name));
  for (const k of Object.keys(values)) if (!known.has(k)) throw new SchemaError(`unknown or fixed field "${k}"`);
  for (const f of s.fields) {
    let v: bigint;
    if (f.kind === "flag") v = BigInt(f.value!);
    else {
      if (!(f.name in values)) throw new SchemaError(`missing value for "${f.name}"`);
      const raw = values[f.name];
      v = typeof raw === "boolean" ? (raw ? 1n : 0n) : BigInt(raw);
      if (v < 0n) throw new SchemaError(`"${f.name}": negative value`);
      if (v >> BigInt(f.width) !== 0n) throw new SchemaError(`"${f.name}": value ${v} does not fit in ${f.width} bit(s)`);
    }
    for (let b = 0; b < f.width; b++) {
      if ((v >> BigInt(b)) & 1n) {
        const bit = f.offset + b;
        bytes[bit >> 3] |= 1 << (bit & 7);
      }
    }
  }
  return toHex(bytes);
}

/**
 * What a TapeOut processor actually reads from a value written into a field: only the low `width`
 * bits (TAP-02 reads input leniently). Exposed to show the truncation that encodeInputs refuses.
 */
export function lenientFieldValue(value: bigint, width: number): bigint {
  return value & ((1n << BigInt(width)) - 1n);
}
