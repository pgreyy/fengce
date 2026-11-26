# Okun, powered by Fengce: hackathon submission

## Limits your wallet keeps, even on you

Set buy caps and trade limits inside your smart wallet. Each limit is a TapeOut circuit on X Layer. It follows your wallet
across supported apps and transaction paths.

App: [getokun.vercel.app](https://getokun.vercel.app) · engine page: [/fengce](https://getokun.vercel.app/fengce/) · also
served from X Layer itself as [6.2.180.tape](https://6-2-180.tapekit.org/) · code: [github.com/pgreyy/fengce](https://github.com/pgreyy/fengce)

## The problem

Today's wallet checks only look (a screen shows a transaction) or only ask (an agent is told a rule). Each of these passed
such a check:

- **Binance** (Oct 2026, ~$6.3B): a hijacked signing service drained hot wallets with valid signatures.
- **Bybit** (Feb 2025, ~$1.5B): the Safe screen showed a transfer while signers approved a contract upgrade.
- **Freysa** (Nov 2024, $47K): a player talked an AI agent out of its "never send funds" prompt rule.
- **AIXBT** (Mar 2025, ~$106K): an attacker reached the agent's dashboard and queued transfers.

Sources and losses as reported: [README, Why Fengce](../README.md#why-fengce).

## What's built

- **Okun, the app.** Connect a browser wallet, choose or create a 1-of-1 Safe, set **max per buy** and **trades per hour**,
  test them against the real circuit, and install with **one signature**. My wallet reads the installed limits back from
  chain; Try it runs real swaps and sends through the Safe and shows why a refusal happened.
- **Fengce, the engine (18 contracts on X Layer mainnet).** `FengceGuard` makes a Safe run every transaction (owners,
  modules, agents, batches) through a pinned TapeOut circuit before it executes; changes wait 1 day, removal waits 2 days
  with every owner. `PinRegistry` fingerprints the circuit, every processor it depends on and the code behind them. `Tick`
  keeps state for stateful circuits. `FengceBinding` lets other contracts check that a wallet is bound (`isBound`).
- **Two Okun limits as TapeOut circuits.** Max per buy reuses a deployed NAND circuit with a new pin (amount over the cap
  and paying USDT0). Trades per hour is a new counter circuit (100 NAND + 4 LATCH), checked on all 2,048 input and state
  combinations, run by Tick and reset each clock hour.
- **Adapters for other wallets.** ERC-7579 and ERC-6900 accounts are enforced through hooks (not permanent); Coinbase Smart
  Wallet and EIP-7702 accounts for agents.
- **SDK** [`@fengce/sdk`](https://www.npmjs.com/package/@fengce/sdk), an **MCP server** and an **OnchainOS skill**, so apps
  and agents can check a transaction before signing.

## Proof

| What | Evidence |
|---|---|
| An agent's 1.5 USDT0 transfer over a 1 USDT0 cap: **DENIED** by the wallet | [0x9b70…4a1b](https://www.oklink.com/x-layer/tx/0x9b70d386a2782e269ab1d3b1df6de767534a5b5b7904998abd92a651d2584a1b) |
| The same agent's 0.5 USDT0 transfer: **ALLOWED** | [0x7a70…ccab](https://www.oklink.com/x-layer/tx/0x7a70f5c9713fd9236ecdd81287bcf775253d2cbea19c857524bb1047acfcccab) |
| One-signature install, in-limit swap passes, over-limit swap reverts, the third swap in an hour reverts, raising the cap waits 1 day | fork test on live X Layer state: [test/fork/OkunInstall.t.sol](../test/fork/OkunInstall.t.sol) |
| Source verified | 18/18 v2 contracts on Sourcify, exact match ([list](CLAIMS.md#sourcify-18)) |
| The app is stored on X Layer | [6.2.180.tape](https://6-2-180.tapekit.org/), every file checked by SHA-256 ([record](../deployments/deweb-xlayer-196.json)) |
| Tests | 112 in CI for the v2 release commit, plus later unit and fork tests ([CLAIMS.md](CLAIMS.md)) |

Every claim with its transaction, test or verification link: [CLAIMS.md](CLAIMS.md).

## How it's different

| | Key and policy vendors | Pre-sign checkers | Delegation and role modules | Fengce |
|---|---|---|---|---|
| Where the check runs | the vendor's servers | a browser extension | on-chain | on-chain, a public TapeOut circuit |
| Binds the owners too | no | no, a warning | no, delegates only | yes |
| Rule can change quietly | yes | n/a | yes | no: loosening waits 1 day in public |
| Other contracts can check it | no | no | no | yes (`isBound`) |

Full tables: [README, Why Fengce](../README.md#why-fengce).

## What's next

- **One engine upgrade** that adds the time facts for quiet hours and hold locks, the tilt shield latch, an optional partner
  who co-approves loosening, and per-agent daily caps.
- **Add a circuit and build your own**: Catalog circuits and your own conditions, taped out from your wallet.
- **Agents**: the OKX Agentic Wallet as the agent key on a bound Safe, every action through AgentExecutor.
- **An independent security review** before larger amounts.

## Links

- App: [getokun.vercel.app](https://getokun.vercel.app) · on X Layer: [6.2.180.tape](https://6-2-180.tapekit.org/)
- Try it yourself: [TRY-IT.md](TRY-IT.md) · integration: [INTEGRATION.md](INTEGRATION.md) · API: [API.md](API.md)
- Wallets and guarantees: [WALLETS.md](WALLETS.md) · threat model: [THREAT-MODEL.md](THREAT-MODEL.md)
- SDK: [@fengce/sdk](https://www.npmjs.com/package/@fengce/sdk) · MCP: [mcp/README.md](../mcp/README.md)
- Addresses: [deployments/xlayer-196-v2.json](../deployments/xlayer-196-v2.json)
