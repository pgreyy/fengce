import {
  hexToBytes,
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
import { CatalogArtifact, FengceGuardArtifact, FengceInspectorArtifact, PinRegistryArtifact } from "./artifacts.js";
import { catalogEntry } from "./catalog.js";
import { BINDING_SOURCES, type SchemaFile, encodeInputs, parseSchema, schemaHash, toLayout } from "./schema.js";
import { MIN_DELAYS } from "./install.js";
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
    probeSource: "zero" | "input" | "schema";
    probeSchemaHash: Hex | null;
    probeAllowed: boolean | null;
    fullPath: string | null; // full Safe path: safeOverhead + preCheck + outcomeCheck
    safeOverhead: string | null; // Safe transaction with no guard (execution overhead)
    preCheck: string | null; // added by the guard's pre-execution check
    outcomeCheck: string | null; // added by the outcome check (FengceInspector) after execution
    evalCall: string | null;
    intentEval: string | null; // pre-execution evaluation (pin checks + eval), measured alone
    outcomeEval: string | null; // post-execution evaluation (FengceInspector outcome facts), measured alone
    tierBasis: string | null; // the figure the tier is based on
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

/** The circuit and every circuit it references (REF), as a tree. */
export async function circuitTree(client: PublicClient, processor: Address, circuitId: bigint, blockNumber?: bigint): Promise<TreeNode> {
  const block = blockNumber ?? (await client.getBlockNumber());
  return tree(client, block, processor, circuitId, new Map());
}

/**
 * The dependency closure of a circuit, computed exactly as PinRegistry.pin does: breadth-first over
 * REF records, distinct (processor, id) pairs, root excluded from the hash.
 */
export async function refClosure(client: PublicClient, processor: Address, circuitId: bigint, blockNumber?: bigint) {
  const block = blockNumber ?? (await client.getBlockNumber());
  return closure(client, block, processor, circuitId, new Map());
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
 * native value of the probe transfer. For nIn <= 256 the transfer value is the input itself; for
 * wider circuits only the all-zero probe can use the full path. */
function probeLayout(netlistHash: Hex, nIn: number, input: Hex) {
  const fields: { kind: number; offset: number; width: number; fixedValue: bigint }[] = [];
  if (nIn <= 256) {
    // Every input bit is a flag fixed to the probe input, so the pre-check and the outcome check (which runs
    // with the transaction fields at zero) evaluate the same input.
    const v = inputToInt(input);
    for (let i = 0; i < nIn; i++) fields.push({ kind: 2, offset: i, width: 1, fixedValue: (v >> BigInt(i)) & 1n });
    return { layout: { netlistHash, nIn, fields }, schemaHash: schemaHash({ netlistHash, nIn, fields }), bindings: [] as { source: number; param: bigint }[] };
  }
  // Wide circuits: uint chunks fed from the transfer value (0), so only the all-zero probe fits.
  for (let off = 0; off < nIn; off += 256) fields.push({ kind: 0, offset: off, width: Math.min(256, nIn - off), fixedValue: 0n });
  return { layout: { netlistHash, nIn, fields }, schemaHash: schemaHash({ netlistHash, nIn, fields }), bindings: fields.map(() => ({ source: 1, param: 0n })) };
}

/** Reads packed input bytes (LSB first) as an integer. */
function inputToInt(input: Hex): bigint {
  const bytes = hexToBytes(input);
  let v = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]);
  return v;
}

export interface QuoteOptions {
  /** Probe input bytes (exactly ceil(nIn/8), zero padding). Used when the circuit denies all-zero input. */
  input?: Hex;
  /** Or: a schema for this circuit plus field values; the encoded bytes become the probe input. */
  schema?: SchemaFile;
  values?: Record<string, bigint | number | boolean | string>;
}

export interface QuoteEnv {
  fork: PublicClient; // anvil fork of X Layer
  wallet: WalletClient; // unlocked anvil account
  account: Address;
}

/**
 * Builds the certificate for (processor, circuitId) on the fork, measures gas on the real
 * Safe v1.5.0 -> FengceGuard -> circuit path, then pins the circuit on the fork with the resulting
 * certificateHash and reads it back from PinRegistry.
 */
