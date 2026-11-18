// Compares evaluateTrace (local, gate by gate) with the processor's on-chain eval. Read-only RPC calls.
import { createPublicClient, http, type Address, type Hex } from "viem";
import { evaluateTrace, processorAbi } from "../src/index.js";

const client = createPublicClient({ transport: http(process.env.XLAYER_RPC ?? "https://rpc.xlayer.tech") });
const cases: { name: string; cpu: Address; id: bigint; input: Hex }[] = [
  { name: "NAND #2", cpu: "0x839bdD6fa7A66416A609A735e11DE5411B98574e", id: 2n, input: "0x03" },
  { name: "comparator #7", cpu: "0xF9bBdc7f678eb3A49D338ffAcDaaD9339de50a0F", id: 7n, input: "0x90019001" },
];
let bad = 0;
for (const c of cases) {
  const block = await client.getBlockNumber();
  const onchain = (await client.readContract({ address: c.cpu, abi: processorAbi, functionName: "eval", args: [c.id, c.input], blockNumber: block })) as Hex;
  const { output, trace } = await evaluateTrace(client as never, c.cpu, c.id, c.input);
  const ok = output.toLowerCase() === onchain.toLowerCase();
  if (!ok) bad++;
  console.log(`${c.name} input ${c.input}: trace ${output}, on-chain eval ${onchain} at block ${block}: ${ok ? "equal" : "DIFFERENT"} (${trace.records.length} records, depth ${trace.depth})`);
}
process.exit(bad ? 1 : 0);
