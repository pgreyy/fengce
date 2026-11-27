import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSchema, schemaHash } from "../src/schema.js";

// test/vectors/hashes.json is read by the Solidity tests; it must match what this SDK computes.
const vectors = JSON.parse(readFileSync(new URL("../../contracts/test/vectors/hashes.json", import.meta.url), "utf8"));

test("schema hash vectors match the example schema files", () => {
  for (const name of ["nand-limit", "comparator16"]) {
    const s = parseSchema(readFileSync(new URL(`../examples/${name}.schema.json`, import.meta.url), "utf8"));
    assert.equal(schemaHash(s), vectors.schemas[name], name);
  }
});
