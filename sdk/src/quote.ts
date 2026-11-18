import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  keccak256,
  pad,
  toHex,
  zeroAddress,
} from "viem";
import { XLAYER, processorAbi, proxyFactoryAbi, safeAbi } from "./abi.js";
import { parseRefs } from "./netlist.js";
import { TIERS, type Tier, tierFor } from "./tiers.js";

export interface TreeNode {
  processor: Address;
  circuitId: string;
  netlistHash: Hex;
  nIn: number;
  nOut: number;
  nState: number;
  gateCount: number;
  refs: TreeNode[];
}

export interface Certificate {
  format: "fengce-quote/1";
  chainId: number;
  block: string;
  processor: Address;
  circuitId: string;
  circuit: { nIn: number; nOut: number; nState: number; gateCount: number; netlistHash: Hex };
  refClosureHash: Hex;
  processors: Address[];
  dependencyTree: TreeNode;
  gas: {
    method: string;
    path: string;
    probeInput: Hex;
    probeAllowed: boolean | null;
    fullPath: string | null;
    safeBaseline: string | null;
    evalCall: string | null;
  };
  tier: Tier | "Unsupported";
  tierReason: string;
  tierThresholds: { greenMaxGas: string; amberMaxGas: string };
}

const MAX_CLOSURE = 64; // same bound as PinRegistry

type Key = string;
const key = (cpu: Address, id: bigint): Key => `${getAddress(cpu)}:${id}`;

/** Reads circuitInfo + netlist for every circuit reached through REF, with a cache. */
async function load(client: PublicClient, block: bigint, cpu: Address, id: bigint, cache: Map<Key, any>) {
  const k = key(cpu, id);
  if (!cache.has(k)) {
    const [info, netlist] = await Promise.all([
      client.readContract({ address: cpu, abi: processorAbi, functionName: "circuitInfo", args: [id], blockNumber: block }),
      client.readContract({ address: cpu, abi: processorAbi, functionName: "netlist", args: [id], blockNumber: block }),
    ]);
    cache.set(k, { info, netlist: netlist as Hex, refs: parseRefs(netlist as Hex).refs });
  }
  return cache.get(k);
}

async function tree(client: PublicClient, block: bigint, cpu: Address, id: bigint, cache: Map<Key, any>, depth = 0): Promise<TreeNode> {
  if (depth > MAX_CLOSURE) throw new Error("REF tree deeper than MAX_CLOSURE");
  const c = await load(client, block, cpu, id, cache);
  const [nIn, nOut, nState, gateCount] = c.info as readonly [number, number, number, number];
  const refs: TreeNode[] = [];
  for (const r of c.refs) refs.push(await tree(client, block, r.cpu, r.id, cache, depth + 1));
  return { processor: getAddress(cpu), circuitId: id.toString(), netlistHash: keccak256(c.netlist), nIn, nOut, nState, gateCount, refs };
}

/** Breadth-first closure hash, exactly as PinRegistry._closure computes it. */
async function closure(client: PublicClient, block: bigint, root: Address, id: bigint, cache: Map<Key, any>) {
  const order: { cpu: Address; id: bigint; hash: Hex }[] = [];
  const seen = new Set<Key>();
  const processors: Address[] = [getAddress(root)];
  const rootC = await load(client, block, root, id, cache);
  order.push({ cpu: getAddress(root), id, hash: keccak256(rootC.netlist) });
  seen.add(key(root, id));
  for (let head = 0; head < order.length; head++) {
    const c = await load(client, block, order[head].cpu, order[head].id, cache);
    for (const r of c.refs) {
      const k = key(r.cpu, r.id);
      if (seen.has(k)) continue;
      if (order.length === MAX_CLOSURE) throw new Error("closure larger than MAX_CLOSURE");
      seen.add(k);
      const rc = await load(client, block, r.cpu, r.id, cache);
      order.push({ cpu: getAddress(r.cpu), id: r.id, hash: keccak256(rc.netlist) });
      if (!processors.includes(getAddress(r.cpu))) processors.push(getAddress(r.cpu));
    }
  }
  const parts = order.slice(1).map((e) => encodePacked(["address", "uint256", "bytes32"], [e.cpu, e.id, e.hash]));
  return { refClosureHash: keccak256(parts.length ? concat(parts) : "0x"), processors };
}

