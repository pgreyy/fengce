## Overview

Fengce makes a smart wallet on X Layer (chain 196) run every transaction through a TapeOut circuit before it executes: a
spending limit, a budget per period, allowed recipients or tokens, approval limits or trading rules. This skill teaches an
AI agent to ask Fengce first, before it prepares, signs or sends a transaction from a wallet that uses Fengce, and to stop
when Fengce says the transaction is denied. The skill is read-only: it calls Fengce's public API and never signs or sends.

Tags: `x-layer` `safe` `policy` `spending-limit` `ai-agent`

## Prerequisites

- Network access to `https://getfengce.vercel.app` (public, no key).
- The address of the Safe the agent acts for, and the transaction (target, value, calldata, or token, recipient and amount).
- `curl` and `jq` (or any HTTP client).

## Quick Start

1. Read this skill's `SKILL.md`.
2. Before acting, `POST https://getfengce.vercel.app/api/preflight` with `{ "safe", "to", "value", "data" }`.
3. If `decision` is `deny`, stop: report the reason to the user and do not split, reroute or retry the transaction.
4. If `decision` is `allow`, continue with the normal signing flow; the wallet checks again at execution.
