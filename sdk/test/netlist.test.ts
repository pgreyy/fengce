import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRefs } from "../src/netlist.js";

const NAND3 = "0x000000020000030000000400000400000005000005"; // circuit #2 on 0x839bdD…574e, read on X Layer

test("parses the on-chain one-NAND netlist: 3 NAND records, no REF", () => {
  const r = parseRefs(NAND3);
  assert.equal(r.nand, 3);
  assert.equal(r.latch, 0);
  assert.equal(r.refs.length, 0);
});

test("parses LATCH and REF records (cpu, u64 id, nIns, nOuts, ins)", () => {
  const cpu = "839bdd6fa7a66416a609a735e11de5411b98574e";
  const ref = "02" + cpu + "0000000000000002" + "02" + "01" + "000002" + "000003";
  const latch = "01" + "000004";
  const r = parseRefs(`0x${latch}${ref}`);
  assert.equal(r.latch, 1);
  assert.equal(r.refs.length, 1);
  assert.equal(r.refs[0].cpu, "0x839bdD6fa7A66416A609A735e11DE5411B98574e");
  assert.equal(r.refs[0].id, 2n);
  assert.equal(r.refs[0].nIns, 2);
  assert.equal(r.refs[0].nOuts, 1);
});

test("rejects truncated records and unknown opcodes", () => {
  assert.equal(parseRefs("0x00000002000003").nand, 1); // a complete NAND record parses
  assert.throws(() => parseRefs("0x000000020000"), /truncated/);
  assert.throws(() => parseRefs("0x0100"), /truncated/);
  assert.throws(() => parseRefs("0x02" + "00".repeat(29)), /truncated/);
  const refMissingIns = "0x02" + "11".repeat(20) + "0000000000000001" + "02" + "01" + "000002";
  assert.throws(() => parseRefs(refMissingIns), /truncated/);
  assert.throws(() => parseRefs("0x03000000"), /bad opcode/);
});

test("empty netlist has no records", () => {
  assert.deepEqual(parseRefs("0x"), { refs: [], nand: 0, latch: 0 });
});
