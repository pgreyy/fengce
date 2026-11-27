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
| Max per buy | LIVE | [NAND #2](https://getfengce.vercel.app/docs/?tab=circuits#c-max-per-buy) | [`0x9414b8f3…dbe7d9`](https://www.oklink.com/x-layer/tx/0x9414b8f3c850cfa7479ac679e90d707875ef47de7628c4dd8a6bdc5882dbe7d9) allowed; [`0x78dd364b…021283`](https://www.oklink.com/x-layer/tx/0x78dd364b256c32b70eebbac717dd5c8ed7b5876def35ba6118be7a81d4021283) refused (guard v3) |
| Trades per clock hour | LIVE | [Counter #7](https://getfengce.vercel.app/docs/?tab=circuits#c-trades-per-hour) | [contracts/test/fork/LimitsInstall.t.sol](contracts/test/fork/LimitsInstall.t.sol) |
| Quiet hours | LIVE (v3) | [NAND #2](https://getfengce.vercel.app/docs/?tab=circuits#c-max-per-buy) | [`0x9e9115a9…1ce798`](https://www.oklink.com/x-layer/tx/0x9e9115a971ee51146251464e5bebf527ebacd2dd91af35f17d11e24a9b1ce798) refused (QUIET_HOURS); `test_quietHours_nandCircuit` |
| Hold lock | LIVE (v3) | [NAND #2](https://getfengce.vercel.app/docs/?tab=circuits#c-max-per-buy) | [`0x3b1d2f6b…3e61d5`](https://www.oklink.com/x-layer/tx/0x3b1d2f6b7f8ce24fb910f2011d5377daa127eb413b81bdc3d1ddab12743e61d5) refused (HOLD_LOCK); `test_holdLock_nandCircuit` |
| Tilt-shield | LIVE (v3) | [Counter #7](https://getfengce.vercel.app/docs/?tab=circuits#c-trades-per-hour) + [latch](https://getfengce.vercel.app/docs/?tab=circuits#c-tilt-latch) | [`0x52fa8d40…de0b2b`](https://www.oklink.com/x-layer/tx/0x52fa8d40882b75e6561a029afde8fc31a8498a911202253e3313e38959de0b2b) refused after 4 buys in the same half hour; `test_tiltShield_counterAndLatchCircuits` |
| Agent cap | LIVE (v3) | [NAND #2](https://getfengce.vercel.app/docs/?tab=circuits#c-max-per-buy) | [`0xbde663dc…d728ae`](https://www.oklink.com/x-layer/tx/0xbde663dcf559fa162d1bf406836a84859f893dccd805fbac9cd92882c7d728ae) denied (OKX Agentic Wallet); `test_agentCap_nandCircuit` |
| Partner approval | v3 on mainnet (fork-tested) | guard timelock | `test_tiltShield_sizeTrip_andPartnerClear` |
| Add a circuit / Build your own | LIVE (app) | [Catalog](https://getfengce.vercel.app/docs/?tab=circuits#c-catalog) / taped out from your wallet | Catalog contract below |

Guard v3 is deployed on X Layer mainnet by [scripts/m2-onchain.sh](scripts/m2-onchain.sh) (Milestone 2 below). Partner approval runs in that guard and is
fork-tested; on mainnet the demo Safe's partner is scheduled (it applies after the 1-day wait), and the early approval follows.

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
| Counter #7 (100 NAND + 4 LATCH) | #180 [`0x7335a50819d44402e3D5E00239bBB80A13E7308F`](https://www.oklink.com/x-layer/address/0x7335a50819d44402e3D5E00239bBB80A13E7308F) | trades per hour (15 pins), Tilt-shield buys in the same half hour |
| Tilt-shield latch (6 NAND + 1 LATCH) | #180 | Tilt-shield pause, [circuits/tilt-latch.json](contracts/circuits/tilt-latch.json) |
| 6.2.180.tape | #180 | this site, stored on X Layer with DeWeb |

## Milestone 2 on X Layer mainnet (guard v3)

Demo Safe [`0x637A7BEe8a71A750923Cd023d4666eb89A2a5208`](https://www.oklink.com/x-layer/address/0x637A7BEe8a71A750923Cd023d4666eb89A2a5208) ([open read-only](https://getfengce.vercel.app/wallet/?safe=0x637A7BEe8a71A750923Cd023d4666eb89A2a5208)), FengceGuardV3
[`0x8f2Bee582260dF363AAfaE77cb2e1cdB63110941`](https://www.oklink.com/x-layer/address/0x8f2Bee582260dF363AAfaE77cb2e1cdB63110941), AgentExecutorV3 [`0x3FFd99E3E2386C863fbcC16362aF233648D6695A`](https://www.oklink.com/x-layer/address/0x3FFd99E3E2386C863fbcC16362aF233648D6695A), agent (OKX Agentic Wallet) `0x7dd2eA948c13C1CF6045DDBc3c674A6ed2E6d879`. Every row below is in
[deployments/m2-demo-xlayer-196.json](deployments/m2-demo-xlayer-196.json); amounts and reason codes were decoded from the
transactions on chain.

| What | Transaction | Result |
|---|---|---|
| FengceRulesV3 library deployed | [`0x162db8d0…c77efd`](https://www.oklink.com/x-layer/tx/0x162db8d0b65718c354a2890a068c6dfe613f186ed95f7eb283209fc40cc77efd) | `0xbc07773b7a19b2a8e8f89adc97bde9d7752b1c2c` |
| Tilt-shield latch circuit taped out (circuit #8 on processor #180) | [`0x76128ab4…7d4266`](https://www.oklink.com/x-layer/tx/0x76128ab438ae0037eb6c3185ba9568eeab1715a2de0e85011f15772ff37d4266) | 6 NAND + 1 LATCH |
| Tilt-shield latch pinned in PinRegistry | [`0xc43c9d84…8097ca`](https://www.oklink.com/x-layer/tx/0xc43c9d842b7cd6b97a061c73fc32a12636af4708123d9994c3e70fbde88097ca) | pin `0xe74214f7…` |
| FengceGuardV3 deployed | [`0xb13183b1…2f19f0`](https://www.oklink.com/x-layer/tx/0xb13183b1c679e042570ee1f1e180dd5b37f5bab657713c46b43e29cc7e2f19f0) | `0x8f2Bee582260dF363AAfaE77cb2e1cdB63110941` |
| AgentExecutorV3 deployed | [`0x81738058…3f08ee`](https://www.oklink.com/x-layer/tx/0x8173805857632f9632f545faab772bb6e6aab0dd0aea15e131cdf596593f08ee) | `0x3FFd99E3E2386C863fbcC16362aF233648D6695A` |
| Demo Safe created | [`0xeea23f67…a35211`](https://www.oklink.com/x-layer/tx/0xeea23f6795202ca7e4240adf1968023905e344ceeadbcc61b08adc53a6a35211) | `0x637A7BEe8a71A750923Cd023d4666eb89A2a5208` |
| Guard v3 installed with one signature (max per buy 2 USDT0, 5 trades per hour, Tilt-shield at 4 buys, agent cap 0.5 USDT0 a day) | [`0xf3dfa64b…a37fc8`](https://www.oklink.com/x-layer/tx/0xf3dfa64beb16a5a7674e52f1bd6622e306b9373bf7fdde25a25c065939a37fc8) | installed |
| Safe funded | [`0x4d47c747…7be1f3`](https://www.oklink.com/x-layer/tx/0x4d47c747299da74e8e542ad5477ab87d77eb0f3df7b7c1d8842613beb07be1f3) | 1.5 USDT0 |
| Swap 0.2 USDT0 → OKB | [`0xafb795f9…f217b6`](https://www.oklink.com/x-layer/tx/0xafb795f9f4c86f301734f61e6f282bf3cc528125b8351c0858c6bfce2af217b6) | Allowed |
| Swap 3 USDT0 → OKB (over the 2 USDT0 cap), recorded with recordRefusal | [`0x78dd364b…021283`](https://www.oklink.com/x-layer/tx/0x78dd364b256c32b70eebbac717dd5c8ed7b5876def35ba6118be7a81d4021283) | Refused, code 1 (CIRCUIT: max per buy) |
| Tilt-shield buy 1 of 4 (0.2 USDT0) in the same half hour | [`0xf700d23e…9d1f7e`](https://www.oklink.com/x-layer/tx/0xf700d23ea538721ce771b2953ac76c340ec5e9ad8d701181a2e87fcb2c9d1f7e) | Allowed |
| Tilt-shield buy 2 of 4 (0.2 USDT0) in the same half hour | [`0x5594edd9…c9f3e7`](https://www.oklink.com/x-layer/tx/0x5594edd982868806eb3b9418b6c86feddf76dbf583e3d046f1895262cbc9f3e7) | Allowed |
| Tilt-shield buy 3 of 4 (0.2 USDT0) in the same half hour | [`0x8cbef618…7b30be`](https://www.oklink.com/x-layer/tx/0x8cbef6186d6cf148ae311bdcf112d5cf081668685f42a22efcef693f537b30be) | Allowed |
| Tilt-shield buy 4 of 4 (0.2 USDT0) in the same half hour | [`0x26baa17c…fd0f70`](https://www.oklink.com/x-layer/tx/0x26baa17ca5b743fdaefc6c2df186f96e8aa1eb738ec5b7b5f3126a5894fd0f70) | Allowed · trips Tilt-shield |
| One more buy of 0.2 USDT0, recorded with recordRefusal | [`0x52fa8d40…de0b2b`](https://www.oklink.com/x-layer/tx/0x52fa8d40882b75e6561a029afde8fc31a8498a911202253e3313e38959de0b2b) | Refused, code 5 (TILT_SHIELD) |
| OKX Agentic Wallet pays 0.3 USDT0 through AgentExecutorV3 | [`0x4da52f34…ec3b1c`](https://www.oklink.com/x-layer/tx/0x4da52f34ca30b4dae4569bbbbf209b7f162bf5fa6e5632778824917f53ec3b1c) | Allowed (0.3 of the 0.5 USDT0 daily cap) |
| Same agent pays 0.3 USDT0 again | [`0xbde663dc…d728ae`](https://www.oklink.com/x-layer/tx/0xbde663dcf559fa162d1bf406836a84859f893dccd805fbac9cd92882c7d728ae) | Denied, code 6 (AGENT_CAP), nothing moved |
| Hold lock set to 6 hours (a tightening, applied at once) | [`0xb6248ca7…86f660`](https://www.oklink.com/x-layer/tx/0xb6248ca7f44629c47f7f71752440ac3fe593912af35e7ef87d7b4ad3f486f660) | Applied |
| Buy 0.05 USDT0 of OKB | [`0xf0125acc…199f81`](https://www.oklink.com/x-layer/tx/0xf0125accabbfb3b57adb4a3151ed30f814ee4c100b90acf77818cef6f9199f81) | Allowed |
| Sell it right away, recorded with recordRefusal | [`0x3b1d2f6b…3e61d5`](https://www.oklink.com/x-layer/tx/0x3b1d2f6b7f8ce24fb910f2011d5377daa127eb413b81bdc3d1ddab12743e61d5) | Refused, code 4 (HOLD_LOCK) |
| Quiet hours over the current UTC hour (a tightening, applied at once) | [`0xa382acff…4d36ea`](https://www.oklink.com/x-layer/tx/0xa382acff9721a59f3fc4a43dee0e13c23397d08ed4c45d36caa7b57bac4d36ea) | Applied |
| A buy inside quiet hours, recorded with recordRefusal | [`0x9e9115a9…1ce798`](https://www.oklink.com/x-layer/tx/0x9e9115a971ee51146251464e5bebf527ebacd2dd91af35f17d11e24a9b1ce798) | Refused, code 3 (QUIET_HOURS) |
| Partner scheduled (adding a partner is a loosening: waits 1 day) | [`0x508f9090…26a245`](https://www.oklink.com/x-layer/tx/0x508f9090d7b184fd9c46d310adeeed427f6ded6daeb9a816dea136ef9826a245) | Scheduled, ready 28 Nov 15:40 UTC |

## Milestone 2c on X Layer mainnet (Catalog install and Build your own, fresh Safe)

Second Safe [`0xF702253f0bad45b8a07cD7B6499eb7EcB2f4aA87`](https://www.oklink.com/x-layer/address/0xF702253f0bad45b8a07cD7B6499eb7EcB2f4aA87) ([open read-only](https://getfengce.vercel.app/wallet/?safe=0xF702253f0bad45b8a07cD7B6499eb7EcB2f4aA87)), created through FengceSetupV3
[`0x591E804770b0819AF1d3Ce14289215d1c3dC8dA3`](https://www.oklink.com/x-layer/address/0x591E804770b0819AF1d3Ce14289215d1c3dC8dA3). The partner role is played by the deployer key in this demo. From
[scripts/m2c-onchain.sh](scripts/m2c-onchain.sh); every row is in [deployments/m2-demo-xlayer-196.json](deployments/m2-demo-xlayer-196.json).

| What | Transaction | Result |
|---|---|---|
| FengceSetupV3 deployed (one-signature Safe creation with guard v3) | [`0xde11a359…c1a00e`](https://www.oklink.com/x-layer/tx/0xde11a35904a8a7928813e1eb3816555457e1a2b377bbee94c1438e8f54c1a00e) | `0x591E804770b0819AF1d3Ce14289215d1c3dC8dA3` |
| Second Safe created with guard v3 in one transaction (deployer as partner) | [`0xe2031beb…a9f4b8`](https://www.oklink.com/x-layer/tx/0xe2031beb8a5ccb08f58549ec785fa35ecdbf5b3fa06a8f8573b5059b73a9f4b8) | `0xF702253f0bad45b8a07cD7B6499eb7EcB2f4aA87` |
| Funded with 0.12 USDT0 | [`0x81aa7363…d7aaea`](https://www.oklink.com/x-layer/tx/0x81aa7363f1fd75cf4236056ac98129b8e236658b5291df764eeed0a768d7aaea) | 0.12 USDT0 |
| Catalog #2 install scheduled | [`0x05776331…74506c`](https://www.oklink.com/x-layer/tx/0x057763311385a7bc95a5056f02ff5534e77d08f5f42af991075ca4a4dc74506c) |  |
| partner approves early | [`0xa82f6f14…56653b`](https://www.oklink.com/x-layer/tx/0xa82f6f146526c1ab0910a57ea2695581bc836978f6bd534544a7449e5256653b) |  |
| applied (policy is now the Catalog circuit) | [`0xece1e440…9cc977`](https://www.oklink.com/x-layer/tx/0xece1e4402a1d7b90b27e581540d8513b86b9d37972d23a885312ff58469cc977) |  |
| send 0.05 USDT0: Allowed | [`0x5c00b558…1de811`](https://www.oklink.com/x-layer/tx/0x5c00b558cfc44d9a8ed82c4c474bcda5ff88ecd083fa88b3fbb2f3e01f1de811) |  |
| send 0.5 USDT0: Refused, code 1 (recorded) | [`0xf72e45a6…7948fd`](https://www.oklink.com/x-layer/tx/0xf72e45a6da4c61b8deb0250f5b72a68cc7bdeb1d4eef7aa36c76a1e3327948fd) |  |
| transistors minted | [`0xd0b1493c…3e8c17`](https://www.oklink.com/x-layer/tx/0xd0b1493cd6973b1663febde9fcd3edc75437f5e8a9d1e717970ebb0f663e8c17) |  |
| Build your own circuit taped out (#9 on #180) | [`0x0faa7132…3f613b`](https://www.oklink.com/x-layer/tx/0x0faa7132581b19d27b99bed91e4d6072e672997b26ca46dd0e5acd41153f613b) |  |
| circuit pinned | [`0x99960f11…191a50`](https://www.oklink.com/x-layer/tx/0x99960f1119824d44c5ffff0d38f4c0181a84ae527ed666ad38c6f6366f191a50) |  |
| policy change scheduled | [`0x0be4db8f…fd67bb`](https://www.oklink.com/x-layer/tx/0x0be4db8fa6d9f58f123cddc7c7de552f8d98dd32fd8609778ebf2116a3fd67bb) |  |
| partner approves early | [`0x5df6e22f…f0c06a`](https://www.oklink.com/x-layer/tx/0x5df6e22f76edb965e8c0ea92284690fec64b24e1c1db9438a4ae8e3661f0c06a) |  |
| applied | [`0x60575269…369a88`](https://www.oklink.com/x-layer/tx/0x60575269110199603a5215abc6aca1084316244e549043636a6a5febb7369a88) |  |
| send 0.05 USDT0: Allowed | [`0x01b9db8f…c2d1ba`](https://www.oklink.com/x-layer/tx/0x01b9db8f71505d9a82615eca1fe069fe7308ea3ee007bcf55f51298a6dc2d1ba) |  |
| send 0.5 USDT0: Refused, code 1 (recorded) | [`0x2046dca0…08f3eb`](https://www.oklink.com/x-layer/tx/0x2046dca0cc95f97b3340b5d9c4b6f41abebc961627f2d4bcf101c92e5908f3eb) |  |

## Milestone 1 (acceptance Safe, guard v2)

Safe [`0x5641DA334011832Feec997875781a3D40239465e`](https://www.oklink.com/x-layer/address/0x5641DA334011832Feec997875781a3D40239465e) and the release v2 demo agent.


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
- **Skill**: `npx skills add pgreyy/fengce --skill fengce` ([skills/fengce/SKILL.md](skills/fengce/SKILL.md)).
- **MCP server** (Claude Desktop, Cursor, Claude Code): `check` (allowed or a reason code), `explain_refusal` (plain words and which limit
  to change) and `pay_through_safe` (an agent key pays through AgentExecutorV3; refused payments are never sent). Build with
  `cd mcp && npm ci && npm run build`, then point the client at `node mcp/dist/server.mjs` ([mcp/README.md](mcp/README.md)). Tried on the demo
  Safe: [`0x33ad40b8…6dd0a9`](https://www.oklink.com/x-layer/tx/0x33ad40b85771b96fb7237b65351f5f87c5b790607e87869d41feb067df6dd0a9) (0.05 USDT0 paid through the OKX Agentic Wallet).

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


## Licence

MIT. No independent security review yet: see [docs/security.md](docs/security.md).
