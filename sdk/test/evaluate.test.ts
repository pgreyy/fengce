import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNetlist } from "../src/evaluate.js";

test("parseNetlist decodes NAND, LATCH and REF records", () => {
  const cpu = "839bdd6fa7a66416a609a735e11de5411b98574e";
  const r = parseNetlist(`0x000000020000030100000402${cpu}000000000000000502010000020000030`.slice(0, -1) as `0x${string}`);
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { op: "nand", a: 2, b: 3 });
  assert.deepEqual(r[1], { op: "latch", d: 4 });
  assert.equal(r[2].op, "ref");
  if (r[2].op === "ref") {
    assert.equal(r[2].id, 5n);
    assert.deepEqual(r[2].ins, [2, 3]);
  }
  assert.throws(() => parseNetlist("0x0000000200"), /truncated/);
  assert.throws(() => parseNetlist("0x05"), /bad opcode/);
});
