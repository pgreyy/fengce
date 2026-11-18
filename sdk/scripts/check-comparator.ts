/**
 * Read-only check of a two-operand comparator circuit: a = inputs 0..w-1, b = inputs w..2w-1 (LSB first).
 *   npx tsx scripts/check-comparator.ts <processor> <id> <ge|gt|le|lt|eq> [samples]
 */
import { createPublicClient, http, parseAbi, toHex, keccak256, type Address } from "viem";
import { parseRefs } from "../src/netlist.js";

const [cpu, idS, op, nS] = process.argv.slice(2);
const id = BigInt(idS);
const samples = Number(nS ?? 3000);
const client = createPublicClient({ transport: http("https://rpc.xlayer.tech", { retryCount: 5 }) });
const abi = parseAbi([
  "function circuitInfo(uint256) view returns (uint32,uint32,uint32,uint32)",
  "function netlist(uint256) view returns (bytes)",
  "function eval(uint256,bytes) view returns (bytes)",
]);
const pred: Record<string, (a: bigint, b: bigint) => boolean> = {
  ge: (a, b) => a >= b, gt: (a, b) => a > b, le: (a, b) => a <= b, lt: (a, b) => a < b, eq: (a, b) => a === b,
};
const rnd = (w: number) => { let x = 0n; for (let i = 0; i < w; i++) if (Math.random() < 0.5) x |= 1n << BigInt(i); return x; };

async function main() {
  const [nIn, nOut, nState, gates] = await client.readContract({ address: cpu as Address, abi, functionName: "circuitInfo", args: [id] });
  const nl = await client.readContract({ address: cpu as Address, abi, functionName: "netlist", args: [id] });
  const { refs, nand, latch } = parseRefs(nl);
  const w = nIn / 2;
  const max = (1n << BigInt(w)) - 1n;
  const pairs: [bigint, bigint][] = [];
  for (const a of [0n, 1n, max - 1n, max]) for (const b of [0n, 1n, max - 1n, max]) pairs.push([a, b]);
  for (let i = 0; i < samples; i++) { const a = rnd(w); const r = Math.random(); pairs.push([a, r < 0.2 ? a : r < 0.4 ? (a + 1n) & max : r < 0.6 ? (a - 1n) & max : rnd(w)]); }
  let bad = 0;
  for (let i = 0; i < pairs.length; i += 150) {
    const chunk = pairs.slice(i, i + 150);
    const r = await client.multicall({
      contracts: chunk.map(([a, b]) => {
        const x = a | (b << BigInt(w));
        const bytes = new Uint8Array(Math.ceil(nIn / 8));
        for (let k = 0; k < nIn; k++) if ((x >> BigInt(k)) & 1n) bytes[k >> 3] |= 1 << (k & 7);
        return { address: cpu as Address, abi, functionName: "eval", args: [id, toHex(bytes)] } as const;
      }),
      multicallAddress: "0xcA11bde05977b3631167028862bE2a173976CA11",
    });
    r.forEach((x, j) => {
      const o = x.status === "success" ? Number(BigInt("0x" + (x.result as string).slice(2, 4)) & 1n) : -1;
      const [a, b] = chunk[j];
      if (o !== (pred[op](a, b) ? 1 : 0)) { bad++; if (bad < 5) console.error("mismatch", a, b, o); }
    });
  }
  const gas = await client.estimateContractGas({ address: cpu as Address, abi, functionName: "eval", args: [id, toHex(new Uint8Array(Math.ceil(nIn / 8)))] });
  console.log(JSON.stringify({ processor: cpu, id: idS, nIn, nOut, nState, gateCount: gates, nandRecords: nand, latchRecords: latch, refs: refs.length,
    netlistHash: keccak256(nl), predicate: `a ${op} b, a = inputs 0..${w - 1}, b = inputs ${w}..${nIn - 1}`, vectors: pairs.length, mismatches: bad,
    evalEstimateGas: gas.toString(), block: (await client.getBlockNumber()).toString() }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
