/**
 * Read-only: finds stateless 2-input, 1-output TapeOut circuits on X Layer by truth table.
 *   npx tsx scripts/find-gate-circuits.ts [--rpc URL]
 * Prints the smallest circuit for each 2-input boolean function (truth table over inputs 0,1,2,3; input bit 0 = a, bit 1 = b).
 */
import { createPublicClient, http, parseAbi, type Address } from "viem";

const rpc = process.argv.includes("--rpc") ? process.argv[process.argv.indexOf("--rpc") + 1] : "https://rpc.xlayer.tech";
const client = createPublicClient({ transport: http(rpc, { retryCount: 5, retryDelay: 1000 }) });
const block = await client.getBlockNumber();
const F = "0x1f09DAeFA827f02CBb40967cc91b259763760761" as const;
const MC = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const fAbi = parseAbi(["function cpuCount() view returns (uint256)", "function cpuAt(uint256) view returns (address)"]);
const cAbi = parseAbi([
  "function nextId() view returns (uint256)",
  "function circuitInfo(uint256) view returns (uint32,uint32,uint32,uint32)",
  "function eval(uint256,bytes) view returns (bytes)",
]);
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
const cand = ids.map((c, i) => ({ ...c, info: infos[i] })).filter((c) => c.info && c.info[0] === 2 && c.info[1] === 1 && c.info[2] === 0);
const outs = await mc(cand.flatMap((c) => ["0x00", "0x01", "0x02", "0x03"].map((x) => ({ address: c.cpu, abi: cAbi, functionName: "eval", args: [c.id, x] }))));
const best: Record<string, any> = {};
cand.forEach((c, i) => {
  const t = outs.slice(4 * i, 4 * i + 4);
  if (t.some((o) => !o)) return;
  const table = t.map((o: string) => (parseInt(o.slice(2, 4), 16) & 1).toString()).join("");
  if (!best[table] || best[table].gates > c.info[3]) best[table] = { processor: c.cpu, id: c.id.toString(), gates: c.info[3] };
});
console.log(JSON.stringify({ block: block.toString(), candidates: cand.length, byTruthTable: best }, null, 1));
