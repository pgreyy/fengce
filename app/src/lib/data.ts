import {
  type Address,
  type Hex,
  decodeAbiParameters,
  decodeErrorResult,
  encodeDeployData,
  getAddress,
  hexToBytes,
  keccak256,
  parseAbi,
  parseAbiItem,
  toHex,
  zeroAddress,
} from "viem";
import {
  BINDING_SOURCES,
  FengceGuardArtifact,
  PinRegistryArtifact,
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
import { ADDR, AGENT_EXECUTOR, CATALOG, DEPLOY_BLOCK, IN_BROWSER, LOG_WINDOW, client } from "./chain";
import { quoteFor } from "./quotes";
import { PRESETS, presetFor, type PolicyPreset } from "./policies";

const cpuAbi = parseAbi([
  "function step(uint256,bytes,bytes) view returns (bytes,bytes)",
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

export function bits(hex: Hex, n: number): string {
  const b = hexToBytes(hex);
  let s = "";
  for (let i = 0; i < n; i++) s += (b[i >> 3] >> (i & 7)) & 1 ? "1" : "0";
  return s; // bit 0 first
}

// ------------------------------------------------------------------ event scans

export interface ScanRange {
  /** first block looked at */
  from: string;
  /** last block looked at (the head when the scan started) */
  to: string;
  /** number of eth_getLogs requests (100-block windows) */
  windows: number;
  /** true when the scan reached the floor (the v2 deploy block or block 0) */
  complete: boolean;
}

/**
 * Scans logs backwards from `head` in 100-block windows (the X Layer RPC limit), at most `maxWindows` windows and
 * never below `floor`. Five windows are requested at a time in the browser, two on the server.
 */
export async function scanLogs<T>(
  fetchWindow: (from: bigint, to: bigint) => Promise<T[]>,
  head: bigint,
  maxWindows: number,
  floor: bigint = DEPLOY_BLOCK,
): Promise<{ items: T[]; range: ScanRange }> {
  const windows: [bigint, bigint][] = [];
  for (let to = head; to >= floor && windows.length < maxWindows; to -= LOG_WINDOW) {
    const from = to - LOG_WINDOW + 1n > floor ? to - LOG_WINDOW + 1n : floor;
    windows.push([from, to]);
  }
  const items: T[] = [];
  const parallel = IN_BROWSER ? 5 : 2;
  for (let i = 0; i < windows.length; i += parallel) {
    const got = await Promise.all(windows.slice(i, i + parallel).map(([f, t]) => fetchWindow(f, t)));
    for (const g of got) items.push(...g);
  }
  const last = windows[windows.length - 1];
  return {
    items,
    range: { from: (last ? last[0] : head).toString(), to: head.toString(), windows: windows.length, complete: !last || last[0] <= floor },
  };
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
  const vectors: { input: Hex; state: Hex | null; inputBits: string; output: Hex | null; outputBits: string | null; expected: string; decision: string; reason: string }[] = [];
  if (nState === 0) {
    const zero = toHex(new Uint8Array(Math.ceil(nIn / 8)));
    try {
      const g = await client.estimateContractGas({ address: processor, abi: cpuAbi, functionName: "eval", args: [id, zero] });
      evalGas = g.toString();
      tier = tierFor(g);
    } catch {
      /* not estimable */
    }
  }
  const presetVectors = preset?.vectors ?? [];
  const inputs =
    presetVectors.length ? presetVectors
      : nState === 0 && nIn <= 4 ? [...Array(1 << nIn).keys()].map((x) => ({ input: toHex(new Uint8Array([x])), state: undefined, decision: "", reason: "" }))
      : [];
  for (const v of inputs) {
    let out: Hex | null = null;
    try {
      out = nState === 0
        ? await client.readContract({ address: processor, abi: cpuAbi, functionName: "eval", args: [id, v.input] })
        : (await client.readContract({ address: processor, abi: cpuAbi, functionName: "step", args: [id, v.state ?? "0x00", v.input] }))[1];
    } catch {
      out = null;
    }
    const bit0 = out ? (parseInt(out.slice(2, 4), 16) & 1) === 1 : null;
    vectors.push({
      input: v.input,
      state: v.state ?? null,
      inputBits: bits(v.input, nIn),
      output: out,
      outputBits: out ? bits(out, nOut) : null,
      expected: v.decision,
      decision: bit0 === null ? "reverted" : bit0 ? "allow" : "deny",
      reason: v.reason,
    });
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
    tierNote: "eval gas: eth_estimateGas of eval on zero input (the circuit evaluation only, not the full Safe path).",
    name: preset?.name ?? null,
    description: preset?.description ?? null,
    construction: preset?.construction ?? null,
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
  if (!schema.bindings?.length) throw new Error(`policy ${p.name} has no bindings, so a transaction cannot be mapped to its inputs`);
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

export async function safeStatus(safe: Address, maxWindows = 20, floor: bigint = DEPLOY_BLOCK) {
  const head = await client.getBlockNumber();
  const [version, owners, threshold, nonce, modules] = await Promise.all([
    client.readContract({ address: safe, abi: safeAbi, functionName: "VERSION" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "getThreshold" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "nonce" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "getModulesPaginated", args: ["0x0000000000000000000000000000000000000001", 50n] }),
  ]);
  const [guard, moduleGuard, fallbackHandler] = await Promise.all([slot(safe, SLOTS.guard), slot(safe, SLOTS.moduleGuard), slot(safe, SLOTS.fallbackHandler)]);
  let fengce: unknown = null;
  let events: unknown[] = [];
  let eventsRange: ScanRange | null = null;
  if (guard !== zeroAddress) {
    try {
      const cfg = await client.readContract({ address: guard, abi: FengceGuardArtifact.abi as any, functionName: "configOf", args: [safe] });
      const [readyAt, expiresAt] = await Promise.all([
        client.readContract({ address: guard, abi: FengceGuardArtifact.abi as any, functionName: "recoveryReadyAt", args: [safe] }),
        client.readContract({ address: guard, abi: FengceGuardArtifact.abi as any, functionName: "recoveryExpiresAt", args: [safe] }),
      ]);
      const [set, pinId, recoveryDelay, recoveryWindow, adminDelay, tick, tickGroup] = cfg as any[];
      fengce = { set, pinId, recoveryDelay, recoveryWindow, adminDelay, tick, tickGroup, recovery: { readyAt, expiresAt } };
      const scan = await scanLogs(
        async (fromBlock, toBlock) =>
          ((await client.getLogs({ address: guard, events: GUARD_EVENTS.map((e) => parseAbiItem(e)) as any, args: { safe } as any, fromBlock, toBlock })) as any[]).map(
            (l) => ({ block: l.blockNumber, tx: l.transactionHash, event: l.eventName, args: l.args }),
          ),
        head,
        maxWindows,
        floor,
      );
      events = scan.items;
      eventsRange = scan.range;
    } catch {
      fengce = null; // the guard is not a FengceGuard
    }
  }
  // Blocked agent attempts: AgentExecutor emits Denied instead of reverting.
  let denied: unknown[] = [];
  let deniedRange: ScanRange | null = null;
  if (AGENT_EXECUTOR) {
    const ev = parseAbiItem("event Denied(address indexed safe, address indexed agent, address target, bytes32 factsHash, bytes reason)");
    const scan = await scanLogs(async (fromBlock, toBlock) => {
      const out: unknown[] = [];
      const logs = await client.getLogs({ address: AGENT_EXECUTOR, event: ev, args: { safe }, fromBlock, toBlock });
      for (const l of logs as any[]) {
        let reason: string = l.args.reason;
        try {
          const d = decodeErrorResult({ abi: FengceGuardArtifact.abi as unknown as any[], data: l.args.reason });
          reason = `${d.errorName}(${(d.args ?? []).map(String).join(", ")})`;
        } catch {
          /* keep raw */
        }
        out.push({ block: l.blockNumber, tx: l.transactionHash, agent: l.args.agent, target: l.args.target, factsHash: l.args.factsHash, reason });
      }
      return out;
    }, head, maxWindows, floor);
    denied = scan.items;
    deniedRange = scan.range;
  }
  return plain({
    safe: getAddress(safe),
    agentExecutor: AGENT_EXECUTOR,
    deniedAgentCalls: denied,
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
    eventsRange,
    deniedRange,
    head,
    blockedAttemptsNote: null,
    blockedAttempts:
      "Owner transactions the guard blocks revert and leave no event; use the Simulator to see why one would be blocked. Agent calls through AgentExecutor are recorded as Denied events (below).",
  });
}

// ------------------------------------------------------------------ catalog

export async function catalog() {
  if (!CATALOG) return plain({ deployed: false, note: "No Fengce Catalog is deployed on X Layer yet (set CATALOG_ADDRESS when one is).", entries: [], known: PRESETS.map((p) => ({ key: p.key, name: p.name, processor: p.processor, id: p.id, stateful: !!p.stateful })) });
  const head = await client.getBlockNumber();
  const entries = await readCatalog(client as any, CATALOG);
  const pins = await Promise.all(
    entries.map((e) => client.readContract({ address: ADDR.pinRegistry, abi: PinRegistryArtifact.abi as any, functionName: "circuitPin", args: [e.pinId] }) as Promise<any>),
  );
  const installs = await installCounts(head);
  const rows = entries.map((e, i) => {
    const processor = getAddress(pins[i].processor) as Address;
    const id = BigInt(pins[i].circuitId);
    const preset = presetFor(processor, id);
    const q = quoteFor(processor, id);
    const key = e.pinId.toLowerCase();
    return {
      ...e,
      processor,
      circuitId: id,
      gateCount: Number(pins[i].gateCount),
      name: preset?.name ?? null,
      fullPathGas: q?.fullPath ?? null,
      quoteEvalGas: q?.evalCall ?? null,
      installs: installs.byPin.get(key) ?? 0,
    };
  });
  return plain({ deployed: true, address: CATALOG, head, entries: rows, installsRange: installs.range, known: PRESETS.map((p) => ({ key: p.key, name: p.name, processor: p.processor, id: p.id, stateful: !!p.stateful })) });
}

/** Installs per pin: FengceGuard Configured(safe, pinId) events of the v2 guard, scanned from the head down to the
 * v2 deploy block (at most `maxWindows` 100-block windows). */
export async function installCounts(head: bigint, maxWindows = 60) {
  const ev = parseAbiItem("event Configured(address indexed safe, bytes32 indexed pinId)");
  const scan = await scanLogs(
    async (fromBlock, toBlock) => ((await client.getLogs({ address: ADDR.guard, event: ev, fromBlock, toBlock })) as any[]).map((l) => l.args.pinId as Hex),
    head,
    maxWindows,
  );
  const byPin = new Map<string, number>();
  for (const p of scan.items) byPin.set(p.toLowerCase(), (byPin.get(p.toLowerCase()) ?? 0) + 1);
  return { byPin, range: scan.range };
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
        guard: req.guard ?? ADDR.guard,
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
  return plain({ preflight: rows, transactionBuilder: builder, guardNote: req.guard ? null : `Guard: the FengceGuard deployed on X Layer (${ADDR.guard}).`, error });
}

export { PRESETS };
