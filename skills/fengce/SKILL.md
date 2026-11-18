---
name: fengce
description: "Check a transaction against a wallet's Fengce spending policy on X Layer before acting, and treat Denied as final."
version: "0.1.0"
author: "Fengce"
tags:
  - x-layer
  - safe
  - policy
  - spending-limit
  - ai-agent
---

# Fengce: check before you act

## Overview

Fengce is a wallet enforcement layer on X Layer (chain 196). A Safe that uses Fengce runs every transaction, from its
owners or from an agent, through a TapeOut circuit before it executes; if the circuit says no, the wallet refuses it.
This skill makes the agent ask Fengce **before** preparing, signing or sending a transaction, so it never builds a
transaction the wallet will refuse, and so the user hears about a refusal in plain words. Read-only: nothing is signed
or sent by this skill.

## Pre-flight Checks

Before using this skill, ensure:

1. You know the Safe address you act for and the exact transaction (target, value in wei, calldata), or, for an ERC-20
   transfer, the token, the recipient and the amount in base units (USDT0 has 6 decimals: 1.5 USDT0 = 1500000).
2. `https://getfengce.vercel.app` is reachable. If it is not, do not assume the transaction is allowed: tell the user the
   check could not be made.

## Commands

### Preflight a transaction for a Safe (always first)

```bash
curl -s -X POST https://getfengce.vercel.app/api/preflight \
  -H 'content-type: application/json' \
  -d '{"safe":"<SAFE>","to":"<TARGET>","value":"<WEI>","data":"<CALLDATA>"}' | jq '{decision, reason, enforced}'
```

**When to use**: before every transaction you would prepare, sign or send for a Safe.
**Output**: `decision` is `allow`, `deny` or `not enforced`; `reason` explains it (for a denial, for example
`FengceDenied(safe, target)`); `config` shows the Safe's policy pin and timelocks. It evaluates the policy actually
installed on that Safe (its own circuit and values). Budgets per period, organisation floors and the outcome check also
apply when the transaction executes.
**Example** (1.5 USDT0 from the demo Safe, over its 1 USDT0 cap):

```bash
DATA=0xa9059cbb0000000000000000000000006eac9821430aca193a717a7c17d68f8033d46087000000000000000000000000000000000000000000000000000000000016e360
curl -s -X POST https://getfengce.vercel.app/api/preflight -H 'content-type: application/json' \
  -d "{\"safe\":\"0x0bb926DC7F79e4CEFFB30a67E8291C56C3F50707\",\"to\":\"0x779Ded0c9e1022225f8E0630b35a9b54bE713736\",\"data\":\"$DATA\"}" | jq .decision
# "deny"
```

### Simulate a transaction against a listed policy

```bash
curl -s -X POST https://getfengce.vercel.app/api/simulate -H 'content-type: application/json' \
  -d '{"preset":"nand-limit","cap":"1000000","to":"<TARGET>","value":"0","data":"<CALLDATA>"}' | jq '{decision, stage}'
```

**When to use**: to explain or compare policies (for example before the user installs one). Not for deciding what a
specific Safe will do: use preflight for that. A simulation is not enforcement.

### List policies and read a Safe

```bash
curl -s https://getfengce.vercel.app/api/catalog | jq '.entries[] | {name, tier, installs, fullPathGas}'
curl -s https://getfengce.vercel.app/api/safe/<SAFE> | jq '{guard, moduleGuard, fengce, denied: (.deniedAgentCalls | length)}'
```

**When to use**: when the user asks which policies exist, or what a Safe's guards, timelocks and past denials are.

## Decision rules

1. `deny` is **final**. The wallet will refuse the transaction. Do not split it into smaller transactions, route it
   through another contract or token, change the recipient to get around the rule, or retry it later hoping for a different
   answer. Tell the user what was denied and the reason.
2. Never try to change, pause or remove the policy or the guard to make a transaction pass. Those changes are timelocked
   and public by design; only the Safe's owners decide them, through their own process.
3. `not enforced` means the address has no Fengce guard: say so, and follow the user's other rules.
4. `allow` is necessary, not sufficient: continue with the normal signing flow and confirmations; the wallet checks again
   when the transaction executes.
5. If the check cannot be made (network error, rate limit), do not act as if it passed.

## Examples

### Example 1: an agent paying an invoice from a Safe

1. Build the transfer: token USDT0, recipient, amount in base units.
2. Preflight it for the Safe. Decision `deny`, reason `FengceDenied(...)`.
3. Stop. Tell the user: "Fengce denied this 1.5 USDT0 transfer; the Safe's policy allows at most 1 USDT0 per transfer.
   Changing that limit is up to the Safe's owners and takes at least a day."

### Example 2: within the limit

1. Preflight 0.5 USDT0: decision `allow`.
2. Continue with the usual confirmation and signing flow.

## Error Handling

| Error | Cause | Resolution |
|-------|-------|------------|
| `400` with `error` | Bad address, bad calldata, unknown policy | Fix the input named in `error` and ask again |
| "public RPC nodes ... did not answer" | X Layer RPC rate limit | Wait 10 to 30 seconds and retry the check; do not act meanwhile |
| `decision: "deny"` with `Fails closed: call not recognised` | Fengce cannot decode this call, so the wallet denies it | Treat as final; tell the user the wallet's policy does not allow this kind of call |

## Security Notices

- Read-only: this skill only reads public data and never signs, sends or holds keys.
- A Fengce answer is a check, not a guarantee of execution or of the transaction's safety: the policy decides what is
  allowed, not whether the counterparty is trustworthy.
- Fengce has not been independently audited.

## Skill Routing

- To sign or broadcast an allowed transaction -> use the wallet or onchainos skill the user has configured
- For token or contract risk checks -> use a security scanning skill
