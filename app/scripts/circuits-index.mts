// Every TapeOut circuit on X Layer, for Limits → Add a circuit (search and Import by ID beyond the Fengce Catalog).
// Reads the TapeOut factory (cpuCount, cpuAt: processor number = index) and each processor (nextId, circuitInfo), marks
// DeWeb apps (a circuit whose DeWeb container is opened in the site registry) and, for small stateless circuits
// (up to 3 inputs), runs every input with eval to record the truth table of output bit 0.
// Incremental: only circuits newer than the last index are read; --full re-reads everything (app flags included).
//   cd app && npx tsx scripts/circuits-index.mts [--full]
// Writes app/public/circuits-index.json. Read-only: sends no transaction.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, parseAbi, toHex, type Address, type Hex } from "viem";

const FILE = resolve(import.meta.dirname, "../public/circuits-index.json");
const RPC = process.env.XLAYER_RPC_URL || "https://rpc.xlayer.tech";
const FACTORY = "0x1f09DAeFA827f02CBb40967cc91b259763760761" as const;
const OPENER = "0x536adD8F30f03b69f6fbF29d425A816A0dC50106" as const;
const SITES = "0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6" as const;
const MC = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

const client = createPublicClient({ transport: http(RPC, { retryCount: 6, retryDelay: 1500, timeout: 60_000 }) });
const fAbi = parseAbi(["function cpuCount() view returns (uint256)", "function cpuAt(uint256) view returns (address)"]);
const cAbi = parseAbi(["function nextId() view returns (uint256)", "function circuitInfo(uint256) view returns (uint32,uint32,uint32,uint32)", "function eval(uint256,bytes) view returns (bytes)"]);
const oAbi = parseAbi(["function accountOf(address circuits, uint256 tokenId) view returns (address)"]);
const sAbi = parseAbi(["function isOpenedContainer(address container) view returns (bool)"]);

/** [processor number, circuit id, nIn, nOut, nState, gates, app (1/0), truth table of output bit 0 ("" when not run)] */
type Row = [number, number, number, number, number, number, 0 | 1, string];
interface Index {
  format: "fengce-circuits/1";
  chainId: 196;
  block: string;
  generatedAt: string;
  factory: Address;
  processors: Address[];
  next: number[]; // nextId per processor at `block`
  circuits: Row[];
}

async function mc<T>(calls: any[], chunk = 200): Promise<(T | null)[]> {
  const out: (T | null)[] = [];
  for (let i = 0; i < calls.length; i += chunk) {
    const r = await client.multicall({ contracts: calls.slice(i, i + chunk), multicallAddress: MC, allowFailure: true });
    out.push(...r.map((x) => (x.status === "success" ? (x.result as T) : null)));
  }
  return out;
}

const full = process.argv.includes("--full");
const prev: Index | null = !full && existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : null;
const block = await client.getBlockNumber();
const n = Number(await client.readContract({ address: FACTORY, abi: fAbi, functionName: "cpuCount", blockNumber: block }));
const known = prev?.processors.length ?? 0;
const newCpus = (await mc<Address>([...Array(n - known).keys()].map((i) => ({ address: FACTORY, abi: fAbi, functionName: "cpuAt", args: [BigInt(known + i)] })))) as Address[];
const processors = [...(prev?.processors ?? []), ...newCpus];
const next = ((await mc<bigint>(processors.map((a) => ({ address: a, abi: cAbi, functionName: "nextId" })))) as (bigint | null)[]).map((x) => Number(x ?? 1n));

// circuits to read: ids from the previous nextId (or 1) up to the current one
const todo: { p: number; id: number }[] = [];
processors.forEach((_, p) => {
  for (let id = prev?.next[p] ?? 1; id < next[p]; id++) todo.push({ p, id });
});
const infos = await mc<readonly [number, number, number, number]>(todo.map((c) => ({ address: processors[c.p], abi: cAbi, functionName: "circuitInfo", args: [BigInt(c.id)] })));
const accounts = await mc<Address>(todo.map((c) => ({ address: OPENER, abi: oAbi, functionName: "accountOf", args: [processors[c.p], BigInt(c.id)] })));
const opened = await mc<boolean>(accounts.map((a) => ({ address: SITES, abi: sAbi, functionName: "isOpenedContainer", args: [a ?? "0x0000000000000000000000000000000000000000"] })));
const rows: Row[] = todo.map((c, i) => {
  const f = infos[i];
  return [c.p, c.id, f ? Number(f[0]) : -1, f ? Number(f[1]) : -1, f ? Number(f[2]) : -1, f ? Number(f[3]) : -1, opened[i] ? 1 : 0, ""];
});

// truth tables (output bit 0) of stateless circuits with 1 to 3 inputs
const small = rows.filter((r) => r[2] >= 1 && r[2] <= 3 && r[3] >= 1 && r[4] === 0 && !r[6]);
const evalCalls = small.flatMap((r) => [...Array(1 << r[2]).keys()].map((x) => ({ address: processors[r[0]], abi: cAbi, functionName: "eval", args: [BigInt(r[1]), toHex(x, { size: 1 })] })));
const outs = await mc<Hex>(evalCalls);
let k = 0;
for (const r of small) {
  const t = outs.slice(k, k + (1 << r[2]));
  k += 1 << r[2];
  if (t.every(Boolean)) r[7] = t.map((o) => String(parseInt((o as string).slice(2, 4) || "0", 16) & 1)).join("");
}

const index: Index = {
  format: "fengce-circuits/1",
  chainId: 196,
  block: block.toString(),
  generatedAt: new Date().toISOString(),
  factory: FACTORY,
  processors,
  next,
  circuits: [...(prev?.circuits ?? []), ...rows],
};
writeFileSync(FILE, JSON.stringify(index) + "\n");
const apps = index.circuits.filter((r) => r[6]).length;
console.log(`circuits-index: block ${block}, ${processors.length} processors, ${index.circuits.length} circuits (${rows.length} new, ${apps} DeWeb apps, ${small.length} truth tables run)`);