/** Canonical JSON: keys sorted at every level, no whitespace. certificateHash = keccak256 of it. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export function certificateHash(cert: Certificate): Hex {
  return keccak256(toHex(canonicalJson(cert)));
}

function artifact(outDir: string, name: string): { abi: Abi; bytecode: Hex } {
  const j = JSON.parse(readFileSync(resolve(outDir, `${name}.sol`, `${name}.json`), "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
}

const fieldsType = [
  {
    type: "tuple[]",
    components: [
      { name: "kind", type: "uint8" },
      { name: "offset", type: "uint32" },
      { name: "width", type: "uint32" },
      { name: "fixedValue", type: "uint256" },
    ],
  },
] as const;

/** A probe layout covering every input bit with uint fields of up to 256 bits, all fed from the
 * native value. A native transfer of 0 therefore evaluates the circuit on all-zero input. */
function probeLayout(netlistHash: Hex, nIn: number) {
  const fields: { kind: number; offset: number; width: number; fixedValue: bigint }[] = [];
  for (let off = 0; off < nIn; off += 256) fields.push({ kind: 0, offset: off, width: Math.min(256, nIn - off), fixedValue: 0n });
  const schemaHash = keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "uint32" }, ...fieldsType], [netlistHash, nIn, fields]),
  );
  return { layout: { netlistHash, nIn, fields }, schemaHash, bindings: fields.map(() => ({ source: 1, param: 0n })) };
}

export interface QuoteEnv {
  fork: PublicClient; // anvil fork of X Layer
  wallet: WalletClient; // unlocked anvil account
  account: Address;
  outDir: string; // forge build output
}

/**
 * Builds the certificate for (processor, circuitId) on the fork, measures gas on the real
 * Safe v1.5.0 -> FengceGuard -> circuit path, then pins the circuit on the fork with the resulting
 * certificateHash and reads it back from PinRegistry.
 */
