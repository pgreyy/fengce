# Fengce MCP server

A Model Context Protocol server that lets an AI agent check transactions with Fengce before acting. It reads X Layer
mainnet (chain 196, release v2) through the public RPCs. It is **read-only and unsigned**: no tool signs, sends or holds a
key. `build_install_payload` returns an unsigned Safe Transaction Builder payload for the Safe's owners to review and sign.

## Tools

| Tool | What it returns |
|---|---|
| `list_policies` | Every policy in the Fengce Catalog: key, name, what it enforces, pin id, processor and circuit, tier, eval gas, full Safe path gas, installs |
| `get_policy` | One policy's circuit: description, construction, sizes, hashes, dependency tree, allow and deny vectors evaluated on chain now |
| `quote_policy` | Gas and tier from the stored Quote certificate, or a live eval-gas estimate (labelled as evaluation only) |
| `simulate_transaction` | A transaction through a listed policy with a cap you choose, in one `eth_call`: facts, input bits, output, ALLOWED or DENIED. A simulation, not enforcement |
| `preflight_transaction` | A transaction against the policy actually installed on a Safe (its own circuit and bindings, through `FengceGuard.checkContext`): allow, deny (final: the wallet will refuse it) or not enforced |
| `build_install_payload` | Approval preflight for a Safe and, if clean, the unsigned Transaction Builder payload (configure, setGuard, setModuleGuard) |

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

**Claude Code**

```sh
claude mcp add fengce -- node /absolute/path/to/fengce/mcp/dist/server.mjs
```

**Claude Desktop**: add to `claude_desktop_config.json` (Settings, Developer, Edit Config), then restart:

```json
{
  "mcpServers": {
    "fengce": { "command": "node", "args": ["/absolute/path/to/fengce/mcp/dist/server.mjs"] }
  }
}
```

**Any MCP client**: start `node mcp/dist/server.mjs` as a stdio server. Cursor, for example, takes the same `command` and
`args` in `.cursor/mcp.json`.

## Checks

```sh
npm run check:live   # calls every tool once over stdio against live X Layer (read-only)
npm run demo         # fork-only demo: needs anvil; writes docs/demo/agent-demo-transcript.md
```

The demo starts a local anvil fork of X Layer, points the server at it, asks `simulate_transaction` about 1.5 and 0.5
USDT0 from the v2 demo Safe (DENIED, ALLOWED), then submits both through AgentExecutor as the impersonated demo agent: the
wallet refuses the first (`Denied`, `FengceDenied`) and executes the second. Nothing is sent to the real chain.
