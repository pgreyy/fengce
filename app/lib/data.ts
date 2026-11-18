import "server-only";
import {
  type Address,
  type Hex,
  decodeAbiParameters,
  decodeErrorResult,
  encodeDeployData,
  getAddress,
  keccak256,
  parseAbi,
  parseAbiItem,
  toHex,
  zeroAddress,
} from "viem";
import {
  BINDING_SOURCES,
  FengceGuardArtifact,
  PolicySimulatorArtifact,
  buildInstall,
  circuitTree,
  parseSchema,
  readCatalog,
  refClosure,
  schemaHash,
  tierFor,
  toLayout,
  type SchemaFile,
} from "@fengce/sdk";
import { ADDR, CATALOG, client } from "./chain";
import { PRESETS, presetFor, type PolicyPreset } from "./policies";

const cpuAbi = parseAbi([
  "function circuitInfo(uint256) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)",
  "function netlist(uint256) view returns (bytes)",
  "function eval(uint256,bytes) view returns (bytes)",
]);
const safeAbi = parseAbi([
  "function VERSION() view returns (string)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function getModulesPaginated(address,uint256) view returns (address[],address)",
  "function getStorageAt(uint256,uint256) view returns (bytes)",
]);
const SLOTS = {
  guard: 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8n,
  moduleGuard: 0xb104e0b93118902c651344349b610029d694cfdec91c589c91ebafbcd0289947n,
  fallbackHandler: 0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5n,
};

/** JSON-safe copy (bigints as strings). */
export function plain<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
}

function bits(hex: Hex, n: number): string {
  const b = Buffer.from(hex.slice(2), "hex");
  let s = "";
  for (let i = 0; i < n; i++) s += (b[i >> 3] >> (i & 7)) & 1 ? "1" : "0";
  return s; // bit 0 first
}

// ------------------------------------------------------------------ circuits

export async function circuit(processor: Address, id: bigint) {
  const block = await client.getBlockNumber();
  const [nIn, nOut, nState, gateCount] = await client.readContract({ address: processor, abi: cpuAbi, functionName: "circuitInfo", args: [id], blockNumber: block });
  const netlist = await client.readContract({ address: processor, abi: cpuAbi, functionName: "netlist", args: [id], blockNumber: block });
  const [tree, closure] = await Promise.all([circuitTree(client as any, processor, id, block), refClosure(client as any, processor, id, block)]);
  const preset = presetFor(processor, id);
  let evalGas: string | null = null;
  let tier: string | null = null;
  const vectors: { input: Hex; inputBits: string; output: Hex | null; outputBits: string | null; meaning: string }[] = [];
  if (nState === 0) {
    const zero = toHex(new Uint8Array(Math.ceil(nIn / 8)));
    try {
      const g = await client.estimateContractGas({ address: processor, abi: cpuAbi, functionName: "eval", args: [id, zero] });
      evalGas = g.toString();
      tier = tierFor(g);
    } catch {
      /* not estimable */
    }
    const inputs: { input: Hex; meaning: string }[] =
      preset?.vectors.length ? preset.vectors : nIn <= 4 ? [...Array(1 << nIn).keys()].map((x) => ({ input: toHex(new Uint8Array([x])), meaning: "" })) : [];
    for (const v of inputs) {
      let out: Hex | null = null;
      try {
        out = await client.readContract({ address: processor, abi: cpuAbi, functionName: "eval", args: [id, v.input] });
      } catch {
        out = null;
      }
      vectors.push({ ...v, inputBits: bits(v.input, nIn), output: out, outputBits: out ? bits(out, nOut) : null });
    }
  }
  return {
    block: block.toString(),
    processor: getAddress(processor),
    id: id.toString(),
    nIn,
    nOut,
    nState,
    gateCount,
    netlistHash: keccak256(netlist),
    refClosureHash: closure.refClosureHash,
    processors: closure.processors,
    tree,
    evalGas,
    tier,
    tierNote: "Tier from eth_estimateGas of eval on zero input (evaluation only, not the full Safe path).",
    description: preset?.description ?? null,
    presetKey: preset?.key ?? null,
    vectors,
  };
}

