import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeFunctionData, parseAbi, toFunctionSelector } from "viem";
import { FengceGuardArtifact } from "../src/artifacts.js";
import { InstallError, MULTI_SEND_CALL_ONLY, buildInstall, configInput } from "../src/install.js";
import { parseSchema, toLayout } from "../src/schema.js";

const schema = parseSchema(readFileSync(new URL("../examples/nand-limit.schema.json", import.meta.url), "utf8"));
const SAFE = "0x1111111111111111111111111111111111111111";
const GUARD = "0x2222222222222222222222222222222222222222";
const PIN = `0x${"ab".repeat(32)}` as const;
const opts = { safe: SAFE, guard: GUARD, pinId: PIN, schema, recoveryDelay: 1n, recoveryWindow: 2n, adminDelay: 3n } as const;
const client = (modules: string[]) => ({ readContract: async () => [modules, "0x0000000000000000000000000000000000000001"] }) as any;

test("configInput maps bindings to TxFacts sources in field order", () => {
  const c = configInput(opts);
  assert.deepEqual(c.bindings, [{ source: 5, param: 100n }]); // AmountGt
  assert.deepEqual(c.layout, toLayout(schema));
  assert.equal(c.recoveryWindow, 2n);
  assert.throws(() => configInput({ ...opts, recoveryWindow: 0n }), InstallError);
  assert.throws(() => configInput({ ...opts, schema: { ...schema, bindings: undefined } }), /no bindings/);
});

test("buildInstall refuses a Safe with modules enabled", async () => {
  await assert.rejects(buildInstall(client(["0x3333333333333333333333333333333333333333"]), opts), /modules enabled/);
});

test("buildInstall builds configure, setGuard, setModuleGuard in order, plus a MultiSend batch", async () => {
  const { calls, multiSend } = await buildInstall(client([]), opts);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].to, GUARD);
  const cfg = decodeFunctionData({ abi: FengceGuardArtifact.abi, data: calls[0].data });
  assert.equal(cfg.functionName, "configure");
  assert.equal(calls[1].to, SAFE);
  assert.equal(calls[1].data.slice(0, 10), toFunctionSelector("setGuard(address)"));
  assert.equal(calls[2].data.slice(0, 10), toFunctionSelector("setModuleGuard(address)"));
  assert.ok(calls[1].data.endsWith(GUARD.slice(2)) && calls[2].data.endsWith(GUARD.slice(2)));
  assert.equal(multiSend.to, MULTI_SEND_CALL_ONLY);
  assert.equal(multiSend.operation, 1);
  const ms = decodeFunctionData({ abi: parseAbi(["function multiSend(bytes)"]), data: multiSend.data });
  assert.ok((ms.args[0] as string).includes(calls[0].data.slice(2)));
});
