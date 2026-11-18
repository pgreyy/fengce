// Writes public/events-snapshot.json: every Fengce v2 event (FengceGuard, AgentExecutor, Catalog) from the v2 deploy
// block to a recent block. Incremental: an existing snapshot is extended from its last block. Read-only RPC calls.
// Usage: npm run snapshot
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADDR, AGENT_EXECUTOR, CATALOG, DEPLOY_BLOCK, client } from "../src/lib/chain";
import { scanEvents, type Snapshot } from "../src/lib/events";

const FILE = resolve(import.meta.dirname, "../public/events-snapshot.json");
/** Stay this many blocks behind the head, so the snapshot never holds a block that could still change. */
const CONFIRMATIONS = 20n;

const contracts = { guard: ADDR.guard, agentExecutor: AGENT_EXECUTOR, catalog: CATALOG };
let prev: Snapshot | null = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : null;
if (prev && JSON.stringify(prev.contracts).toLowerCase() !== JSON.stringify(contracts).toLowerCase()) {
  console.log("Contracts changed: rebuilding the snapshot from the deploy block.");
  prev = null;
}
const from = prev ? BigInt(prev.toBlock) + 1n : DEPLOY_BLOCK;
const to = (await client.getBlockNumber()) - CONFIRMATIONS;
if (to < from) {
  console.log(`Snapshot already at block ${prev?.toBlock}; nothing to add.`);
  process.exit(0);
}
let last = 0;
const { events, coverage } = await scanEvents(from, to, (done, total) => {
  const pct = Math.floor((done / total) * 10);
  if (pct !== last) {
    last = pct;
    process.stdout.write(`${done}/${total} windows\r`);
  }
});
if (coverage.failed) {
  console.error(`\n${coverage.failed} of ${coverage.windows} windows were not answered by the RPC; snapshot not written. Run again.`);
  process.exit(1);
}
const out: Snapshot = {
  format: "fengce-events/1",
  chainId: 196,
  release: "v2",
  contracts,
  fromBlock: (prev?.fromBlock ?? DEPLOY_BLOCK.toString()).toString(),
  toBlock: to.toString(),
  generatedAt: new Date().toISOString(),
  events: [...(prev?.events ?? []), ...events],
};
writeFileSync(FILE, JSON.stringify(out, null, 1) + "\n");
const count = (name: string) => out.events.filter((e) => e.event === name).length;
console.log(
  `\nSnapshot blocks ${out.fromBlock}-${out.toBlock}: ${out.events.length} events (+${events.length} new from ${coverage.windows} windows); ` +
    `Configured ${count("Configured")}, Denied ${count("Denied")}, AgentExecuted ${count("AgentExecuted")}, Listed ${count("Listed")}.`,
);
