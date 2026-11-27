// Fengce MCP server (stdio). Read-only and unsigned: every tool reads X Layer mainnet (chain 196) through public RPCs;
// nothing is signed or sent. build_install_payload returns an unsigned Safe Transaction Builder payload.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { encodeFunctionData, getAddress, isAddress, parseAbi, toHex, type Address, type Hex } from "viem";
import { z } from "zod";
import { PinRegistryArtifact, processorAbi, tierFor } from "@fengce/sdk";
import { ADDR, DEPLOYMENT, client, friendlyError } from "../../app/src/lib/chain";
import { catalog, circuit, install, preflight, simulate } from "../../app/src/lib/data";
import { PRESETS } from "../../app/src/lib/policies";
import { quoteFor } from "../../app/src/lib/quotes";
import type { Snapshot } from "../../app/src/lib/events";
import snapshotJson from "../../app/public/events-snapshot.json";
import { AGENT_EXECUTOR_V3, decide, explain, outcome, payCall, send } from "./agentTools";

const VERSION = "0.2.0";
const snapshot = snapshotJson as unknown as Snapshot;

// ---------------------------------------------------------------- input pieces

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address");
const uint = z.string().regex(/^[0-9]+$/, "must be a whole number written in decimal digits, for example \"1500000\"");
const hex = z.string().regex(/^0x([0-9a-fA-F]{2})*$/, "must be 0x-prefixed hex with an even number of digits");
const policyKey = z
  .string()
  .describe(`A policy: one of ${PRESETS.map((p) => `"${p.key}" (${p.name})`).join(", ")}. Names are accepted too.`);

/** A transaction, either raw (to, value, data) or as an ERC-20 transfer (token, recipient, amount). */
const txShape = {
  to: address.optional().describe("Raw call: the contract or account called. Leave empty when you give token, recipient and amount."),
  value: uint.optional().describe("Raw call: native OKB value in wei (default 0)."),
  data: hex.optional().describe("Raw call: calldata (default 0x, a plain transfer)."),
  token: address.optional().describe("ERC-20 transfer shortcut: the token, for example USDT0 0x779Ded0c9e1022225f8E0630b35a9b54bE713736."),
  recipient: address.optional().describe("ERC-20 transfer shortcut: who receives the tokens."),
  amount: uint.optional().describe("ERC-20 transfer shortcut: amount in the token's base units (USDT0 has 6 decimals: 1.5 USDT0 = \"1500000\")."),
};
type TxIn = { to?: string; value?: string; data?: string; token?: string; recipient?: string; amount?: string };

const transferAbi = parseAbi(["function transfer(address,uint256)"]);
function toTx(i: TxIn): { to: Address; value: string; data: Hex } {
  if (i.token || i.recipient || i.amount) {
    if (!i.token || !i.recipient || !i.amount) throw new Fix("For an ERC-20 transfer give all three of token, recipient and amount.");
    return { to: getAddress(i.token), value: "0", data: encodeFunctionData({ abi: transferAbi, functionName: "transfer", args: [getAddress(i.recipient), BigInt(i.amount)] }) };
  }
  if (!i.to) throw new Fix("Give either to (with optional value and data) or token, recipient and amount.");
  return { to: getAddress(i.to), value: i.value ?? "0", data: (i.data ?? "0x") as Hex };
}

function presetKey(k: string): string {
  const p = PRESETS.find((x) => x.key === k || x.name.toLowerCase() === k.toLowerCase());
  if (!p) throw new Fix(`Unknown policy "${k}". Use one of: ${PRESETS.map((x) => `${x.key} (${x.name})`).join("; ")}. list_policies shows them.`);
  return p.key;
}

/** An error whose message tells the caller what to change. */
class Fix extends Error {}

// ---------------------------------------------------------------- results

