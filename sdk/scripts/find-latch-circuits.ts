/**
 * Read-only: finds stateful TapeOut circuits on X Layer that work as a "once per period" cap:
 * from the zero state, input x allows (output bit 0 = 1); from the state that step leaves, the same
 * input x denies (bit 0 = 0). Tries x = each single input bit and x = all ones.
 *   npx tsx scripts/find-latch-circuits.ts [max] [--rpc URL]
 */
import { createPublicClient, http, parseAbi, toHex, type Address, type Hex } from "viem";

const MAX = Number(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : 5);
const rpc = process.argv.includes("--rpc") ? process.argv[process.argv.indexOf("--rpc") + 1] : "https://rpc.xlayer.tech";
const client = createPublicClient({ transport: http(rpc, { retryCount: 5, retryDelay: 1000 }) });
const startBlock = await client.getBlockNumber();
const F = "0x1f09DAeFA827f02CBb40967cc91b259763760761" as const;
const MC = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const fAbi = parseAbi(["function cpuCount() view returns (uint256)", "function cpuAt(uint256) view returns (address)"]);
const cAbi = parseAbi([
  "function nextId() view returns (uint256)",
  "function circuitInfo(uint256) view returns (uint32,uint32,uint32,uint32)",
  "function step(uint256,bytes,bytes) view returns (bytes,bytes)",
]);
async function mc(calls: any[], chunk = 150): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < calls.length; i += chunk) {
    const r = await client.multicall({ contracts: calls.slice(i, i + chunk), multicallAddress: MC, allowFailure: true });
    out.push(...r.map((x) => (x.status === "success" ? x.result : null)));
  }
  return out;
}
const pack = (bits: number, n: number): Hex => {
  const b = new Uint8Array(Math.ceil(n / 8));
  for (let i = 0; i < n; i++) if ((bits >> i) & 1) b[i >> 3] |= 1 << (i & 7);
  return toHex(b);
};
const n = Number(await client.readContract({ address: F, abi: fAbi, functionName: "cpuCount" }));
const cpus: Address[] = await mc([...Array(n).keys()].map((i) => ({ address: F, abi: fAbi, functionName: "cpuAt", args: [BigInt(i)] })));
const next: bigint[] = await mc(cpus.map((a) => ({ address: a, abi: cAbi, functionName: "nextId" })));
const ids = cpus.flatMap((cpu, i) => [...Array(Math.max(0, Number((next[i] ?? 1n) - 1n))).keys()].map((k) => ({ cpu, id: BigInt(k + 1) })));
const infos = await mc(ids.map((c) => ({ address: c.cpu, abi: cAbi, functionName: "circuitInfo", args: [c.id] })));
const cand = ids
  .map((c, i) => ({ ...c, info: infos[i] }))
  .filter((c) => c.info && c.info[2] >= 1 && c.info[2] <= 16 && c.info[0] >= 1 && c.info[0] <= 8 && c.info[3] <= 500)
  .sort((a, b) => a.info[3] - b.info[3]);
const tests = cand.flatMap((c) => {
  const nIn = c.info[0];
  const xs = [...[...Array(nIn).keys()].map((b) => 1 << b), (1 << nIn) - 1];
  return [...new Set(xs)].map((x) => ({ c, x }));
});
const zero = (c: any) => toHex(new Uint8Array(Math.ceil(c.info[2] / 8)));
const r1 = await mc(tests.map((t) => ({ address: t.c.cpu, abi: cAbi, functionName: "step", args: [t.c.id, zero(t.c), pack(t.x, t.c.info[0])] })));
const firstAllow = tests.map((t, i) => ({ ...t, r: r1[i] })).filter((t) => t.r && (parseInt(t.r[1].slice(2, 4) || "0", 16) & 1) === 1 && t.r[0] !== zero(t.c));
const r2 = await mc(firstAllow.map((t) => ({ address: t.c.cpu, abi: cAbi, functionName: "step", args: [t.c.id, t.r[0], pack(t.x, t.c.info[0])] })));
const found = firstAllow
  .map((t, i) => ({ ...t, r2: r2[i] }))
  .filter((t) => t.r2 && (parseInt(t.r2[1].slice(2, 4) || "0", 16) & 1) === 0)
  .slice(0, MAX)
  .map((t) => ({ processor: t.c.cpu, id: t.c.id.toString(), nIn: t.c.info[0], nOut: t.c.info[1], nState: t.c.info[2], gates: t.c.info[3], input: pack(t.x, t.c.info[0]), stateAfterFirst: t.r[0], outFirst: t.r[1], outSecond: t.r2[1] }));
console.log(JSON.stringify({ block: startBlock.toString(), stateful: cand.length, tried: tests.length, found }, null, 1));
