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
import { ADDR, AGENT_EXECUTOR, CATALOG, client } from "./chain";
import { history, installsByPin, type History, type Snapshot } from "./events";
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

// ------------------------------------------------------------------ preflight (the Safe's own policy)

const KINDS = ["Native", "Transfer", "Approval", "Call", "Swap", "Lending"];

/**
 * Checks a transaction against the policy actually installed on a Safe, before anyone signs it: the transaction is
 * decoded into facts (one eth_call, as in simulate) and the Safe's FengceGuard evaluates its own pinned circuit with its
 * own bindings on them (`checkContext`, view only). Tick budgets, floors and the outcome check run only at execution and
 * are not part of this answer. Nothing is signed or sent.
 */
export async function preflight(req: { safe: Address; to: Address; value?: string; data?: Hex }) {
  const safe = getAddress(req.safe);
  let guard: Address, moduleGuard: Address;
  try {
    [guard, moduleGuard] = await Promise.all([slot(safe, SLOTS.guard), slot(safe, SLOTS.moduleGuard)]);
  } catch {
    return plain({ safe, to: getAddress(req.to), enforced: false, decision: "not enforced", reason: "This address is not a Safe (no getStorageAt): Fengce's guard cannot be installed on it.", facts: null, config: null });
  }
  const base = { safe, to: getAddress(req.to), value: req.value ?? "0", data: req.data ?? "0x", guard, moduleGuard };
  const fengceGuard = guard.toLowerCase() === ADDR.guard.toLowerCase();
  const fengceModuleGuard = moduleGuard.toLowerCase() === ADDR.guard.toLowerCase();
  if (!fengceGuard && !fengceModuleGuard) {
    return plain({ ...base, enforced: false, decision: "not enforced", reason: "This Safe does not use the Fengce v2 guard: nothing checks this transaction.", facts: null, config: null });
  }
  const cfg = (await client.readContract({ address: ADDR.guard, abi: FengceGuardArtifact.abi as any, functionName: "configOf", args: [safe] })) as any[];
  const [set, pinId, recoveryDelay, recoveryWindow, adminDelay] = cfg;
  const config = { set, pinId, recoveryDelay, recoveryWindow, adminDelay, transactionGuard: fengceGuard, moduleGuard: fengceModuleGuard };
  if (!set) return plain({ ...base, enforced: true, decision: "deny", reason: "The Safe has the guard but no policy is configured; the guard denies.", facts: null, config });
  // Decode the transaction into facts (the policy itself does not matter for decoding).
  const sim: any = await simulate({ preset: PRESETS[0].key, cap: "0", account: safe, to: req.to, value: req.value, data: req.data });
  if (!sim.facts) {
    return plain({ ...base, enforced: true, decision: "deny", reason: `Fails closed: ${sim.stage}${sim.error ? ` (${sim.error})` : ""}.`, facts: null, config });
  }
  const factsType = (FengceGuardArtifact.abi as unknown as any[]).find((x) => x.name === "checkContext").inputs[1];
  const facts: Record<string, unknown> = {};
  for (const c of factsType.components as { name: string; type: string }[]) {
    const v = sim.facts[c.name];
    facts[c.name] = c.name === "kind" ? KINDS.indexOf(String(v)) : c.type.startsWith("uint") ? BigInt(v) : v;
  }
  facts.account = safe;
  try {
    const [input, output] = (await client.readContract({ address: ADDR.guard, abi: FengceGuardArtifact.abi as any, functionName: "checkContext", args: [safe, facts] })) as [Hex, Hex];
    return plain({ ...base, enforced: true, decision: "allow", reason: "The Safe's pinned circuit allows these facts (output bit 0 = 1).", facts: sim.facts, input, output, config });
  } catch (e: any) {
    // The revert data (for example FengceDenied(safe, target)) is nested somewhere in viem's error chain.
    let reason: string = e?.shortMessage ?? String(e);
    let raw: Hex | null = null;
    for (let x = e, depth = 0; x && depth < 8 && !raw; x = x.cause, depth++) {
      const d = typeof x.data === "string" ? x.data : typeof x.data?.data === "string" ? x.data.data : null;
      if (d && /^0x[0-9a-fA-F]{8,}$/.test(d)) raw = d as Hex;
      else if (x.data?.errorName) reason = `${x.data.errorName}(${(x.data.args ?? []).map(String).join(", ")})`;
    }
    if (raw) {
      try {
        const d = decodeErrorResult({ abi: FengceGuardArtifact.abi as any, data: raw });
        reason = `${d.errorName}(${(d.args ?? []).map(String).join(", ")})`;
      } catch {
        reason = raw;
      }
    }
    return plain({ ...base, enforced: true, decision: "deny", reason, facts: sim.facts, config });
  }
}

// ------------------------------------------------------------------ safes

async function slot(safe: Address, s: bigint): Promise<Address> {
  const raw = await client.readContract({ address: safe, abi: safeAbi, functionName: "getStorageAt", args: [s, 1n] });
  return getAddress(`0x${raw.slice(-40)}`);
}


