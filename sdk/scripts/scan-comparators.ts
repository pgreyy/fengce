/**
 * Read-only scan of every TapeOut circuit on X Layer for comparator-style circuits.
 *   npx tsx scripts/scan-comparators.ts [--rpc URL]
 * Candidates: stateless, 1 or 2 outputs, 2..256 inputs. Each candidate is tested with eval on
 * sample vectors (bit 0 of the output) as:
 *  - two operands, a = low half of the inputs, b = high half (LSB first): a>=b, a>b, a<=b, a<b, a==b
 *  - one operand x = all inputs: x >= t or x <= t for some fixed t (monotone step)
 */
import { createPublicClient, http, parseAbi, type Address, toHex } from "viem";

const rpc = process.argv.includes("--rpc") ? process.argv[process.argv.indexOf("--rpc") + 1] : "https://rpc.xlayer.tech";
const FACTORY = "0x1f09DAeFA827f02CBb40967cc91b259763760761" as const;
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const client = createPublicClient({ transport: http(rpc, { batch: false, retryCount: 5 }) });
const factoryAbi = parseAbi(["function cpuCount() view returns (uint256)", "function cpuAt(uint256) view returns (address)"]);
const cpuAbi = parseAbi([
  "function nextId() view returns (uint256)",
  "function circuitInfo(uint256) view returns (uint32,uint32,uint32,uint32)",
  "function eval(uint256,bytes) view returns (bytes)",
]);

async function mc<T>(calls: any[]): Promise<(T | null)[]> {
  const out: (T | null)[] = [];
  for (let i = 0; i < calls.length; i += 200) {
    const r = await client.multicall({ contracts: calls.slice(i, i + 200), multicallAddress: MULTICALL, allowFailure: true, batchSize: 0 });
    for (const x of r) out.push(x.status === "success" ? (x.result as T) : null);
  }
  return out;
}

function pack(bits: bigint, n: number): `0x${string}` {
  const bytes = new Uint8Array(Math.ceil(n / 8));
  for (let i = 0; i < n; i++) if ((bits >> BigInt(i)) & 1n) bytes[i >> 3] |= 1 << (i & 7);
  return toHex(bytes);
}

function rnd(w: number): bigint {
  let x = 0n;
  for (let i = 0; i < w; i++) if (Math.random() < 0.5) x |= 1n << BigInt(i);
  return x;
}