export async function quote(env: QuoteEnv, processor: Address, circuitId: bigint, opts: QuoteOptions = {}) {
  const { fork, wallet, account } = env;
  const block = await fork.getBlockNumber();
  const cache = new Map<Key, any>();
  const root = await tree(fork, block, processor, circuitId, cache);
  const { refClosureHash, processors } = await closure(fork, block, processor, circuitId, cache);
  const inLen = Math.ceil(root.nIn / 8);
  let probeInput: Hex = toHex(new Uint8Array(inLen));
  let probeSource: Certificate["gas"]["probeSource"] = "zero";
  let probeSchemaHash: Hex | null = null;
  // With a schema that has bindings, Quote measures that exact schema: the guard is configured with its layout and
  // bindings, and the probe is a native transfer whose value produces the given field values. Only the Value and
  // Amount sources are supported (for a native transfer both equal the value), and all bound values must be equal.
  let realProbe: { layout: ReturnType<typeof toLayout>; bindings: { source: number; param: bigint }[]; schemaHash: Hex; txValue: bigint } | null = null;
  if (opts.schema) {
    const sch = parseSchema(opts.schema);
    if (sch.netlistHash !== root.netlistHash || sch.nIn !== root.nIn) throw new Error("schema is bound to a different circuit (netlistHash or nIn differs)");
    probeInput = encodeInputs(sch, opts.values ?? {});
    probeSource = "schema";
    probeSchemaHash = schemaHash(sch);
    if (sch.bindings) {
      const order = sch.fields.filter((f) => f.kind !== "flag").map((f) => f.name);
      const bound = order.map((name) => sch.bindings!.find((b) => b.field === name)!);
      if (bound.some((b) => b.source !== "Value" && b.source !== "Amount")) {
        throw new Error("a schema measured on the full path may bind fields only to Value or Amount (a native transfer carries them)");
      }
      const vals = new Set(order.map((n) => BigInt((opts.values ?? {})[n] as any)));
      if (vals.size !== 1) throw new Error("all bound field values must be equal (they all come from the transfer value)");
      realProbe = {
        layout: toLayout(sch),
        bindings: bound.map((b) => ({ source: BINDING_SOURCES.indexOf(b.source), param: BigInt(b.param ?? 0) })),
        schemaHash: probeSchemaHash,
        txValue: [...vals][0],
      };
    }
  } else if (opts.input) {
    const b = hexToBytes(opts.input);
    if (b.length !== inLen) throw new Error(`input must be exactly ${inLen} byte(s) for nIn ${root.nIn}`);
    if (root.nIn % 8 !== 0 && b[inLen - 1] >> root.nIn % 8 !== 0) throw new Error("input has non-zero padding bits");
    probeInput = opts.input;
    probeSource = "input";
  }

  const send = async (req: any) => {
    const hash = await wallet.writeContract({ account, chain: null, ...req });
    const r = await fork.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`tx failed: ${req.functionName}`);
    return r;
  };
  const deploy = async (name: "PinRegistry" | "FengceGuard" | "Catalog" | "FengceInspector", args: unknown[]) => {
    const a =
      name === "PinRegistry" ? PinRegistryArtifact : name === "Catalog" ? CatalogArtifact : name === "FengceInspector" ? FengceInspectorArtifact : FengceGuardArtifact;
    const hash = await wallet.deployContract({ abi: a.abi as Abi, bytecode: a.bytecode, args: args as any, account, chain: null });
    const r = await fork.waitForTransactionReceipt({ hash });
    if (!r.contractAddress) throw new Error(`deploy failed: ${name}`);
    return { address: r.contractAddress, abi: a.abi as Abi };
  };

  const registry = await deploy("PinRegistry", [XLAYER.tapeoutFactory]);
  const guard = await deploy("FengceGuard", [registry.address, 30_000_000n]);
  const inspector = await deploy("FengceInspector", [[guard.address]]);

  let gas: Certificate["gas"] = {
    method: "eth_estimateGas",
    path: "full Safe path: Safe v1.5.0 execTransaction (native transfer carrying the probe) -> FengceGuard pre-check (PinRegistry.isPinned -> eval of the probe input) -> execution -> FengceInspector outcome check (snapshot, verify, eval)",
    probeInput,
    probeSource,
    probeSchemaHash,
    probeAllowed: null,
    fullPath: null,
    safeOverhead: null,
    preCheck: null,
    outcomeCheck: null,
    evalCall: null,
    intentEval: null,
    outcomeEval: null,
    tierBasis: null,
  };
  let tier: Certificate["tier"];
  let tierReason: string;

  if (root.nState > 0) {
    tier = "Unsupported";
    tierReason = "circuit has state (LATCH): eval reverts with 'has latch: use step'; it runs as a stateful policy through Tick (step()), so it gets no eval-path gas tier";
  } else {
    gas.evalCall = (await fork.estimateContractGas({ address: processor, abi: processorAbi, functionName: "eval", args: [circuitId, probeInput], account })).toString();

    // Probe pin (certificateHash 0); Safes owned by the anvil account.
    const p = realProbe ?? { ...probeLayout(root.netlistHash, root.nIn, probeInput), txValue: 0n };
    const pinR = await send({ address: registry.address, abi: registry.abi, functionName: "pin", args: [processor, circuitId, p.schemaHash, pad("0x", { size: 32 })] });
    const pinId = pinR.logs.find((l) => l.address.toLowerCase() === registry.address.toLowerCase())!.topics[1] as Hex;

    const sig = concat([pad(account, { size: 32 }), pad("0x", { size: 32 }), "0x01"]);
    const execArgs = (to: Address, data: Hex, value = 0n) => [to, value, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, sig] as const;
    const recipient = getAddress("0x00000000000000000000000000000000000f3c3e");
    const newSafe = async (tag: string) => {
      const init = encodeFunctionData({ abi: safeAbi, functionName: "setup", args: [[account], 1n, zeroAddress, "0x", XLAYER.fallbackHandler, zeroAddress, 0n, zeroAddress] });
      const salt = BigInt(keccak256(toHex(`fengce-quote-${processor}-${circuitId}-${block}-${tag}`)));
      const sim = await fork.simulateContract({ address: XLAYER.safeProxyFactory, abi: proxyFactoryAbi, functionName: "createProxyWithNonce", args: [XLAYER.safeL2, init, salt], account });
      await send({ address: XLAYER.safeProxyFactory, abi: proxyFactoryAbi, functionName: "createProxyWithNonce", args: [XLAYER.safeL2, init, salt] });
      await fork.request({ method: "anvil_setBalance", params: [sim.result, toHex(p.txValue + 10n ** 18n)] } as any);
      return sim.result as Address;
    };
    const cfg = {
      pinId, layout: p.layout, bindings: p.bindings, ...MIN_DELAYS,
      preflightTokens: [], preflightSpenders: [], acceptExistingApprovals: false, acceptExistingModules: false,
    };
    const setGuardAbi = [{ type: "function", name: "setGuard", inputs: [{ name: "g", type: "address" }], outputs: [], stateMutability: "nonpayable" }] as const;
    const install = async (safe: Address, withInspector: boolean) => {
      if (withInspector) {
        // The Inspector watches native currency (the probe is a native transfer).
        const watch = encodeAbiParameters([{ type: "address[]" }, { type: "address[]" }], [[zeroAddress], []]);
        await send({ address: safe, abi: safeAbi, functionName: "execTransaction", args: execArgs(guard.address, encodeFunctionData({ abi: guard.abi, functionName: "configureInspector", args: [inspector.address, watch] })) });
      }
      await send({ address: safe, abi: safeAbi, functionName: "execTransaction", args: execArgs(guard.address, encodeFunctionData({ abi: guard.abi, functionName: "configure", args: [cfg] })) });
      await send({ address: safe, abi: safeAbi, functionName: "execTransaction", args: execArgs(safe, encodeFunctionData({ abi: setGuardAbi, functionName: "setGuard", args: [guard.address] })) });
    };
    const estimate = async (safe: Address) =>
      fork.estimateContractGas({ address: safe, abi: safeAbi, functionName: "execTransaction", args: execArgs(recipient, "0x", p.txValue), account });

    // Three measurements of the same transfer: no guard; guard pre-check only; pre-check + outcome check.
    const safeA = await newSafe("pre");
    const overhead = await estimate(safeA);
    gas.safeOverhead = overhead.toString();
    const fullPathPossible = realProbe !== null || root.nIn <= 256 || inputToInt(probeInput) === 0n;
    try {
      if (!fullPathPossible) throw new Error("wide input");
      await install(safeA, false);
      const pre = await estimate(safeA);
      const safeB = await newSafe("full");
      await install(safeB, true);
      const full = await estimate(safeB);
      gas.fullPath = full.toString();
      gas.preCheck = (pre - overhead).toString();
      gas.outcomeCheck = (full - pre).toString();
      gas.probeAllowed = true;
    } catch {
      // The circuit denies the probe input (the Safe transaction reverts and cannot be estimated), or a non-zero
      // input is wider than 256 bits. Fall back to the guard's evaluation path, which returns instead of reverting.
      gas.probeAllowed = fullPathPossible ? false : null;
      gas.path = fullPathPossible
        ? "FengceGuard.evaluate (PinRegistry.isPinned -> eval); the full Safe path reverts because the circuit denies the probe input"
        : "FengceGuard.evaluate (PinRegistry.isPinned -> eval); a non-zero probe wider than 256 inputs is not supported on the full path";
      gas.fullPath = (await fork.estimateContractGas({ address: guard.address, abi: guard.abi, functionName: "evaluate", args: [pinId, probeInput], account })).toString();
    }
    const safe = safeA;
    // Each evaluation alone: intent (pin checks + eval) and outcome (the same circuit on outcome facts).
    gas.intentEval = (await fork.estimateContractGas({ address: guard.address, abi: guard.abi, functionName: "evaluate", args: [pinId, probeInput], account })).toString();
    const outcomeFacts = {
      kind: 3, to: zeroAddress, value: 0n, token: zeroAddress, amount: 0n, selector: "0x00000000", account: safe, actor: zeroAddress,
      tokenOut: zeroAddress, minAmountOut: 0n, recipient: zeroAddress, deadline: 0n, action: 0, outflow: 0n, allowanceIncrease: 0n,
    };
    try {
      gas.outcomeEval = (await fork.estimateContractGas({ address: guard.address, abi: guard.abi, functionName: "checkContext", args: [safe, outcomeFacts], account })).toString();
    } catch {
      gas.outcomeEval = gas.intentEval; // the circuit denies the zero outcome; its evaluation cost equals the intent pass
    }
    if (gas.probeAllowed) {
      gas.tierBasis = "full Safe path";
      tier = tierFor(BigInt(gas.fullPath!));
      tierReason = `full Safe path: ${gas.fullPath} gas = Safe execution overhead ${gas.safeOverhead} + pre-check ${gas.preCheck} + outcome check ${gas.outcomeCheck}`;
    } else {
      const total = BigInt(gas.intentEval) + BigInt(gas.outcomeEval);
      gas.tierBasis = "eval gas: intentEval + outcomeEval (full Safe path not measurable with this probe)";
      tier = tierFor(total);
      tierReason = `intent ${gas.intentEval} + outcome ${gas.outcomeEval} = ${total} gas (the full Safe path could not be estimated with this probe)`;
    }
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
  const pinIdCheck = r.logs.find((l) => l.address.toLowerCase() === registry.address.toLowerCase())!.topics[1] as Hex;
  const stored: any = await fork.readContract({ address: registry.address, abi: registry.abi, functionName: "circuitPin", args: [pinIdCheck] });
  // Catalog: list the pin with the probe as a test vector (run on-chain at listing), read it back through
  // the SDK reader, and compare its certificate hash and tier with this certificate.
  let catalogCheck: Record<string, unknown> = { skipped: "circuit has state; eval-based listing does not apply" };
  if (root.nState === 0) {
    const catalog = await deploy("Catalog", [registry.address, 30_000_000n, account]);
    const out = (await fork.readContract({ address: guard.address, abi: guard.abi, functionName: "evaluate", args: [pinIdCheck, probeInput] })) as Hex;
    const manifest = {
      pinId: pinIdCheck, description: "", schemaHash: pad("0x", { size: 32 }), vectors: [{ input: probeInput, expectedOutput: out, state: "0x" }],
      designer: account, installFee: 0n, uri: "",
    };
    await send({ address: catalog.address, abi: catalog.abi, functionName: "list", args: [manifest] });
    const entry = await catalogEntry(fork, catalog.address, pinIdCheck);
    catalogCheck = {
      certificateHash: entry.certificateHash, tier: entry.tier, measuredEvalGas: entry.measuredGas.toString(),
      certificateHashMatches: entry.certificateHash === certHash, tierMatchesQuote: entry.tier === cert.tier,
    };
  }
  const check = {
    catalog: catalogCheck,
    pinIdOnFork: pinIdCheck,
    certificateHashStored: stored.certificateHash as Hex,
    refClosureHashStored: stored.refClosureHash as Hex,
    netlistHashStored: stored.netlistHash as Hex,
    allMatch:
      stored.certificateHash === certHash && stored.refClosureHash === refClosureHash && stored.netlistHash === root.netlistHash,
  };
  return { certificate: cert, certificateHash: certHash, forkCheck: check };
}