export async function quote(env: QuoteEnv, processor: Address, circuitId: bigint) {
  const { fork, wallet, account } = env;
  const block = await fork.getBlockNumber();
  const cache = new Map<Key, any>();
  const root = await tree(fork, block, processor, circuitId, cache);
  const { refClosureHash, processors } = await closure(fork, block, processor, circuitId, cache);
  const probeInput = toHex(new Uint8Array(Math.ceil(root.nIn / 8)));

  const send = async (req: any) => {
    const hash = await wallet.writeContract({ account, chain: null, ...req });
    const r = await fork.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`tx failed: ${req.functionName}`);
    return r;
  };
  const deploy = async (name: string, args: unknown[]) => {
    const a = artifact(env.outDir, name);
    const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args, account, chain: null });
    const r = await fork.waitForTransactionReceipt({ hash });
    if (!r.contractAddress) throw new Error(`deploy failed: ${name}`);
    return { address: r.contractAddress, abi: a.abi };
  };

  const registry = await deploy("PinRegistry", [XLAYER.tapeoutFactory]);
  const guard = await deploy("FengceGuard", [registry.address, 30_000_000n]);

  let gas: Certificate["gas"] = {
    method: "eth_estimateGas",
    path: "Safe v1.5.0 execTransaction (native transfer of 0) -> FengceGuard.checkTransaction -> PinRegistry.isPinned -> eval",
    probeInput,
    probeAllowed: null,
    fullPath: null,
    safeBaseline: null,
    evalCall: null,
  };
  let tier: Certificate["tier"];
  let tierReason: string;

  if (root.nState > 0) {
    tier = "Unsupported";
    tierReason = "circuit has state (LATCH); eval reverts with 'has latch: use step', so it cannot be a per-transaction policy";
  } else {
    gas.evalCall = (await fork.estimateContractGas({ address: processor, abi: processorAbi, functionName: "eval", args: [circuitId, probeInput], account })).toString();

    // Probe pin (certificateHash 0) and a fresh Safe owned by the anvil account.
    const p = probeLayout(root.netlistHash, root.nIn);
    const pinR = await send({ address: registry.address, abi: registry.abi, functionName: "pin", args: [processor, circuitId, p.schemaHash, pad("0x", { size: 32 })] });
    const pinId = pinR.logs.find((l) => l.address.toLowerCase() === registry.address.toLowerCase())!.topics[1] as Hex;

    const init = encodeFunctionData({ abi: safeAbi, functionName: "setup", args: [[account], 1n, zeroAddress, "0x", XLAYER.fallbackHandler, zeroAddress, 0n, zeroAddress] });
    const salt = BigInt(keccak256(toHex(`fengce-quote-${processor}-${circuitId}-${block}`)));
    const sim = await fork.simulateContract({ address: XLAYER.safeProxyFactory, abi: proxyFactoryAbi, functionName: "createProxyWithNonce", args: [XLAYER.safeL2, init, salt], account });
    await send({ address: XLAYER.safeProxyFactory, abi: proxyFactoryAbi, functionName: "createProxyWithNonce", args: [XLAYER.safeL2, init, salt] });
    const safe = sim.result as Address;
    const sig = concat([pad(account, { size: 32 }), pad("0x", { size: 32 }), "0x01"]);
    const execArgs = (to: Address, data: Hex) => [to, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, sig] as const;
    const recipient = getAddress("0x00000000000000000000000000000000000f3c3e");

    gas.safeBaseline = (await fork.estimateContractGas({ address: safe, abi: safeAbi, functionName: "execTransaction", args: execArgs(recipient, "0x"), account })).toString();

    const cfg = {
      pinId, layout: p.layout, bindings: p.bindings, recoveryDelay: 0n, recoveryWindow: 1n, adminDelay: 0n,
      preflightTokens: [], preflightSpenders: [], acceptExistingApprovals: false,
    };
    await send({ address: safe, abi: safeAbi, functionName: "execTransaction", args: execArgs(guard.address, encodeFunctionData({ abi: guard.abi, functionName: "configure", args: [cfg] })) });
    await send({ address: safe, abi: safeAbi, functionName: "execTransaction", args: execArgs(safe, encodeFunctionData({ abi: [{ type: "function", name: "setGuard", inputs: [{ name: "g", type: "address" }], outputs: [], stateMutability: "nonpayable" }], functionName: "setGuard", args: [guard.address] })) });

    try {
      gas.fullPath = (await fork.estimateContractGas({ address: safe, abi: safeAbi, functionName: "execTransaction", args: execArgs(recipient, "0x"), account })).toString();
      gas.probeAllowed = true;
    } catch {
      // The circuit denies the all-zero probe, so the Safe transaction reverts and cannot be
      // estimated. Fall back to the guard's own evaluation path (pin check + eval), which returns
      // the output instead of reverting.
      gas.probeAllowed = false;
      gas.path = "FengceGuard.evaluate (PinRegistry.isPinned -> eval); the full Safe path reverts because the circuit denies the all-zero probe";
      gas.fullPath = (await fork.estimateContractGas({ address: guard.address, abi: guard.abi, functionName: "evaluate", args: [pinId, probeInput], account })).toString();
    }
    tier = tierFor(BigInt(gas.fullPath));
    tierReason = `measured ${gas.fullPath} gas on the path above`;
  }

  const cert: Certificate = {
    format: "fengce-quote/1",
    chainId: await fork.getChainId(),
    block: block.toString(),
    processor: getAddress(processor),
    circuitId: circuitId.toString(),
    circuit: { nIn: root.nIn, nOut: root.nOut, nState: root.nState, gateCount: root.gateCount, netlistHash: root.netlistHash },
    refClosureHash,
    processors,
    dependencyTree: root,
    gas,
    tier,
    tierReason,
    tierThresholds: { greenMaxGas: TIERS.greenMaxGas.toString(), amberMaxGas: TIERS.amberMaxGas.toString() },
  };
  const certHash = certificateHash(cert);

  // Cross-check: pin with this certificateHash on the fork and read back what PinRegistry stored.
  const r = await send({ address: registry.address, abi: registry.abi, functionName: "pin", args: [processor, circuitId, pad("0x", { size: 32 }), certHash] });
  const pinId = r.logs.find((l) => l.address.toLowerCase() === registry.address.toLowerCase())!.topics[1] as Hex;
  const stored: any = await fork.readContract({ address: registry.address, abi: registry.abi, functionName: "circuitPin", args: [pinId] });
  const check = {
    pinIdOnFork: pinId,
    certificateHashStored: stored.certificateHash as Hex,
    refClosureHashStored: stored.refClosureHash as Hex,
    netlistHashStored: stored.netlistHash as Hex,
    allMatch:
      stored.certificateHash === certHash && stored.refClosureHash === refClosureHash && stored.netlistHash === root.netlistHash,
  };
  return { certificate: cert, certificateHash: certHash, forkCheck: check };
}
