/**
 * Read-only: finds TapeOut circuits on X Layer whose netlist contains REF records.
 *   npx tsx scripts/find-ref-circuits.ts [max]
 * Prints the first `max` (default 5) with their direct REF targets, smallest gate count first.
 */
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { parseRefs } from "../src/netlist.js";

const MAX = Number(process.argv[2] ?? 5);
const client = createPublicClient({ transport: http("https://rpc.xlayer.tech", { retryCount: 5 }) });
const F = "0x1f09DAeFA827f02CBb40967cc91b259763760761" as const;
const MC = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const fAbi = parseAbi(["function cpuCount() view returns (uint256)", "function cpuAt(uint256) view returns (address)"]);
const cAbi = parseAbi(["function nextId() view returns (uint256)", "function circuitInfo(uint256) view returns (uint32,uint32,uint32,uint32)", "function netlist(uint256) view returns (bytes)"]);

async function mc(calls: any[], chunk = 150): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < calls.length; i += chunk) {
    const r = await client.multicall({ contracts: calls.slice(i, i + chunk), multicallAddress: MC, allowFailure: true });
    out.push(...r.map((x) => (x.status === "success" ? x.result : null)));
  }
  return out;
}

const n = Number(await client.readContract({ address: F, abi: fAbi, functionName: "cpuCount" }));
const cpus: Address[] = await mc([...Array(n).keys()].map((i) => ({ address: F, abi: fAbi, functionName: "cpuAt", args: [BigInt(i)] })));
const next: bigint[] = await mc(cpus.map((a) => ({ address: a, abi: cAbi, functionName: "nextId" })));
const ids = cpus.flatMap((cpu, i) => [...Array(Math.max(0, Number((next[i] ?? 1n) - 1n))).keys()].map((k) => ({ cpu, id: BigInt(k + 1) })));
const infos = await mc(ids.map((c) => ({ address: c.cpu, abi: cAbi, functionName: "circuitInfo", args: [c.id] })));
// A REF makes gateCount exceed the circuit's own records; netlist length bounds own records.
const cand = ids.map((c, i) => ({ ...c, info: infos[i] })).filter((c) => c.info && c.info[2] === 0 && c.info[3] <= 3000).sort((a, b) => a.info[3] - b.info[3]);
const found: any[] = [];
for (let i = 0; i < cand.length && found.length < MAX; i += 60) {
  const batch = cand.slice(i, i + 60);
  const nls = await mc(batch.map((c) => ({ address: c.cpu, abi: cAbi, functionName: "netlist", args: [c.id] })), 60);
  batch.forEach((c, j) => {
    if (!nls[j] || found.length >= MAX) return;
    const r = parseRefs(nls[j]);
    if (r.refs.length) found.push({ processor: c.cpu, id: c.id.toString(), nIn: c.info[0], nOut: c.info[1], gates: c.info[3], refs: r.refs.map((x) => ({ cpu: x.cpu, id: x.id.toString() })) });
  });
}
console.log(JSON.stringify({ block: (await client.getBlockNumber()).toString(), circuits: ids.length, statelessUpTo3000Gates: cand.length, found }, null, 1));