function ok(summary: string, data: unknown) {
  return { content: [{ type: "text" as const, text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data as Record<string, unknown> };
}

function fail(e: unknown) {
  const msg = e instanceof Fix ? e.message : friendlyError(e);
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${msg}` }] };
}

function guarded<A>(fn: (a: A) => Promise<ReturnType<typeof ok>>) {
  return async (a: A) => {
    try {
      return await fn(a);
    } catch (e) {
      return fail(e);
    }
  };
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

// ---------------------------------------------------------------- server

const server = new McpServer(
  { name: "fengce", version: VERSION },
  {
    instructions:
      "Fengce enforces spending policies inside smart wallets on X Layer (chain 196): a TapeOut circuit decides every transaction. " +
      "Before acting for a Safe, call check (or preflight_transaction); if it is refused, the wallet will refuse the transaction: treat it as final, " +
      "call explain_refusal to tell the user why and what limit would have to change, and " +
      "do not split, reroute or retry it, and tell the user. simulate_transaction tests a listed policy on any transaction. " +
      "Every tool is read-only; build_install_payload returns an unsigned payload for the Safe's owners to review and sign.",
  },
);

server.registerTool(
  "list_policies",
  {
    title: "List Fengce policies",
    description:
      "Lists every policy in the Fengce Catalog on X Layer mainnet: name, what it enforces, pin id, processor and circuit, tier, " +
      "eval gas measured on chain, full Safe path gas from its Quote certificate, and installs (distinct Safes configured with it). " +
      "Use the key, or processor and circuitId, with the other tools.",
    inputSchema: {},
    annotations: { title: "List Fengce policies", ...READ_ONLY },
  },
  guarded(async () => {
    const c: any = await catalog(snapshot);
    const policies = c.entries.map((e: any) => {
      const p = PRESETS.find((x) => x.processor.toLowerCase() === e.processor.toLowerCase() && x.id.toString() === e.circuitId);
      return {
        key: p?.key ?? null,
        name: e.name,
        enforces: p?.description ?? e.description,
        pinId: e.pinId,
        processor: e.processor,
        circuitId: e.circuitId,
        tier: e.tier,
        evalGas: e.measuredGas,
        fullSafePathGas: e.fullPathGas,
        gates: e.gateCount,
        installs: e.installs,
        designer: e.designer,
        stateful: !!p?.stateful,
      };
    });
    return ok(`${policies.length} policies in the Fengce Catalog (${c.address}) at block ${c.head}.`, { catalog: c.address, block: c.head, policies, eventHistory: c.history });
  }),
);

server.registerTool(
  "get_policy",
  {
    title: "Get one policy",
    description:
      "One policy's circuit in detail: description, construction, input and output sizes, gate count, netlist and REF-closure hashes, " +
      "dependency tree, and its allow and deny test vectors evaluated on chain right now. Identify it by key, or by processor and circuitId, or by pinId.",
    inputSchema: {
      key: z.string().optional().describe("Policy key or name from list_policies, for example \"nand-limit\"."),
      processor: address.optional().describe("TapeOut processor address (with circuitId)."),
      circuitId: uint.optional().describe("Circuit id on that processor."),
      pinId: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte 0x-prefixed hex pin id").optional().describe("Pin id from list_policies."),
    },
    annotations: { title: "Get one policy", ...READ_ONLY },
  },
  guarded(async (a: { key?: string; processor?: string; circuitId?: string; pinId?: string }) => {
    const [proc, id] = await resolveCircuit(a);
    const c = await circuit(proc, id);
    return ok(`${c.name ?? `Circuit #${id}`} on ${proc}: ${c.gateCount} gates, ${c.vectors.length} vectors evaluated at block ${c.block}.`, c);
  }),
);

server.registerTool(
  "quote_policy",
  {
    title: "Quote a policy's gas and tier",
    description:
      "Gas and tier for a policy. Returns its stored Quote certificate when there is one (Safe overhead, pre-check, outcome check, " +
      "full Safe path; Green up to 1,000,000 gas, Amber up to 3,500,000, Red above). Otherwise estimates the circuit's eval gas live " +
      "(evaluation only, not the full Safe path) and says so.",
    inputSchema: {
      key: z.string().optional().describe("Policy key or name from list_policies."),
      processor: address.optional().describe("TapeOut processor address (with circuitId)."),
      circuitId: uint.optional().describe("Circuit id on that processor."),
    },
    annotations: { title: "Quote a policy's gas and tier", ...READ_ONLY },
  },
  guarded(async (a: { key?: string; processor?: string; circuitId?: string }) => {
    const [proc, id] = await resolveCircuit(a);
    const q = quoteFor(proc, id);
    if (q) {
      return ok(`Quote certificate for #${id} on ${proc}: tier ${q.tier}, full Safe path ${q.fullPath ?? "n/a"} gas.`, {
        source: "Quote certificate (sdk/quotes), measured with eth_estimateGas on a fork of X Layer",
        processor: proc,
        circuitId: id.toString(),
        ...q,
      });
    }
    const [nIn, , nState] = (await client.readContract({ address: proc, abi: processorAbi, functionName: "circuitInfo", args: [id] })) as readonly [number, number, number, number];
    if (nState > 0) throw new Fix(`Circuit #${id} is stateful (it has a LATCH); its gas depends on Tick and it has no stored Quote. Use the Quote CLI (sdk) for it.`);
    const gas = await client.estimateContractGas({ address: proc, abi: processorAbi, functionName: "eval", args: [id, toHex(new Uint8Array(Math.ceil(nIn / 8)))] });
    return ok(`No stored Quote for #${id}; live eval gas ${gas} (evaluation only), tier ${tierFor(gas)} by that figure.`, {
      source: "live eth_estimateGas of eval on zero input: the circuit evaluation only, not the full Safe path",
      processor: proc,
      circuitId: id.toString(),
      evalGas: gas.toString(),
      tier: tierFor(gas),
      fullSafePath: null,
      note: "For the full Safe path (overhead, pre-check, outcome check) run the Quote CLI: npx fengce-quote <processor> <circuitId>",
    });
  }),
);