/** A preset's schema with the live netlist hash filled in. */
export async function presetSchema(p: PolicyPreset, cap: bigint): Promise<SchemaFile> {
  const netlist = await client.readContract({ address: p.processor, abi: cpuAbi, functionName: "netlist", args: [p.id] });
  return parseSchema({ ...p.schema(cap), netlistHash: keccak256(netlist) });
}

// ------------------------------------------------------------------ simulation

const STAGES = ["evaluated", "pin failed", "call not recognised", "value does not fit the schema", "evaluation failed"];

export async function simulate(req: { preset: string; cap?: string; account?: Address; to: Address; value?: string; data?: Hex }) {
  const p = PRESETS.find((x) => x.key === req.preset);
  if (!p) throw new Error(`unknown preset ${req.preset}`);
  if (p.stateful) throw new Error("stateful policies are simulated through Tick, not here");
  const cap = BigInt(req.cap ?? "100");
  const schema = await presetSchema(p, cap);
  const layout = toLayout(schema);
  const order = schema.fields.filter((f) => f.kind !== "flag").map((f) => f.name);
  const bindings = order.map((n) => {
    const b = schema.bindings!.find((x) => x.field === n)!;
    return { source: BINDING_SOURCES.indexOf(b.source), param: BigInt(b.param ?? 0) };
  });
  const account = req.account ?? ("0x000000000000000000000000000000000000fe11" as Address);
  const value = BigInt(req.value ?? "0");
  const data = (req.data ?? "0x") as Hex;
  const callData = encodeDeployData({
    abi: PolicySimulatorArtifact.abi as any,
    bytecode: PolicySimulatorArtifact.bytecode,
    args: [ADDR.tapeoutFactory, p.processor, p.id, layout, bindings, account, req.to, value, data],
  });
  const res = await client.call({ data: callData, gas: 100_000_000n });
  const factsType = (FengceGuardArtifact.abi as unknown as any[]).find((x) => x.name === "checkContext").inputs[1];
  const [stage, facts, input, output, err] = decodeAbiParameters(
    [{ type: "uint8" }, factsType, { type: "bytes" }, { type: "bytes" }, { type: "bytes" }],
    res.data!,
  ) as [number, any, Hex, Hex, Hex];
  let error: string | null = null;
  if (err !== "0x") {
    try {
      const d = decodeErrorResult({ abi: [...(FengceGuardArtifact.abi as unknown as any[]), ...(PolicySimulatorArtifact.abi as unknown as any[])], data: err });
      error = `${d.errorName}(${(d.args ?? []).map(String).join(", ")})`;
    } catch {
      error = err;
    }
  }
  const allowed = stage === 0 ? (parseInt(output.slice(2, 4), 16) & 1) === 1 : false;
  return plain({
    policy: { key: p.key, name: p.name, processor: p.processor, id: p.id, cap, schemaHash: schemaHash(schema), schema },
    tx: { account, to: req.to, value, data },
    stage: STAGES[stage],
    facts: stage >= 3 || stage === 0 ? { ...facts, kind: ["Native", "Transfer", "Approval", "Call", "Swap", "Lending"][facts.kind] } : null,
    input: stage === 0 || stage === 4 ? { hex: input, bits: bits(input, layout.nIn), fields: schema.fields.map((f) => f.name) } : null,
    output: stage === 0 ? { hex: output, bits: bits(output, 1) } : null,
    decision: stage === 0 ? (allowed ? "allow" : "deny") : "deny (fails closed)",
    error,
  });
}

// ------------------------------------------------------------------ safes

async function slot(safe: Address, s: bigint): Promise<Address> {
  const raw = await client.readContract({ address: safe, abi: safeAbi, functionName: "getStorageAt", args: [s, 1n] });
  return getAddress(`0x${raw.slice(-40)}`);
}

