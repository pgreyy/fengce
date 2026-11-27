# Plugin Store PR text (not opened: submissions are closed)

**Title:** Add fengce: check a Safe transaction against its on-chain limits before acting

**Plugin:** `fengce` 0.2.0 · source: https://github.com/pgreyy/fengce/tree/main/skills/fengce · MIT

## What it does

Agents that act for a Safe on X Layer ask Fengce before preparing, signing or sending a transaction. The answer comes
from the Safe's own guard (FengceGuard), the same check the Safe runs when the transaction executes: `allowed`, or a
reason code (`MAX_PER_BUY`, `TRADES_PER_HOUR`, `QUIET_HOURS`, `HOLD_LOCK`, `TILT_SHIELD`, `AGENT_CAP`, ...). The skill tells
the agent that a refusal is final: no splitting, rerouting or retrying around it.

## Why it belongs next to the OKX Agentic Wallet

The Agentic Wallet signs. Fengce decides what a Safe may do, on chain, whichever agent or app asks. An agentic wallet set as
the agent key on a Fengce-bound Safe gets each call checked; an over-limit call is recorded as Denied with its reason code.

## Interfaces

- HTTP (read-only): `POST https://getfengce.vercel.app/api/preflight`, `/api/simulate`, `GET /api/catalog`, `/api/safe/<address>`
- SDK: `npm i @fengce/sdk`, `check(client, safe, tx)` (one eth_call, nothing sent)
- Install: `npx skills add pgreyy/fengce --skill fengce`

## Safety

Read-only: the skill never signs, sends or holds keys. No independent security review of the contracts yet.

## Checklist

- [x] `plugin.yaml` (schema_version 1) and `.claude-plugin/plugin.json`
- [x] `SKILL.md` with pre-flight checks, commands, decision rules, examples, error handling, security notices, routing
- [x] Every command works against X Layer mainnet (chain 196)
