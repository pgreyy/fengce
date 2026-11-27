# Architecture

```
You · apps · agents        ask (send a Safe transaction, or an agent call through AgentExecutor)
Your Safe                  holds the funds; runs FengceGuard as transaction guard and module guard
FengceGuard                decides: decodes the call into facts, runs the rules, asks the pinned circuit
TapeOut circuits (pinned)  the rule logic: NAND #2 (max per buy, and on v3 quiet hours, hold lock, agent caps),
                           counter #7 (trades per hour, Tilt-shield buys in a window), the Tilt-shield latch
X Layer                    enforces: a refused call reverts (or is recorded as Denied for agents)
```

## How the guard decides (one Safe transaction)

1. **Delegatecall**: only to MultiSendCallOnly 1.5.0 (code hash checked); every inner call is checked as below.
2. **Call to the guard**: recovery (all owners), timelock scheduling, configuration. Before the first configuration
   it is free; after it, tightening applies at once (v3) and anything else must have waited out the timelock.
3. **Call to the Safe itself**: installing this guard passes; any other guard needs recovery; other admin calls need the
   timelock.
4. **Anything else**: TxFacts (or a registered decoder, such as the Uniswap V3 router decoder) turns the call into facts
   (kind, token, amount, recipient, swap output). Then:
   - v3 only: the rules library computes one-bit facts (inside quiet hours, sold too soon after buying, over the
     agent's cap) and NAND circuit #2 decides each one;
   - the Safe's pinned policy circuit evaluates the schema-encoded facts (max per buy: NAND circuit #2);
   - v3 only: Tilt-shield steps the latch circuit and counter #7 through Tick;
   - trades per hour steps counter #7 through Tick (state per Safe group, reset each clock hour).
   Any refusal reverts the whole transaction with a reason (`FengceRefused(code, safe, to)` on v3).

## Contracts

| Contract | Role |
|---|---|
| FengceGuard (v2) / FengceGuardV3 + FengceRulesV3 | the guard; v3 adds the circuit-backed rules and reason codes |
| PinRegistry | fingerprints a circuit, its REF closure, processors, beacon and factory; `isPinned` fails closed |
| PolicyEngine | evaluates a pinned circuit with a gas cap (inside the guard) |
| Tick | keeps state for stateful circuits (LATCH) per policy group; rollback on a failed transaction |
| AgentExecutor (v2) / AgentExecutorV3 | the agents' only path: a module that runs agent calls through the guard and records Denied |
| Catalog | listings of pinned circuits with vectors and gas tier; install fee split 80% designer, 20% treasury |
| UniswapV3RouterDecoder | turns SwapRouter02 calls into swap facts |
| FengceBinding | lets other contracts ask whether a wallet is bound to a policy (`isBound`) |

Addresses: [judges.md](judges.md). Source: [../contracts/src](../contracts/src).

## The app

Static pages that read X Layer from the browser (no backend for decisions). Activity is read from chain logs, seeded by
a snapshot the repository refreshes every 2 hours (`app/public/events-snapshot.json`). Install calldata is built in the
browser (`app/src/fengce/engine.ts`) and checked byte for byte by a fork test (`contracts/test/fork/LimitsInstall.t.sol`).
