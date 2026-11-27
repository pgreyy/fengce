# Fengce MCP server

A Model Context Protocol server that lets an AI agent check transactions with Fengce before acting. It reads X Layer
mainnet (chain 196; guard v2 and guard v3 Safes) through the public RPCs. Every tool is read-only except `pay_through_safe`, which sends only when you choose a signer. `build_install_payload` returns an unsigned Safe Transaction Builder payload for the Safe's owners to review and sign.

## Tools

| Tool | What it returns |
|---|---|
| `list_policies` | Every policy in the Fengce Catalog: key, name, what it enforces, pin id, processor and circuit, tier, eval gas, full Safe path gas, installs |
| `get_policy` | One policy's circuit: description, construction, sizes, hashes, dependency tree, allow and deny vectors evaluated on chain now |
| `quote_policy` | Gas and tier from the stored Quote certificate, or a live eval-gas estimate (labelled as evaluation only) |
| `simulate_transaction` | A transaction through a listed policy with a cap you choose, in one `eth_call`: facts, input bits, output, ALLOWED or DENIED. A simulation, not enforcement |
| `preflight_transaction` | A transaction against the policy actually installed on a Safe (its own circuit and bindings, through `FengceGuard.checkContext`): allow, deny (final: the wallet will refuse it) or not enforced |
| `build_install_payload` | Approval preflight for a Safe and, if clean, the unsigned Transaction Builder payload (configure, setGuard, setModuleGuard) |
| `check` | Would this Safe allow this transaction? Runs the Safe's own guard (v2 or v3) as at execution, in an eth_call: allowed, or the reason code (CIRCUIT, TRADES_PER_HOUR, QUIET_HOURS, HOLD_LOCK, TILT_SHIELD, AGENT_CAP, OTHER). With `agent`, the AgentExecutorV3 path: the agent must be active and its daily cap applies |
| `explain_refusal` | The same check, explained: which rule, the numbers involved, and which limit to change or when it resets |
| `pay_through_safe` | An agent key pays from the Safe through AgentExecutorV3. Checks first and never sends a refused payment. `signer`: `none` (default, returns the unsigned call), `onchainos` (the OKX Agentic Wallet CLI, logged in) or `key` (`FENGCE_AGENT_PRIVATE_KEY` in the server's environment; never printed) |

Transactions can be given raw (`to`, `value`, `data`) or as an ERC-20 transfer (`token`, `recipient`, `amount` in base
units; USDT0 has 6 decimals, so 1.5 USDT0 is `"1500000"`). Errors say what to change, for example an unknown policy lists
the valid ones.

**How an agent should use it.** Before acting for a Safe, call `preflight_transaction`. If the decision is `deny`, the
wallet will refuse the transaction: treat it as final, do not split it, reroute it or retry it, and tell the user. The
same rule is in the server's instructions and in the OnchainOS skill ([skills/fengce](../skills/fengce/SKILL.md)).

## Build

```sh
cd sdk && npm ci && cd ../app && npm ci && cd ../mcp && npm ci && npm run build   # writes mcp/dist/server.mjs
```

The server is one file, `mcp/dist/server.mjs`, run with Node 20 or later. `XLAYER_RPC` replaces the public RPCs (for
example a local fork).

## Setup

The package is `@fengce/mcp` on npm; `npx -y @fengce/mcp` starts the server over stdio (Node 20 or later). Nothing else to
install: the server is one self-contained file.

**Claude Desktop** (`claude_desktop_config.json`: Settings, Developer, Edit Config) or **Cursor** (`.cursor/mcp.json`):

```json
{ "mcpServers": { "fengce": { "command": "npx", "args": ["-y", "@fengce/mcp"] } } }
```

**Claude Code**

```sh
claude mcp add fengce -- npx -y @fengce/mcp
```

Environment (optional): `XLAYER_RPC` replaces the public RPCs (for example a local fork); `FENGCE_AGENT_PRIVATE_KEY` lets
`pay_through_safe` sign with `signer: "key"` (it is never printed); `ONCHAINOS_BIN` points to the onchainos CLI for
`signer: "onchainos"`.

From a clone instead of npm: `node /absolute/path/to/fengce/mcp/dist/server.mjs` after the build below.

## Checks

```sh
npm run check:live   # calls every tool once over stdio against live X Layer (read-only)
npx tsx scripts/agent-tools-run.mts          # check, explain_refusal, pay_through_safe (unsigned) on the demo Safe
npx tsx scripts/agent-tools-run.mts --send   # same, and pay_through_safe sends 0.05 USDT0 with onchainos
npm run demo         # fork-only demo: needs anvil; writes docs/demo/agent-demo-transcript.md
```

The demo starts a local anvil fork of X Layer, points the server at it, asks `simulate_transaction` about 1.5 and 0.5
USDT0 from the v2 demo Safe (DENIED, ALLOWED), then submits both through AgentExecutor as the impersonated demo agent: the
wallet refuses the first (`Denied`, `FengceDenied`) and executes the second. Nothing is sent to the real chain.