async function main() {
  const count = Number(await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "cpuCount" }));
  const cpus = (await mc<Address>([...Array(count).keys()].map((i) => ({ address: FACTORY, abi: factoryAbi, functionName: "cpuAt", args: [BigInt(i)] })))) as Address[];
  const nexts = await mc<bigint>(cpus.map((a) => ({ address: a, abi: cpuAbi, functionName: "nextId" })));
  const ids: { cpu: Address; id: bigint }[] = [];
  cpus.forEach((cpu, i) => {
    for (let id = 1n; id < (nexts[i] ?? 1n); id++) ids.push({ cpu, id });
  });
  const infos = await mc<readonly [number, number, number, number]>(ids.map((c) => ({ address: c.cpu, abi: cpuAbi, functionName: "circuitInfo", args: [c.id] })));
  const cands = ids
    .map((c, i) => ({ ...c, info: infos[i] }))
    .filter((c) => c.info && c.info[2] === 0 && c.info[1] >= 1 && c.info[1] <= 2 && c.info[0] >= 2 && c.info[0] <= 256);
  console.error(`processors=${count} circuits=${ids.length} candidates=${cands.length}`);

  // Bound cost: a comparator of w-bit operands needs on the order of 10*w gates; skip huge circuits.
  const small = cands.filter((c) => c.info![3] <= 5000);
  const preds: Record<string, (a: bigint, b: bigint) => boolean> = {
    "a>=b": (a, b) => a >= b, "a>b": (a, b) => a > b, "a<=b": (a, b) => a <= b, "a<b": (a, b) => a < b, "a==b": (a, b) => a === b,
  };
  type Test = { c: (typeof small)[number]; kind: "two" | "one"; xs: bigint[]; pairs?: [bigint, bigint][] };
  const tests = (full: boolean) => (c: (typeof small)[number]): Test[] => {
    const nIn = c.info![0];
    const out: Test[] = [];
    if (nIn % 2 === 0) {
      const w = nIn / 2;
      const max = (1n << BigInt(w)) - 1n;
      const pairs: [bigint, bigint][] = [[0n, 0n], [0n, 1n], [1n, 0n], [max, 0n], [0n, max], [max, max]];
      if (full) {
        pairs.push([max - 1n, max], [max, max - 1n]);
        for (let i = 0; i < 24; i++) {
          const a = rnd(w);
          pairs.push([a, rnd(w)], [a, a]);
        }
      }
      out.push({ c, kind: "two", pairs, xs: pairs.map(([a, b]) => a | (b << BigInt(w))) });
    }
    const n = full ? 40 : 6;
    const xs = [0n, (1n << BigInt(nIn)) - 1n, ...[...Array(n)].map(() => rnd(nIn))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    out.push({ c, kind: "one", xs });
    return out;
  };
  const judge = (t: Test, o: number[]): string | null => {
    if (o.includes(-1)) return null;
    if (t.kind === "two") {
      const w = t.c.info![0] / 2;
      for (const [name, p] of Object.entries(preds)) {
        if (t.pairs!.every(([a, b], i) => o[i] === (p(a, b) ? 1 : 0))) return `two-operand ${name} (a = inputs 0..${w - 1}, b = inputs ${w}..${t.c.info![0] - 1}, LSB first)`;
      }
      return null;
    }
    if (o[0] === o[o.length - 1]) return null;
    const changes = o.slice(1).filter((v, i) => v !== o[i]).length;
    return changes === 1 ? `one-operand monotone step (${o[0] === 0 ? "x >= t" : "x <= t"} for a fixed t, on ${o.length} sorted samples)` : null;
  };
  const run = async (ts: Test[]) => {
    const calls = ts.flatMap((t) => t.xs.map((x) => ({ address: t.c.cpu, abi: cpuAbi, functionName: "eval", args: [t.c.id, pack(x, t.c.info![0])] })));
    const res: (number)[] = new Array(calls.length);
    const CH = 60;
    const chunks: number[] = [];
    for (let i = 0; i < calls.length; i += CH) chunks.push(i);
    for (let k = 0; k < chunks.length; k += 8) {
      await Promise.all(chunks.slice(k, k + 8).map(async (i) => {
        let r: any[];
        try {
          r = await client.multicall({ contracts: calls.slice(i, i + CH) as any, multicallAddress: MULTICALL, allowFailure: true, batchSize: 0 });
        } catch {
          r = calls.slice(i, i + CH).map(() => ({ status: "failure" }));
        }
        r.forEach((x, j) => {
          const o = x.status === "success" ? (x.result as string) : null;
          res[i + j] = o && o.length >= 4 ? Number(BigInt("0x" + o.slice(2, 4)) & 1n) : -1;
        });
      }));
      console.error(`evals ${Math.min((k + 8) * CH, calls.length)}/${calls.length}`);
    }
    let p = 0;
    return ts.map((t) => {
      const o = res.slice(p, p + t.xs.length);
      p += t.xs.length;
      return judge(t, o);
    });
  };

  const screen = small.flatMap(tests(false));
  const sres = await run(screen);
  const survivors = [...new Set(screen.filter((_, i) => sres[i]).map((t) => t.c))];
  console.error(`screened=${small.length} survivors=${survivors.length}`);
  const fullT = survivors.flatMap(tests(true));
  const fres = await run(fullT);
  const found: any[] = [];
  for (const c of survivors) {
    const matches = fullT.map((t, i) => (t.c === c ? fres[i] : null)).filter(Boolean);
    if (matches.length) found.push({ processor: c.cpu, id: c.id.toString(), nIn: c.info![0], nOut: c.info![1], gates: c.info![3], matches });
  }
  const skipped = cands.length - small.length;
  console.log(JSON.stringify({ rpc, block: (await client.getBlockNumber()).toString(), processors: count, circuits: ids.length, candidates: cands.length, skippedOver5000Gates: skipped, comparators: found }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
