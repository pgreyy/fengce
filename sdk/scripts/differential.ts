/**
 * Differential test, live and read-only: the SDK's local netlist interpreter against on-chain eval() on X Layer.
 *   npx tsx scripts/differential.ts [--rpc URL] [--n 100]
 * For each circuit, N random inputs are evaluated both ways; any difference fails the run.
 */
import { createPublicClient, http, parseAbi, toHex, type Address, type Hex } from "viem";
import { evaluateLocally, loadCircuit } from "../src/evaluate.js";

const rpc = process.argv.includes("--rpc") ? process.argv[process.argv.indexOf("--rpc") + 1] : "https://rpc.xlayer.tech";
const N = Number(process.argv.includes("--n") ? process.argv[process.argv.indexOf("--n") + 1] : 100);
const client = createPublicClient({ transport: http(rpc, { retryCount: 5, retryDelay: 500 }) });
const abi = parseAbi(["function eval(uint256,bytes) view returns (bytes)"]);
const MC = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

const circuits: { name: string; cpu: Address; id: bigint; nIn: number }[] = [
  { name: "NAND (0x839bdD…574e #2)", cpu: "0x839bdD6fa7A66416A609A735e11DE5411B98574e", id: 2n, nIn: 2 },
  { name: "16-bit comparator (0xF9bBdc…0a0F #7)", cpu: "0xF9bBdc7f678eb3A49D338ffAcDaaD9339de50a0F", id: 7n, nIn: 32 },
  { name: "XOR via REF (0xB04EB7…93FF #5)", cpu: "0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF", id: 5n, nIn: 2 },
];

const rnd = (nIn: number): Hex => toHex(Uint8Array.from({ length: Math.ceil(nIn / 8) }, (_, i) => {
  const byte = Math.floor(Math.random() * 256);
  const bitsHere = Math.min(8, nIn - 8 * i);
  return bitsHere === 8 ? byte : byte & ((1 << bitsHere) - 1);
}));

let failures = 0;
const block = await client.getBlockNumber();
for (const c of circuits) {
  const cache = await loadCircuit(client as any, c.cpu, c.id, new Map(), block);
  const inputs = [...Array(N)].map(() => rnd(c.nIn));
  const chain = await client.multicall({
    contracts: inputs.map((x) => ({ address: c.cpu, abi, functionName: "eval", args: [c.id, x] }) as const),
    multicallAddress: MC,
    allowFailure: false,
    blockNumber: block,
  });
  let same = 0;
  for (let i = 0; i < N; i++) {
    const local = (await evaluateLocally(client as any, c.cpu, c.id, inputs[i], "0x", cache)).output;
    if (local === chain[i]) same++;
    else {
      failures++;
      console.error(`MISMATCH ${c.name} input ${inputs[i]}: local ${local} chain ${chain[i]}`);
    }
  }
  console.log(`${c.name}: ${same}/${N} identical`);
}
console.log(`block ${block}; ${failures === 0 ? "all identical" : `${failures} mismatches`}`);
process.exit(failures === 0 ? 0 : 1);
