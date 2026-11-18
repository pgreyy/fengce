import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex } from "viem";
import { canonicalJson, certificateHash } from "../src/quote.js";

test("canonicalJson sorts keys at every level and keeps array order", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [2, 1], c: "x" } }), '{"a":{"c":"x","d":[2,1]},"b":1}');
  assert.equal(canonicalJson([{ z: null, y: true }]), '[{"y":true,"z":null}]');
  assert.equal(canonicalJson("é\n"), JSON.stringify("é\n"));
});

test("canonicalJson ignores key insertion order", () => {
  assert.equal(canonicalJson({ a: 1, b: { c: 2, d: 3 } }), canonicalJson({ b: { d: 3, c: 2 }, a: 1 }));
});

test("certificateHash is keccak256 of the canonical JSON and is stable", () => {
  const c1 = certificateHash({ b: 1, a: 2 } as any);
  const c2 = certificateHash({ a: 2, b: 1 } as any);
  assert.equal(c1, c2);
  assert.equal(c1, keccak256(toHex('{"a":2,"b":1}')));
});