server.registerTool(
  "simulate_transaction",
  {
    title: "Simulate a transaction against a policy",
    description:
      "Runs a transaction through one of the listed policies in a single eth_call and returns the decoded facts, the circuit input bits, " +
      "the output and the decision (allow or deny). This tests a policy with a cap you choose; to check what a specific Safe will decide, " +
      "use preflight_transaction. A simulation is not enforcement: only the wallet enforces, when the transaction executes.",
    inputSchema: {
      policy: policyKey,
      cap: uint.optional().describe("Cap for policies with an amount limit, in the token's base units (default 100). The v2 demo Safe uses 1000000 (1 USDT0)."),
      account: address.optional().describe("The account the transaction would come from (default: a placeholder)."),
      ...txShape,
    },
    annotations: { title: "Simulate a transaction against a policy", ...READ_ONLY },
  },
  guarded(async (a: { policy: string; cap?: string; account?: string } & TxIn) => {
    const key = presetKey(a.policy);
    if (PRESETS.find((p) => p.key === key)!.stateful) throw new Fix(`${a.policy} is stateful (a budget per period kept in Tick); it cannot be simulated in one call. Pick a stateless policy.`);
    const tx = toTx(a);
    const r: any = await simulate({ preset: key, cap: a.cap, account: a.account ? getAddress(a.account) : undefined, ...tx });
    const verdict = r.decision === "allow" ? "ALLOWED" : "DENIED";
    return ok(`${verdict} by ${r.policy.name} (cap ${r.policy.cap}): stage ${r.stage}${r.error ? `, ${r.error}` : ""}. Simulation only.`, { ...r, enforcement: "none: simulation by eth_call" });
  }),
);

server.registerTool(
  "preflight_transaction",
  {
    title: "Preflight a transaction for a Safe",
    description:
      "Before signing or sending: checks a transaction against the policy actually installed on a Safe. Reads the Safe's guards and Fengce " +
      "configuration, decodes the transaction into facts and asks the Safe's FengceGuard to evaluate its own pinned circuit with its own " +
      "bindings (view only). decision is allow, deny (the wallet will refuse it: treat as final) or not enforced (no Fengce guard). " +
      "Tick budgets, floors and the outcome check also apply at execution and are not part of this answer.",
    inputSchema: {
      safe: address.describe("The Safe that would execute the transaction."),
      ...txShape,
    },
    annotations: { title: "Preflight a transaction for a Safe", ...READ_ONLY },
  },
  guarded(async (a: { safe: string } & TxIn) => {
    if (!isAddress(a.safe)) throw new Fix("safe must be an address.");
    const tx = toTx(a);
    const r: any = await preflight({ safe: getAddress(a.safe), ...tx });
    const head = r.decision === "allow" ? "ALLOWED" : r.decision === "deny" ? "DENIED (final: the wallet will refuse it)" : "NOT ENFORCED";
    return ok(`${head}: ${r.reason}`, r);
  }),
);

