/**
 * Writes ../test/vectors/hashes.json: hashes computed by this SDK that the Solidity tests check
 * PinRegistry and Schema against (schemaHash of the example schemas, refClosureHash of two live
 * X Layer circuits that use REF). Read-only.
 *   npx tsx scripts/gen-vectors.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, getAddress, http } from "viem";
import { parseSchema, refClosure, schemaHash } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const client = createPublicClient({ transport: http("https://rpc.xlayer.tech", { retryCount: 5 }) });
const block = await client.getBlockNumber();
const schemas: Record<string, string> = {};
for (const f of ["nand-limit", "comparator16"]) {
  schemas[f] = schemaHash(parseSchema(readFileSync(resolve(here, `../examples/${f}.schema.json`), "utf8")));
}
const circuits = [
  { name: "nested", processor: getAddress("0x99081e1D0CE916Cd5b2c53e769DFC3B000BFE9A4"), id: 18n },
  { name: "repeated", processor: getAddress("0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF"), id: 12n },
];
const closures: Record<string, unknown> = {};
for (const c of circuits) {
  const r = await refClosure(client as any, c.processor, c.id, block);
  closures[c.name] = { processor: c.processor, id: Number(c.id), refClosureHash: r.refClosureHash, processors: r.processors };
}
const out = resolve(here, "../../test/vectors/hashes.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedBy: "sdk/scripts/gen-vectors.ts", block: block.toString(), schemas, closures }, null, 2) + "\n");
console.log(readFileSync(out, "utf8"));