/** A Safe's configuration and on-chain state (no event scan): what the status view shows at once. */
export async function safeConfig(safe: Address) {
  const [version, owners, threshold, nonce, modules] = await Promise.all([
    client.readContract({ address: safe, abi: safeAbi, functionName: "VERSION" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "getThreshold" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "nonce" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "getModulesPaginated", args: ["0x0000000000000000000000000000000000000001", 50n] }),
  ]);
  const [guard, moduleGuard, fallbackHandler] = await Promise.all([slot(safe, SLOTS.guard), slot(safe, SLOTS.moduleGuard), slot(safe, SLOTS.fallbackHandler)]);
  let fengce: unknown = null;
  if (guard !== zeroAddress) {
    try {
      const cfg = await client.readContract({ address: guard, abi: FengceGuardArtifact.abi as any, functionName: "configOf", args: [safe] });
      const [readyAt, expiresAt] = await Promise.all([
        client.readContract({ address: guard, abi: FengceGuardArtifact.abi as any, functionName: "recoveryReadyAt", args: [safe] }),
        client.readContract({ address: guard, abi: FengceGuardArtifact.abi as any, functionName: "recoveryExpiresAt", args: [safe] }),
      ]);
      const [set, pinId, recoveryDelay, recoveryWindow, adminDelay, tick, tickGroup] = cfg as any[];
      fengce = { set, pinId, recoveryDelay, recoveryWindow, adminDelay, tick, tickGroup, recovery: { readyAt, expiresAt } };
    } catch {
      fengce = null; // the guard is not a FengceGuard
    }
  }
  return plain({
    safe: getAddress(safe),
    agentExecutor: AGENT_EXECUTOR,
    version,
    owners,
    threshold,
    nonce,
    modules: modules[0],
    guard,
    moduleGuard,
    fallbackHandler,
    fengce,
  });
}

/** A Safe's Fengce events from a history (snapshot plus scanned blocks). */
export function safeEvents(safe: Address, h: History) {
  const mine = h.events.filter((e) => e.safe?.toLowerCase() === safe.toLowerCase());
  return {
    deniedAgentCalls: mine.filter((e) => e.source === "agentExecutor" && e.event === "Denied"),
    agentEvents: mine.filter((e) => e.source === "agentExecutor" && e.event !== "Denied"),
    events: mine.filter((e) => e.source === "guard"),
    history: { snapshot: h.snapshot, live: h.live, gap: h.gap, head: h.head, cached: h.cached ?? null },
  };
}

/** Configuration plus events in one answer (the HTTP API). */
export async function safeStatus(safe: Address, snapshot: Snapshot | null = null) {
  const [cfg, h] = await Promise.all([safeConfig(safe), history(snapshot)]);
  return plain({
    ...(cfg as object),
    ...safeEvents(safe, h),
    blockedAttempts:
      "Owner transactions the guard blocks revert and leave no event; use a policy's Try it tab to see why one would be blocked. Agent calls through AgentExecutor are recorded as Denied events.",
  });
}

// ------------------------------------------------------------------ catalog

/** Catalog listings with their pins (no event scan): what the Catalog view shows at once. */
export async function catalogEntries() {
  if (!CATALOG) return plain({ deployed: false, note: "No Fengce Catalog is deployed on X Layer yet (set CATALOG_ADDRESS when one is).", entries: [], known: PRESETS.map((p) => ({ key: p.key, name: p.name, processor: p.processor, id: p.id, stateful: !!p.stateful })) });
  const head = await client.getBlockNumber();
  const entries = await readCatalog(client as any, CATALOG);
  const pins = await Promise.all(
    entries.map((e) => client.readContract({ address: ADDR.pinRegistry, abi: PinRegistryArtifact.abi as any, functionName: "circuitPin", args: [e.pinId] }) as Promise<any>),
  );
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
      key,
    };
  });
  return plain({ deployed: true, address: CATALOG, head, entries: rows, known: PRESETS.map((p) => ({ key: p.key, name: p.name, processor: p.processor, id: p.id, stateful: !!p.stateful })) });
}

/** Installs per listing from a history, or null when no history was read. */
export function catalogInstalls(entries: { key: string }[], h: History | null) {
  const installs = h ? installsByPin(h.events) : null;
  return entries.map((e) => (installs ? (installs.get(e.key) ?? 0) : null));
}

/** Listings plus installs in one answer (the HTTP API). A failed live scan must not hide the Catalog itself. */
export async function catalog(snapshot: Snapshot | null = null) {
  const c = (await catalogEntries()) as any;
  if (!c.deployed) return c;
  const h = await history(snapshot, BigInt(c.head)).catch(() => null);
  const inst = catalogInstalls(c.entries, h);
  return plain({ ...c, entries: c.entries.map((e: any, i: number) => ({ ...e, installs: inst[i] })), history: h ? { snapshot: h.snapshot, live: h.live, gap: h.gap } : null });
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
