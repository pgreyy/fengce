<div align="center">

# fengce

### Limits your wallet keeps, even on you.

**On-chain limits for Safe and agent wallets on X Layer. Every rule runs on a TapeOut circuit.**

<a href="#demo-video"><img src="https://img.shields.io/badge/Watch%20the%202%20minute%20demo-F0533F?style=for-the-badge" alt="Watch the 2 minute demo" height="36"></a>
<!-- demo-video: replace the #demo-video link above with the video URL -->

[Live app](https://getfengce.vercel.app) · [For judges](docs/judges.md) · [Docs](https://getfengce.vercel.app/docs/) · [On X Layer: 6.2.180.tape](https://6-2-180.tapekit.org/) · [SDK on npm](https://www.npmjs.com/package/@fengce/sdk)

<p>
  <img src="https://img.shields.io/badge/network-X%20Layer%20mainnet%20(196)-101010?style=flat-square" alt="X Layer mainnet">
  <img src="https://img.shields.io/badge/rules-TapeOut%20circuits-F0533F?style=flat-square" alt="TapeOut circuits">
  <img src="https://img.shields.io/badge/contracts-18%2F18%20verified%20on%20Sourcify-0F7543?style=flat-square" alt="18 of 18 verified">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-MIT-101010?style=flat-square" alt="MIT licence"></a>
</p>

</div>

## Try it in 2 minutes

1. Open [getfengce.vercel.app/try](https://getfengce.vercel.app/try/) with no wallet. Enter **31** USDT0 and press **Test it (simulated)**: the
   acceptance Safe's guard answers **REFUSED · MAX_PER_BUY** (its cap is 30). Enter **5**: **ALLOWED**. One eth_call, nothing sent.
2. Open the [acceptance Safe's activity](https://getfengce.vercel.app/wallet/?safe=0x5641DA334011832Feec997875781a3D40239465e): every row
   is read from X Layer, with its transaction ID.
3. With OKX Wallet or MetaMask: **Connect**, create a Safe, set max per buy and trades per hour on **Limits**, press **Test before you
   sign**, then **Install with one signature**.

## The problem

Wallet checks today only look (a screen shows a transaction) or only ask (an agent is told a rule).
Bybit's signers approved an upgrade the screen showed as a transfer; Freysa's agent was talked out of its prompt rule.
Fengce puts the rule in the wallet: the Safe runs every transaction through a pinned circuit before money moves.

## How it works

```
You · apps · agents        ASK         send a transaction, or an agent call through AgentExecutor
Your Safe                  HOLDS       runs FengceGuard as its transaction guard and module guard
Fengce guard               DECIDES     decodes the call into facts and asks the pinned circuit
TapeOut circuits (pinned)  RULE LOGIC  NAND #2, counter #7, the Tilt-shield latch
X Layer                    ENFORCES    a refused call reverts, with a reason
```

Tightening is instant (guard v3), loosening waits 1 day, removing the guard waits 2 days with every owner
([no-quiet-swap](docs/CLAIMS.md#no-quiet-swap), [contracts/test/fork/GuardV3.t.sol](contracts/test/fork/GuardV3.t.sol)). More:
[docs/architecture.md](docs/architecture.md), [docs/security.md](docs/security.md).

## Rules

| Rule | Status | Circuit | Evidence |
|---|---|---|---|
| Max per buy | LIVE | [NAND #2](https://getfengce.vercel.app/docs/?tab=circuits#c-max-per-buy) | [`0x9414b8f3…dbe7d9`](https://www.oklink.com/x-layer/tx/0x9414b8f3c850cfa7479ac679e90d707875ef47de7628c4dd8a6bdc5882dbe7d9) allowed; refusal [test](contracts/test/fork/LimitsInstall.t.sol) |
| Trades per clock hour | LIVE | [Counter #7](https://getfengce.vercel.app/docs/?tab=circuits#c-trades-per-hour) | [contracts/test/fork/LimitsInstall.t.sol](contracts/test/fork/LimitsInstall.t.sol) |
| Quiet hours | v3 | [NAND #2](https://getfengce.vercel.app/docs/?tab=circuits#c-max-per-buy) | [GuardV3.t.sol](contracts/test/fork/GuardV3.t.sol) `test_quietHours_nandCircuit` |
| Hold lock | v3 | [NAND #2](https://getfengce.vercel.app/docs/?tab=circuits#c-max-per-buy) | `test_holdLock_nandCircuit` |
| Tilt-shield | v3 | [Counter #7](https://getfengce.vercel.app/docs/?tab=circuits#c-trades-per-hour) + [latch](https://getfengce.vercel.app/docs/?tab=circuits#c-tilt-latch) | `test_tiltShield_counterAndLatchCircuits`, `test_tiltShield_sizeTrip_andPartnerClear` |
| Agent cap | v3 | [NAND #2](https://getfengce.vercel.app/docs/?tab=circuits#c-max-per-buy) | `test_agentCap_nandCircuit` |
| Partner approval | v3 | guard timelock | `test_tiltShield_sizeTrip_andPartnerClear` |
| Add a circuit / Build your own | LIVE (app) | [Catalog](https://getfengce.vercel.app/docs/?tab=circuits#c-catalog) / taped out from your wallet | Catalog contract below |

v3 is built and fork-tested on live X Layer state; its mainnet deployment is [scripts/m2-onchain.sh](scripts/m2-onchain.sh).

## Deployed contracts (release v2, X Layer mainnet)

| Contract | Address | Verified |
|---|---|---|
| FengceGuard | [`0x9D2A482fFA86fa3193F85c451A44576E2f1C8E6e`](https://www.oklink.com/x-layer/address/0x9D2A482fFA86fa3193F85c451A44576E2f1C8E6e) | [✓](https://repo.sourcify.dev/196/0x9D2A482fFA86fa3193F85c451A44576E2f1C8E6e) |
| PinRegistry | [`0xD905dde3A09a9777B98013AD196E3b3F988e3715`](https://www.oklink.com/x-layer/address/0xD905dde3A09a9777B98013AD196E3b3F988e3715) | [✓](https://repo.sourcify.dev/196/0xD905dde3A09a9777B98013AD196E3b3F988e3715) |
| PolicyEngine | [`0x2264B97828454374a56D7407f859fEA6eE7dFAA9`](https://www.oklink.com/x-layer/address/0x2264B97828454374a56D7407f859fEA6eE7dFAA9) | [✓](https://repo.sourcify.dev/196/0x2264B97828454374a56D7407f859fEA6eE7dFAA9) |
| Tick | [`0xFEb6FD15F8724bfC69a119C0448f480a7D7e5370`](https://www.oklink.com/x-layer/address/0xFEb6FD15F8724bfC69a119C0448f480a7D7e5370) | [✓](https://repo.sourcify.dev/196/0xFEb6FD15F8724bfC69a119C0448f480a7D7e5370) |
| AgentExecutor | [`0xc01b590227149169260e030235b78d6e034E590c`](https://www.oklink.com/x-layer/address/0xc01b590227149169260e030235b78d6e034E590c) | [✓](https://repo.sourcify.dev/196/0xc01b590227149169260e030235b78d6e034E590c) |
| Catalog | [`0x26C5437428cdD7e4854614DC5DDEFE2776B51dFe`](https://www.oklink.com/x-layer/address/0x26C5437428cdD7e4854614DC5DDEFE2776B51dFe) | [✓](https://repo.sourcify.dev/196/0x26C5437428cdD7e4854614DC5DDEFE2776B51dFe) |
| FengceBinding | [`0x20157A63Df8ab6728698630E38f6d7683Ca6b6F8`](https://www.oklink.com/x-layer/address/0x20157A63Df8ab6728698630E38f6d7683Ca6b6F8) | [✓](https://repo.sourcify.dev/196/0x20157A63Df8ab6728698630E38f6d7683Ca6b6F8) |
| FengceInspector | [`0xdeA3e3C305460247686c3EEeAe6552F33D98EE1A`](https://www.oklink.com/x-layer/address/0xdeA3e3C305460247686c3EEeAe6552F33D98EE1A) | [✓](https://repo.sourcify.dev/196/0xdeA3e3C305460247686c3EEeAe6552F33D98EE1A) |
| UniswapV3RouterDecoder | [`0x47FDb3C6E91661562243f97Df2f4b0B8EfFAA479`](https://www.oklink.com/x-layer/address/0x47FDb3C6E91661562243f97Df2f4b0B8EfFAA479) | [✓](https://repo.sourcify.dev/196/0x47FDb3C6E91661562243f97Df2f4b0B8EfFAA479) |

All 18: [docs/judges.md](docs/judges.md) · manifest: [deployments/manifest-xlayer-196-v2.json](deployments/manifest-xlayer-196-v2.json).

## TapeOut circuits used

| Circuit | Processor | For |
|---|---|---|
| NAND #2 | [`0x839bdD6fa7A66416A609A735e11DE5411B98574e`](https://www.oklink.com/x-layer/address/0x839bdD6fa7A66416A609A735e11DE5411B98574e) | max per buy; v3 quiet hours, hold lock, agent caps |
| Counter #7 (100 NAND + 4 LATCH) | #180 [`0x7335a50819d44402e3D5E00239bBB80A13E7308F`](https://www.oklink.com/x-layer/address/0x7335a50819d44402e3D5E00239bBB80A13E7308F) | trades per hour (15 pins), Tilt-shield buys in a window |
| Tilt-shield latch (6 NAND + 1 LATCH) | #180 | Tilt-shield pause, [circuits/tilt-latch.json](contracts/circuits/tilt-latch.json) |
| 6.2.180.tape | #180 | this site, stored on X Layer with DeWeb |

## Demo transactions

| What | Transaction | Result |
|---|---|---|
| Agent pays 1.5 USDT0 over a 1 USDT0 cap | [`0x9b70d386…584a1b`](https://www.oklink.com/x-layer/tx/0x9b70d386a2782e269ab1d3b1df6de767534a5b5b7904998abd92a651d2584a1b) | Denied |
| Same agent pays 0.5 USDT0 | [`0x7a70f5c9…fcccab`](https://www.oklink.com/x-layer/tx/0x7a70f5c9713fd9236ecdd81287bcf775253d2cbea19c857524bb1047acfcccab) | Allowed |
| Limits installed with one signature | [`0xf73d0fbb…87e319`](https://www.oklink.com/x-layer/tx/0xf73d0fbbb2d094b027d7447baa7e30340c64fea6e6c401131123c162f287e319) | max per buy, trades per hour |
| Swap 1 USDT0 → OKB | [`0x9414b8f3…dbe7d9`](https://www.oklink.com/x-layer/tx/0x9414b8f3c850cfa7479ac679e90d707875ef47de7628c4dd8a6bdc5882dbe7d9) | Allowed |

## For agents

- **OKX Agentic Wallet**: the agentic wallet is the agent key on a Fengce-bound Safe; calls go through AgentExecutorV3 and an
  over-cap call is recorded as Denied with `AGENT_CAP` ([/agents](https://getfengce.vercel.app/agents/), [scripts/m2-agent-calls.sh](scripts/m2-agent-calls.sh)).
- **SDK**: `npm i @fengce/sdk`, then `check(client, safe, tx)` returns `allowed` or a reason code ([sdk/README.md](sdk/README.md)).
- **Skill**: `npx skills add pgreyy/fengce --skill fengce` ([skills/fengce/SKILL.md](skills/fengce/SKILL.md)). MCP server: [mcp/README.md](mcp/README.md).

## Repo map

| Folder | What |
|---|---|
| [contracts/](contracts/) | Foundry: `src/` contracts, `test/` unit and fork tests, `script/` deploy scripts, `circuits/` netlists |
| [app/](app/) | the site (React, Vite) and the read-only HTTP API |
| [sdk/](sdk/) | `@fengce/sdk`: check, schemas, install calldata, local evaluation |
| [mcp/](mcp/) | MCP server for agents |
| [skills/fengce/](skills/fengce/) | agent skill (Plugin Store format) |
| [scripts/](scripts/) | on-chain helpers (Milestone 2, agent calls) |
| [deployments/](deployments/) | addresses, manifests, the DeWeb record |
| [docs/](docs/) | judges, architecture, security, claims, API |

## Run locally

```sh
git clone https://github.com/pgreyy/fengce && cd fengce && git submodule update --init --recursive
cd contracts && forge build && forge test --match-path 'test/unit/*.t.sol'
cd ../sdk && npm ci && npm test
cd ../app && npm ci && npm run dev
```

Fork tests read live X Layer state: `forge test --match-path 'test/fork/*.t.sol'` (nothing is sent).

## Why Fengce

| Incident | Loss | With Fengce | Evidence |
|---|---|---|---|
| Bybit (Feb 2025) | ~$1.5B | FengceGuard refuses the delegatecall upgrade the screen hid | [delegatecall-blocked](docs/CLAIMS.md#delegatecall-blocked) |
| Freysa (Nov 2024) | $47K | the circuit doesn't read prompts | [no-prompt-input](docs/CLAIMS.md#no-prompt-input) |
| AIXBT (Mar 2025) | ~$106K | over-limit agent transfers revert; the rule can't change quietly | [agent-executor](docs/CLAIMS.md#agent-executor) |

Every incident with its source: [getfengce.vercel.app/docs/?tab=inc](https://getfengce.vercel.app/docs/?tab=inc).

## Business model

Core limits are free. Catalog circuits pay their designers 80% of each install fee; per-check fees for agents (x402) and
wallet integrations come later. [BUSINESS.md](BUSINESS.md).

## Demo video

The 2-minute script: [docs/demo-video-script.md](docs/demo-video-script.md).

## Licence

MIT. No independent security review yet: see [docs/security.md](docs/security.md).