server.registerTool(
  "build_install_payload",
  {
    title: "Build an unsigned Safe install payload",
    description:
      "Prepares installing Fengce on a Safe v1.5.0: checks existing approvals for the given tokens and spenders (Permit2 is always added) " +
      "and, if none is found (or the found ones are listed in keep), returns an unsigned Safe Transaction Builder payload with configure, " +
      "setGuard and setModuleGuard. Nothing is signed or sent: the Safe's owners review and sign it. After install, removing Fengce needs " +
      "every owner and at least a 2-day delay. Try it on a fresh Safe with a few dollars, never a real treasury.",
    inputSchema: {
      safe: address.describe("The Safe v1.5.0 to install on (it must have no modules enabled)."),
      policy: policyKey,
      cap: uint.optional().describe("Cap in the token's base units (default 100). USDT0 has 6 decimals: 1 USDT0 = \"1000000\"."),
      tokens: z.array(address).min(1).describe("Tokens whose existing approvals to check, for example [USDT0]."),
      spenders: z.array(address).default([]).describe("Spenders to check (routers, protocols). Permit2 is added automatically."),
      keep: z.array(z.string()).optional().describe("\"token:spender\" pairs whose existing approval you accept keeping."),
      recoveryDelay: uint.optional().describe("Seconds before a recovery (removal) can execute; at least 172800 (2 days). Default 172800."),
      recoveryWindow: uint.optional().describe("Seconds a scheduled recovery stays executable; at least 172800. Default 172800."),
      adminDelay: uint.optional().describe("Seconds every policy or module change waits; at least 86400 (1 day). Default 86400."),
    },
    annotations: { title: "Build an unsigned Safe install payload", ...READ_ONLY },
  },
  guarded(async (a: any) => {
    const key = presetKey(a.policy);
    const pinKey = { "nand-limit": "stablecoinTransferLimit", comparator16: "numericTransactionLimit", "policy-floor": "organizationWidePolicyFloor", "toggle-cap": "periodicSpendingBudget", "nor-swap": "protectedSwapPolicy" }[key] as keyof typeof DEPLOYMENT.pins;
    const r: any = await install({
      safe: getAddress(a.safe),
      pinId: DEPLOYMENT.pins[pinKey] as Hex,
      preset: key,
      cap: a.cap,
      tokens: a.tokens.map((t: string) => getAddress(t)),
      spenders: (a.spenders ?? []).map((t: string) => getAddress(t)),
      keep: a.keep,
      recoveryDelay: a.recoveryDelay,
      recoveryWindow: a.recoveryWindow,
      adminDelay: a.adminDelay,
    });
    if (!r.transactionBuilder) {
      throw new Fix(`${r.error ?? "The payload could not be built."} Preflight: ${r.preflight.map((x: any) => `${x.check} ${x.token}/${x.spender}: ${x.state}`).join("; ")}`);
    }
    return ok(
      `Unsigned Safe Transaction Builder payload with ${r.transactionBuilder.transactions.length} transactions for ${a.safe}. Nothing was signed or sent; import it into the Safe Transaction Builder and have the owners review it.`,
      { unsigned: true, guard: ADDR.guard, pinId: DEPLOYMENT.pins[pinKey], ...r },
    );
  }),
);

async function resolveCircuit(a: { key?: string; processor?: string; circuitId?: string; pinId?: string }): Promise<[Address, bigint]> {
  if (a.processor && a.circuitId) return [getAddress(a.processor), BigInt(a.circuitId)];
  if (a.key) {
    const p = PRESETS.find((x) => x.key === presetKey(a.key!))!;
    return [p.processor, p.id];
  }
  if (a.pinId) {
    const pin: any = await client.readContract({ address: ADDR.pinRegistry, abi: PinRegistryArtifact.abi as any, functionName: "circuitPin", args: [a.pinId as Hex] });
    if (BigInt(pin.processor) === 0n) throw new Fix(`No circuit is pinned under ${a.pinId}. Take a pinId from list_policies.`);
    return [getAddress(pin.processor), BigInt(pin.circuitId)];
  }
  throw new Fix("Identify the policy with key, or processor and circuitId, or pinId (all from list_policies).");
}

// ---------------------------------------------------------------- agent tools (guard v2 and v3)

server.registerTool(
  "check",
  {
    title: "Would this Safe allow this transaction?",
    description:
      "Runs the Safe's own guard on the transaction exactly as it would run at execution (eth_call, nothing sent) and returns allowed or refused " +
      "with the reason code (guard v3: CIRCUIT, TRADES_PER_HOUR, QUIET_HOURS, HOLD_LOCK, TILT_SHIELD, AGENT_CAP, OTHER). Give agent to check the " +
      "agent path (AgentExecutorV3: the agent must be active, and its daily cap applies).",
    inputSchema: { safe: address.describe("The Safe on X Layer."), agent: address.optional().describe("Optional: the agent key that would send it through AgentExecutorV3."), ...txShape },
    annotations: READ_ONLY,
  },
  guarded(async (a: TxIn & { safe: string; agent?: string }) => {
    const tx = toTx(a);
    const d = await decide(getAddress(a.safe), { to: tx.to, value: BigInt(tx.value), data: tx.data }, a.agent ? getAddress(a.agent) : undefined);
    const data = { safe: getAddress(a.safe), path: d.path, allowed: d.allowed, reason: d.reason, code: d.code ?? null, guard: d.guard, detail: d.detail ?? null, limit: d.limit?.toString() ?? null, cap: d.cap ?? null };
    return ok(d.allowed ? "ALLOWED: the Safe would let this transaction through." : `REFUSED (${d.reason ?? "refused"}${d.code ? `, code ${d.code}` : ""}): the Safe will refuse it. Treat this as final; call explain_refusal for the reason and what limit to change.`, data);
  }),
);

