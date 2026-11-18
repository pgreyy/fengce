import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SchemaError, encodeInputs, lenientFieldValue, parseSchema, schemaHash, toLayout } from "../src/schema.js";

const nand = parseSchema(readFileSync(new URL("../examples/nand-limit.schema.json", import.meta.url), "utf8"));
const base = { format: "fengce-schema/1", netlistHash: `0x${"11".repeat(32)}`, nIn: 4 } as const;

test("encodes LSB first, flags fixed by the schema", () => {
  assert.equal(encodeInputs(nand, { overLimit: false }), "0x02");
  assert.equal(encodeInputs(nand, { overLimit: true }), "0x03");
  const s = parseSchema({ ...base, nIn: 12, fields: [{ name: "x", kind: "uint", offset: 0, width: 12 }] });
  assert.equal(encodeInputs(s, { x: 0xabc }), "0xbc0a");
});

test("truncation bug: an oversized value is rejected, never truncated", () => {
  // A raw TapeOut processor reads only bit 0 of a 1-bit field: 2 would be read as 0 (allow).
  assert.equal(lenientFieldValue(2n, 1), 0n);
  assert.throws(() => encodeInputs(nand, { overLimit: 2 }), SchemaError);
  const s = parseSchema({ ...base, fields: [{ name: "x", kind: "uint", offset: 0, width: 4 }] });
  assert.equal(encodeInputs(s, { x: 15 }), "0x0f");
  assert.throws(() => encodeInputs(s, { x: 16 }), /does not fit in 4 bit/);
  assert.throws(() => encodeInputs(s, { x: -1 }), /negative/);
});

test("rejects missing, unknown and fixed field values", () => {
  assert.throws(() => encodeInputs(nand, {}), /missing value/);
  assert.throws(() => encodeInputs(nand, { overLimit: 0, other: 1 }), /unknown or fixed/);
  assert.throws(() => encodeInputs(nand, { overLimit: 0, one: 1 }), /unknown or fixed/);
});

test("layout validation matches Schema.validate", () => {
  const f = (fields: any[], nIn = 4) => () => parseSchema({ ...base, nIn, fields });
  assert.throws(f([{ name: "a", kind: "uint", offset: 0, width: 3 }]), /unmapped bits/);
  assert.throws(f([{ name: "a", kind: "uint", offset: 0, width: 4 }, { name: "b", kind: "bool", offset: 3, width: 1 }]), /outside nIn|overlaps/);
  assert.throws(f([{ name: "a", kind: "uint", offset: 0, width: 2 }, { name: "b", kind: "uint", offset: 1, width: 2 }]), /overlaps/);
  assert.throws(f([{ name: "a", kind: "bool", offset: 0, width: 2 }, { name: "b", kind: "uint", offset: 2, width: 2 }]), /width must be 1/);
  assert.throws(f([{ name: "a", kind: "flag", offset: 0, width: 1, value: 2 }, { name: "b", kind: "uint", offset: 1, width: 3 }]), /0 or 1/);
  assert.throws(f([{ name: "a", kind: "uint", offset: 0, width: 0 }]), /1\.\.256/);
  assert.throws(f([{ name: "a", kind: "uint", offset: 0, width: 4 }, { name: "a", kind: "uint", offset: 4, width: 1 }], 5), /duplicate/);
  assert.throws(() => parseSchema({ ...base, format: "other" }), /format/);
  assert.throws(() => parseSchema({ ...nand, bindings: [] }), /bindings must cover/);
  assert.throws(() => parseSchema({ ...nand, bindings: [{ field: "one", source: "Amount" }] }), /flag/);
});

test("schemaHash ignores names and bindings, depends on layout", () => {
  const renamed = { ...nand, fields: nand.fields.map((x) => ({ ...x, name: x.name + "_" })), bindings: undefined };
  assert.equal(schemaHash(renamed), schemaHash(nand));
  assert.equal(schemaHash(toLayout(nand)), schemaHash(nand));
  const moved = { ...nand, bindings: undefined, fields: [{ ...nand.fields[0], offset: 1 }, { ...nand.fields[1], offset: 0 }] };
  assert.notEqual(schemaHash(moved), schemaHash(nand));
});
