/**
 * Offline: load a schema, compute its schemaHash and encode circuit inputs.
 *   npx tsx examples/encode.ts
 */
import { readFileSync } from "node:fs";
import { encodeInputs, lenientFieldValue, parseSchema, schemaHash } from "../src/index.js";

const nand = parseSchema(readFileSync(new URL("./nand-limit.schema.json", import.meta.url), "utf8"));
console.log("schemaHash (pin this):", schemaHash(nand));
console.log("overLimit = false ->", encodeInputs(nand, { overLimit: false })); // 0x02: NAND(0,1) = 1, allow
console.log("overLimit = true  ->", encodeInputs(nand, { overLimit: true })); // 0x03: NAND(1,1) = 0, deny

const cmp = parseSchema(readFileSync(new URL("./comparator16.schema.json", import.meta.url), "utf8"));
console.log("a=430, b=400 ->", encodeInputs(cmp, { a: 430, b: 400 }));

// The truncation trap: a TapeOut processor reads only the low bits of a field.
// 70,000 does not fit in 16 bits; the processor would read 70,000 mod 65,536 = 4,464.
console.log("processor would read:", lenientFieldValue(70_000n, 16));
try {
  encodeInputs(cmp, { a: 70_000, b: 400 });
} catch (e) {
  console.log("encodeInputs refuses:", (e as Error).message);
}
