import { test } from "node:test";
import assert from "node:assert/strict";
import { TIERS, tierFor } from "../src/tiers.js";

test("tier boundaries are inclusive at the top of each tier", () => {
  assert.equal(tierFor(0n), "Green");
  assert.equal(tierFor(TIERS.greenMaxGas), "Green");
  assert.equal(tierFor(TIERS.greenMaxGas + 1n), "Amber");
  assert.equal(tierFor(TIERS.amberMaxGas), "Amber");
  assert.equal(tierFor(TIERS.amberMaxGas + 1n), "Red");
});

test("thresholds are 1M and 3.5M gas", () => {
  assert.equal(TIERS.greenMaxGas, 1_000_000n);
  assert.equal(TIERS.amberMaxGas, 3_500_000n);
});