const GUARD_EVENTS = [
  "event RecoveryScheduled(address indexed safe, uint256 readyAt, uint256 expiresAt)",
  "event RecoveryExecuted(address indexed safe, bytes4 indexed selector, address newGuard)",
  "event RecoveryCancelled(address indexed safe)",
  "event AdminScheduled(address indexed safe, bytes32 indexed id, address target, bytes data, uint256 readyAt)",
  "event AdminExecuted(address indexed safe, bytes32 indexed id)",
  "event AdminCancelled(address indexed safe, bytes32 indexed id)",
  "event Configured(address indexed safe, bytes32 indexed pinId)",
];

export async function safeStatus(safe: Address, lookback = 1_000n) {
  const [version, owners, threshold, nonce, modules] = await Promise.all([
    client.readContract({ address: safe, abi: safeAbi, functionName: "VERSION" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "getThreshold" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "nonce" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "getModulesPaginated", args: ["0x0000000000000000000000000000000000000001", 50n] }),
  ]);
  const [guard, moduleGuard, fallbackHandler] = await Promise.all([slot(safe, SLOTS.guard), slot(safe, SLOTS.moduleGuard), slot(safe, SLOTS.fallbackHandler)]);
  let fengce: unknown = null;
  const events: unknown[] = [];
  if (guard !== zeroAddress) {
    try {
      const cfg = await client.readContract({ address: guard, abi: FengceGuardArtifact.abi as any, functionName: "configOf", args: [safe] });
      const [readyAt, expiresAt] = await Promise.all([
        client.readContract({ address: guard, abi: FengceGuardArtifact.abi as any, functionName: "recoveryReadyAt", args: [safe] }),
        client.readContract({ address: guard, abi: FengceGuardArtifact.abi as any, functionName: "recoveryExpiresAt", args: [safe] }),
      ]);
      const [set, pinId, recoveryDelay, recoveryWindow, adminDelay, tick, tickGroup] = cfg as any[];
      fengce = { set, pinId, recoveryDelay, recoveryWindow, adminDelay, tick, tickGroup, recovery: { readyAt, expiresAt } };
      // X Layer RPCs limit eth_getLogs to 100 blocks per request.
      const head = await client.getBlockNumber();
      for (let to = head; to > head - lookback && to > 0n; to -= 100n) {
        const from = to - 99n > 0n ? to - 99n : 0n;
        const logs = await client.getLogs({ address: guard, events: GUARD_EVENTS.map((e) => parseAbiItem(e)) as any, args: { safe } as any, fromBlock: from, toBlock: to });
        for (const l of logs as any[]) events.push({ block: l.blockNumber, tx: l.transactionHash, event: l.eventName, args: l.args });
      }
    } catch {
      fengce = null; // the guard is not a FengceGuard
    }
  }
  return plain({
    safe: getAddress(safe),
    version,
    owners,
    threshold,
    nonce,
    modules: modules[0],
    guard,
    moduleGuard,
    fallbackHandler,
    fengce,
    events,
    eventsWindowBlocks: lookback,
    blockedAttempts:
      "Not observable on chain: a transaction the guard blocks reverts, and a reverted transaction leaves no event. Use the Simulator to see why a transaction would be blocked.",
  });
}

// ------------------------------------------------------------------ catalog

export async function catalog() {
  if (!CATALOG) return plain({ deployed: false, note: "No Fengce Catalog is deployed on X Layer yet (set CATALOG_ADDRESS when one is).", entries: [], known: PRESETS.map((p) => ({ key: p.key, name: p.name, processor: p.processor, id: p.id, stateful: !!p.stateful })) });
  const entries = await readCatalog(client as any, CATALOG);
  return plain({ deployed: true, address: CATALOG, entries, known: PRESETS.map((p) => ({ key: p.key, name: p.name, processor: p.processor, id: p.id, stateful: !!p.stateful })) });
}

// ------------------------------------------------------------------ install

const erc20 = parseAbi(["function allowance(address,address) view returns (uint256)", "function isApprovedForAll(address,address) view returns (bool)"]);
const permit2Abi = parseAbi(["function allowance(address,address,address) view returns (uint160,uint48,uint48)"]);