server.registerTool(
  "explain_refusal",
  {
    title: "Why would the Safe refuse this, and what would have to change?",
    description: "Checks the transaction (as check does) and explains a refusal in plain words: which rule, the numbers involved, and which limit to change or when it resets. Read-only.",
    inputSchema: { safe: address.describe("The Safe on X Layer."), agent: address.optional().describe("Optional: the agent key (AgentExecutorV3 path)."), ...txShape },
    annotations: READ_ONLY,
  },
  guarded(async (a: TxIn & { safe: string; agent?: string }) => {
    const tx = toTx(a);
    const t = { to: tx.to, value: BigInt(tx.value), data: tx.data };
    const safe = getAddress(a.safe) as Address;
    const d = await decide(safe, t, a.agent ? getAddress(a.agent) : undefined);
    const e = await explain(safe, d, t);
    return ok(`${e.reason}\nWhat to change: ${e.change}`, { allowed: d.allowed, reason: d.reason, code: d.code ?? null, explanation: e.reason, change: e.change });
  }),
);

server.registerTool(
  "pay_through_safe",
  {
    title: "Pay from a Safe with an agent key (AgentExecutorV3)",
    description:
      "An agent key pays an ERC-20 amount from the Safe through AgentExecutorV3. It checks first and never sends a payment the Safe would refuse " +
      "(it returns the reason instead). signer: none (default) returns the unsigned call to sign elsewhere; onchainos sends it from the OKX Agentic Wallet " +
      "(onchainos CLI, logged in); key sends it with FENGCE_AGENT_PRIVATE_KEY from the server's environment. The Safe's guard decides again on chain.",
    inputSchema: {
      safe: address.describe("The Safe that pays."),
      agent: address.describe("The agent key, active on AgentExecutorV3 for this Safe."),
      token: address.describe("The token, for example USDT0 0x779Ded0c9e1022225f8E0630b35a9b54bE713736."),
      recipient: address.describe("Who receives it."),
      amount: uint.describe("Amount in base units (USDT0 has 6 decimals: 0.05 USDT0 = \"50000\")."),
      signer: z.enum(["none", "onchainos", "key"]).optional().describe("none (default): return the unsigned call; onchainos or key: send it."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  guarded(async (a: { safe: string; agent: string; token: string; recipient: string; amount: string; signer?: "none" | "onchainos" | "key" }) => {
    const safe = getAddress(a.safe) as Address;
    const agent = getAddress(a.agent) as Address;
    const call = payCall(safe, getAddress(a.token) as Address, getAddress(a.recipient) as Address, BigInt(a.amount));
    const d = await decide(safe, call.inner, agent);
    if (!d.allowed) {
      const e = await explain(safe, d, call.inner);
      return ok(`Not sent: the Safe would refuse it (${d.reason}). ${e.reason} What to change: ${e.change}`, { sent: false, allowed: false, reason: d.reason, code: d.code ?? null, explanation: e.reason, change: e.change });
    }
    const unsigned = { from: agent, to: call.to, data: call.data, value: "0", chainId: 196 };
    if (!a.signer || a.signer === "none")
      return ok(`Allowed. Not sent (signer none): sign this call with the agent key, for example: onchainos wallet contract-call --chain xlayer --to ${call.to} --input-data <data> --from ${agent}`, { sent: false, allowed: true, executor: AGENT_EXECUTOR_V3, unsigned });
    const hash = await send(a.signer, agent, call);
    const o = await outcome(hash);
    return ok(`Sent: ${o.result === "executed" ? "the Safe paid (AgentExecuted)" : o.result === "denied" ? "the guard refused it on chain (Denied); nothing moved" : "see the transaction"}. tx ${hash}`, { sent: true, tx: hash, explorer: `https://www.oklink.com/x-layer/tx/${hash}`, result: o.result, status: o.status });
  }),
);

await server.connect(new StdioServerTransport());
