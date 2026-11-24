# Fengce: hackathon submission

## The wallet-level enforcement layer for TapeOut

Your rules run as TapeOut circuits on X Layer, and the wallet itself enforces them, for owners and AI agents alike.

Live: [getfengce.vercel.app](https://getfengce.vercel.app) · also served from X Layer itself as
[6.2.180.tape](https://6-2-180.tapekit.org/) · code: [github.com/pgreyy/fengce](https://github.com/pgreyy/fengce)

## The problem

Today's wallet checks only look (a screen shows a transaction) or only ask (an agent is told a rule). Each of these
passed such a check:

- **Binance** (Oct 2026, ~$6.3B): a hijacked signing service drained hot wallets with valid signatures.
- **Bybit** (Feb 2025, ~$1.5B): the Safe screen showed a transfer while signers approved a contract upgrade.
- **Freysa** (Nov 2024, $47K): a player talked an AI agent out of its "never send funds" prompt rule.
- **AIXBT** (Mar 2025, ~$106K): an attacker reached the agent's dashboard and queued transfers.

Sources and losses as reported: [README, Why Fengce](../README.md#why-fengce).

## What's built

- **Contracts on X Layer mainnet (v2, 18 contracts).** `PinRegistry` locks a TapeOut circuit and every circuit it
  references. `PolicyEngine` evaluates it and fails closed. `FengceGuard` makes a Safe run every transaction (owners,
  modules, agents, batches) through the pinned circuit before it executes, with timelocked changes and an outcome
  check. `Catalog` lists policies with test vectors, `Tick` shares budgets across wallets, `FengceFloors` sets
  company-wide minimums, `FengceBinding` lets other contracts check that a wallet is bound (`isBound`).
- **Adapters for other wallets.** `FengceHook` (ERC-7579: Kernel, Nexus, Etherspot, Safe7579), `FengceHook6900`
  (Alchemy Modular Account v2, EIP-7702 accounts), `FengceAgentOwner` (Coinbase Smart Wallet and other owner-based
  wallets). 8 wallet types have a tested adapter.
- **SDK** [`@fengce/sdk`](https://www.npmjs.com/package/@fengce/sdk): schemas, Quote certificates, install calldata,
  local evaluation and `preSign` (check a transaction before signing).
- **MCP server and OnchainOS skill** so AI agents can ask Fengce before they act.
- **App**: Catalog (each policy with a gate-by-gate **Try it**), Protect (choose a wallet, install, check any wallet),
  Verdict. Everything is read from X Layer by the browser.
- **Verdict**: prediction markets in USDT0 that settle on a pinned TapeOut circuit, with no admin and no fee. Anyone
  can re-run the settlement in the browser.

## Proof

| What | Evidence |
|---|---|
| An agent's 1.5 USDT0 transfer over a 1 USDT0 cap: **DENIED** by the wallet | [0x9b70…4a1b](https://www.oklink.com/x-layer/tx/0x9b70d386a2782e269ab1d3b1df6de767534a5b5b7904998abd92a651d2584a1b) |
| The same agent's 0.5 USDT0 transfer: **ALLOWED** | [0x7a70…ccab](https://www.oklink.com/x-layer/tx/0x7a70f5c9713fd9236ecdd81287bcf775253d2cbea19c857524bb1047acfcccab) |
| Verdict deployed, demo market #0 created | [`0xb258…7c55`](https://www.oklink.com/x-layer/address/0xb2589D3153411c5dcedFA83692AcaAC3d93A7c55), [market on the app](https://getfengce.vercel.app/verdict/?id=0) |
| Source verified | 18/18 v2 contracts and Verdict on Sourcify, exact match ([list](CLAIMS.md#sourcify-18), [Verdict](https://repo.sourcify.dev/196/0xb2589D3153411c5dcedFA83692AcaAC3d93A7c55)) |
| The app is stored on X Layer | [6.2.180.tape](https://6-2-180.tapekit.org/), every file checked by SHA-256 ([record](../deployments/deweb-xlayer-196.json)) |
| Tests | 112 in CI for the v2 release commit, plus Verdict unit and fork tests ([CLAIMS.md](CLAIMS.md)) |

Every claim with its transaction, test or verification link: [CLAIMS.md](CLAIMS.md).

## How it's different

| | Key and policy vendors | Pre-sign checkers | Delegation and role modules | Fengce |
|---|---|---|---|---|
| Where the check runs | the vendor's servers | a browser extension | on-chain | on-chain, a public TapeOut circuit |
| Binds the owners too | no | no, a warning | no, delegates only | yes |
| Rule can change quietly | yes | n/a | yes | no: changes wait days, in public |
| Other contracts can check it | no | no | no | yes (`isBound`) |

Full tables: [README, Why Fengce](../README.md#why-fengce).

## What's next

- **Verdict V2**: settle on a value proven at a fixed block (EIP-2935 block hashes, live on X Layer) instead of the
  first checkpoint's block.
- **More wallets**: close the known gaps (uninstall without the hook on Nexus, Etherspot and Safe7579), add a caveat
  enforcer for MetaMask delegations.
- **An independent security review** before larger amounts.
- **Policy designers**: more circuits in the Catalog, paid through install fees (80% to the designer).

## Links

- Live app: [getfengce.vercel.app](https://getfengce.vercel.app) · on X Layer: [6.2.180.tape](https://6-2-180.tapekit.org/)
- Try it yourself: [TRY-IT.md](TRY-IT.md) · integration: [INTEGRATION.md](INTEGRATION.md) · API: [API.md](API.md)
- Wallets and guarantees: [WALLETS.md](WALLETS.md) · Verdict rules: [VERDICT.md](VERDICT.md)
- SDK: [@fengce/sdk](https://www.npmjs.com/package/@fengce/sdk) · MCP: [mcp/README.md](../mcp/README.md)
- Addresses: [deployments/xlayer-196-v2.json](../deployments/xlayer-196-v2.json),
  [deployments/verdict-xlayer-196.json](../deployments/verdict-xlayer-196.json)