/**
 * Preflight states per (token, spender, check): "checked" (read, nothing found), "found" (an approval
 * exists), "not checked" (the read failed: the token has no such function or the call reverted), "kept"
 * (found, and the user chose to keep it: configure then needs acceptExistingApprovals).
 */
export async function install(req: {
  safe: Address;
  guard?: Address;
  pinId: Hex;
  preset: string;
  cap?: string;
  tokens: Address[];
  spenders: Address[];
  keep?: string[];
  recoveryDelay?: string;
  recoveryWindow?: string;
  adminDelay?: string;
}) {
  const p = PRESETS.find((x) => x.key === req.preset);
  if (!p) throw new Error(`unknown preset ${req.preset}`);
  const spenders = [...new Set([...req.spenders, ADDR.permit2].map((a) => getAddress(a)))];
  const keep = new Set((req.keep ?? []).map((k) => k.toLowerCase()));
  const rows: { token: Address; spender: Address; check: string; state: string; amount: string | null }[] = [];
  for (const token of req.tokens.map((t) => getAddress(t))) {
    for (const spender of spenders) {
      const key = `${token}:${spender}`.toLowerCase();
      const push = (check: string, amount: bigint | null, failed = false) => {
        const found = amount !== null && amount > 0n;
        rows.push({ token, spender, check, amount: amount === null ? null : amount.toString(), state: failed ? "not checked" : found ? (keep.has(key) ? "kept" : "found") : "checked" });
      };
      try {
        push("ERC-20 allowance", await client.readContract({ address: token, abi: erc20, functionName: "allowance", args: [req.safe, spender] }));
      } catch {
        push("ERC-20 allowance", null, true);
      }
      try {
        const [amt, exp] = await client.readContract({ address: ADDR.permit2, abi: permit2Abi, functionName: "allowance", args: [req.safe, token, spender] });
        push("Permit2 allowance", BigInt(exp) >= BigInt(Math.floor(Date.now() / 1000)) ? amt : 0n);
      } catch {
        push("Permit2 allowance", null, true);
      }
      try {
        push("isApprovedForAll", (await client.readContract({ address: token, abi: erc20, functionName: "isApprovedForAll", args: [req.safe, spender] })) ? 1n : 0n);
      } catch {
        push("isApprovedForAll", null, true);
      }
    }
  }
  const unresolved = rows.filter((r) => r.state === "found");
  const kept = rows.filter((r) => r.state === "kept");
  let builder: unknown = null;
  let error: string | null = null;
  if (unresolved.length === 0) {
    try {
      const schema = await presetSchema(p, BigInt(req.cap ?? "100"));
      const { calls } = await buildInstall(client as any, {
        safe: req.safe,
        guard: req.guard ?? ADDR.predictedGuard,
        pinId: req.pinId,
        schema,
        recoveryDelay: BigInt(req.recoveryDelay ?? "172800"),
        recoveryWindow: BigInt(req.recoveryWindow ?? "172800"),
        adminDelay: BigInt(req.adminDelay ?? "86400"),
        preflightTokens: req.tokens,
        preflightSpenders: req.spenders,
        acceptExistingApprovals: kept.length > 0,
      });
      builder = {
        version: "1.0",
        chainId: "196",
        createdAt: Date.now(),
        meta: { name: "Install Fengce", description: `Policy ${p.name}; ${calls.length} transactions in order.`, txBuilderVersion: "1.16.5" },
        transactions: calls.map((c) => ({ to: c.to, value: c.value.toString(), data: c.data, contractMethod: null, contractInputsValues: null })),
      };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  } else {
    error = `${unresolved.length} existing approval(s) found. Revoke them, or mark them "kept" to install anyway (configure then emits a warning per approval).`;
  }
  return plain({ preflight: rows, transactionBuilder: builder, guardNote: req.guard ? null : "Guard address is the predicted CREATE2 address; FengceGuard is not deployed on X Layer yet.", error });
}

export { PRESETS };
