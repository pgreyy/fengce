# Claims and evidence

Every claim in the [README](../README.md), with its status, network, release and a direct link to the source file, test,
transaction or verification record that backs it. Machine-readable copy: [claims.json](claims.json).

Statuses: **mainnet** (a transaction or state on X Layer mainnet), **verified** (a Sourcify record), **ci** (a CI run of
the release commit), **fork-tested** (a test against live X Layer mainnet state on a local fork), **documented** (a
property of the code or setup). Test links point at the test function in this repository; CI runs show them passing.

| Claim | Status | Network | Release |
|---|---|---|---|
| [binds-owners](#binds-owners) | fork-tested | X Layer mainnet fork | v2 |
| [enforced-at-execution](#enforced-at-execution) | mainnet | X Layer mainnet (196) | v2 |
| [no-quiet-swap](#no-quiet-swap) | fork-tested | X Layer mainnet fork | v2 |
| [verifiable](#verifiable) | fork-tested | X Layer mainnet fork | v2 |
| [tapeout-circuit](#tapeout-circuit) | mainnet | X Layer mainnet (196) | v2 |
| [demo-denied](#demo-denied) | mainnet | X Layer mainnet (196) | v2 |
| [demo-allowed](#demo-allowed) | mainnet | X Layer mainnet (196) | v2 |
| [demo-safe](#demo-safe) | mainnet | X Layer mainnet (196) | v2 |
| [v1-demo](#v1-demo) | mainnet | X Layer mainnet (196) | v1 |
| [tests-112](#tests-112) | ci | CI (fork tests against X Layer mainnet state) | v2 |
| [sourcify-18](#sourcify-18) | verified | X Layer mainnet (196) | v2 |
| [slither](#slither) | ci | CI | v2 |
| [install-count](#install-count) | mainnet | X Layer mainnet (196) | v2 |
| [batches](#batches) | fork-tested | X Layer mainnet fork | v2 |
| [outcome-check](#outcome-check) | fork-tested | X Layer mainnet fork | v2 |
| [floors](#floors) | fork-tested | X Layer mainnet fork | v2 |
| [budgets](#budgets) | fork-tested | X Layer mainnet fork | v2 |
| [approvals](#approvals) | fork-tested | X Layer mainnet fork | v2 |
| [signatures](#signatures) | fork-tested | X Layer mainnet fork | v2 |
| [swaps](#swaps) | fork-tested | X Layer mainnet fork | v2 |
| [agent-executor](#agent-executor) | fork-tested | X Layer mainnet fork | v2 |
| [fail-closed](#fail-closed) | fork-tested | X Layer mainnet fork | v2 |
| [trace-equals-eval](#trace-equals-eval) | mainnet | X Layer mainnet (196), read-only | n/a |
| [app-client-side](#app-client-side) | documented | X Layer mainnet (196), read-only | v2 |
| [mcp-read-only](#mcp-read-only) | documented | X Layer mainnet (196), read-only | v2 |
| [agent-demo-fork](#agent-demo-fork) | fork-tested | X Layer mainnet fork | v2 |
| [preflight-own-policy](#preflight-own-policy) | mainnet | X Layer mainnet (196), read-only | v2 |
| [deweb-hosted](#deweb-hosted) | mainnet | X Layer mainnet (196) | v2 |
| [delegatecall-blocked](#delegatecall-blocked) | fork-tested | X Layer mainnet fork | v2 |
| [no-prompt-input](#no-prompt-input) | documented | n/a | v2 |
| [incident-sources](#incident-sources) | documented | n/a | n/a |
| [wallet-types-4](#wallet-types-4) | fork-tested | X Layer mainnet fork (Safe also on X Layer mainnet) | v2 |
| [wallet-mav2](#wallet-mav2) | fork-tested | X Layer mainnet fork (live Modular Account v2 code) | v2 |
| [wallet-7702](#wallet-7702) | fork-tested | X Layer mainnet fork (live SemiModularAccount7702) | v2 |
| [wallet-coinbase](#wallet-coinbase) | fork-tested | X Layer mainnet fork with Coinbase Smart Wallet code from Base | v2 |
| [v3-deployed](#v3-deployed) | verified | X Layer mainnet (196) | v3 |
| [v3-max-per-buy](#v3-max-per-buy) | mainnet | X Layer mainnet (196) | v3 |
| [v3-tilt-shield](#v3-tilt-shield) | mainnet | X Layer mainnet (196) | v3 |
| [v3-agent-cap](#v3-agent-cap) | mainnet | X Layer mainnet (196) | v3 |
| [setup-one-signature](#setup-one-signature) | mainnet | X Layer mainnet (196) | v3 |
| [catalog-install-mainnet](#catalog-install-mainnet) | mainnet | X Layer mainnet (196) | v3 |
| [build-your-own-mainnet](#build-your-own-mainnet) | mainnet | X Layer mainnet (196) | v3 |
| [import-any-circuit](#import-any-circuit) | fork-tested | X Layer mainnet fork | v3 |
| [templates](#templates) | fork-tested | X Layer mainnet fork | v3 |
| [v3-hold-lock](#v3-hold-lock) | mainnet | X Layer mainnet (196) | v3 |
| [v3-quiet-hours](#v3-quiet-hours) | mainnet | X Layer mainnet (196) | v3 |

## binds-owners

Owner transactions are checked by the circuit, not only agent keys: FengceGuard is the Safe's transaction guard.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_ownerSend150Blocked](../contracts/test/FengceGuard.t.sol#L32)
- [test_ownerSend50Passes](../contracts/test/FengceGuard.t.sol#L27)
- [demo Safe: setGuard (mainnet)](https://www.oklink.com/x-layer/tx/0x020f676574b4120184690ca528f09cfe98d020c4a1344d9536a9100da6d507b6)

## enforced-at-execution

The wallet runs the check while executing the transaction; a denied call does not execute.

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v2

- [1.5 USDT0 agent transfer denied](https://www.oklink.com/x-layer/tx/0x9b70d386a2782e269ab1d3b1df6de767534a5b5b7904998abd92a651d2584a1b)
- [0.5 USDT0 agent transfer allowed](https://www.oklink.com/x-layer/tx/0x7a70f5c9713fd9236ecdd81287bcf775253d2cbea19c857524bb1047acfcccab)
- [test_moduleSend150Blocked](../contracts/test/FengceGuard.t.sol#L37)

## no-quiet-swap

The policy and the guard cannot be changed quietly: changes wait for a public admin timelock (at least 1 day); removing the guard needs every owner and at least a 2-day recovery delay.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_guardRemovalWithoutScheduleBlocked](../contracts/test/FengceGuard.t.sol#L55)
- [test_guardSwapNeedsRecovery](../contracts/test/FengceBatchB.t.sol#L52)
- [test_twoOwnerSafe_oneSignatureCannotScheduleRecovery](../contracts/test/FengceBatchB.t.sol#L86)
- [test_zeroAndBelowFloorDelaysRevert](../contracts/test/FengceLimits.t.sol#L20)
- [demo Safe configure: admin 1 day, recovery 2 days (mainnet)](https://www.oklink.com/x-layer/tx/0xd403811630963a741592020823c122fd250c8ad01b34df55356e43d138531e8b)

## verifiable

Other contracts can verify that an account is bound to a policy with a minimum notice period (FengceBinding.isBound, BoundOnly).

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_boundSafeDeposits](../contracts/test/FengceBinding.t.sol#L43)
- [test_pendingChangeInsideNoticeWindowFails](../contracts/test/FengceBinding.t.sol#L55)
- [FengceBinding v2 on Sourcify](https://repo.sourcify.dev/196/0x20157A63Df8ab6728698630E38f6d7683Ca6b6F8)

## tapeout-circuit

The rule is a TapeOut circuit on X Layer, pinned by content (netlist, every referenced circuit, the evaluator).

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v2

- [pin of the NAND policy (mainnet)](https://www.oklink.com/x-layer/tx/0x7edc0878f7bdb77f1c7b1a2fa7dec42ebec4adf68ee756d1d56e6b0ce543f7eb)
- [Catalog listing, vectors run on chain (mainnet)](https://www.oklink.com/x-layer/tx/0x0d964b58f374da96d8d6d4f457a207c64b4797b99a7412e80baff0df175b8ead)
- [test_fork_pinAndEvaluateNand](../contracts/test/PinNand.t.sol#L16)
- [test_pinNestedRefCircuit](../contracts/test/fork/RefClosure.t.sol#L38)

## demo-denied

v2 demo: an agent's 1.5 USDT0 transfer over a 1 USDT0 cap was denied and recorded as Denied (FengceDenied).

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v2

- [transaction](https://www.oklink.com/x-layer/tx/0x9b70d386a2782e269ab1d3b1df6de767534a5b5b7904998abd92a651d2584a1b)

## demo-allowed

v2 demo: the same agent's 0.5 USDT0 transfer passed.

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v2

- [transaction](https://www.oklink.com/x-layer/tx/0x7a70f5c9713fd9236ecdd81287bcf775253d2cbea19c857524bb1047acfcccab)

## demo-safe

The v2 demo Safe uses the v2 FengceGuard as transaction guard and module guard, with AgentExecutor and one agent.

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v2

- [demo Safe](https://www.oklink.com/x-layer/address/0x0bb926DC7F79e4CEFFB30a67E8291C56C3F50707)
- [setGuard](https://www.oklink.com/x-layer/tx/0x020f676574b4120184690ca528f09cfe98d020c4a1344d9536a9100da6d507b6)
- [setModuleGuard](https://www.oklink.com/x-layer/tx/0xae4ceb7298936b5f8608ff4344044ff8765cb790f8b1dc11f415ad8b697264ef)
- [addAgent](https://www.oklink.com/x-layer/tx/0xb83e3f771c21034dcdf2bdddc5e4784eca24164ddef432e152fefd1a3c989d60)
- [live status page](https://fengce.greyy.cc/wallet/)

## v1-demo

v1 demo (previous release): 0.5 USDT0 allowed, 1.5 USDT0 denied.

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v1

- [0.5 allowed](https://www.oklink.com/x-layer/tx/0x6797257c0ea35fe0ec7b2d80f3bd29275a172e52286f9dbff96fc98e81f05e38)
- [1.5 denied](https://www.oklink.com/x-layer/tx/0xbfe43e982f563f9e3dc1a4641e259b04ace0635dfab769c59ec7532492e24760)

## tests-112

112 tests pass in CI for the v2 release commit e260a37: 44 unit, 53 core and Safe fork tests, 15 wallet fork tests.

Status: **ci** · Network: CI (fork tests against X Layer mainnet state) · Release: v2

- [CI run for e260a37](https://github.com/pgreyy/fengce/actions/runs/44346520788)
- [workflow](../.github/workflows/ci.yml)

## sourcify-18

All 18 v2 contracts are verified on Sourcify with exact matches (runtime and creation bytecode).

Status: **verified** · Network: X Layer mainnet (196) · Release: v2

- [AaveV3PoolDecoder on Sourcify](https://repo.sourcify.dev/196/0x8007856430d5A6a22D3de3a4d9b70582A7097f89)
- [AgentExecutor on Sourcify](https://repo.sourcify.dev/196/0xc01b590227149169260e030235b78d6e034E590c)
- [BoundVault on Sourcify](https://repo.sourcify.dev/196/0xbf76fC88e16fD18f87992f1927Aa31a713263e41)
- [Catalog on Sourcify](https://repo.sourcify.dev/196/0x26C5437428cdD7e4854614DC5DDEFE2776B51dFe)
- [FengceAgentOwner on Sourcify](https://repo.sourcify.dev/196/0xd857d1850684aC80E7DDa4ab52ea6E1B1CB0aD21)
- [FengceBinding on Sourcify](https://repo.sourcify.dev/196/0x20157A63Df8ab6728698630E38f6d7683Ca6b6F8)
- [FengceFloors on Sourcify](https://repo.sourcify.dev/196/0xD842C5B9EdDdd218d2Dbe91c3911934DdA7Ff7D4)
- [FengceGuard on Sourcify](https://repo.sourcify.dev/196/0x9D2A482fFA86fa3193F85c451A44576E2f1C8E6e)
- [FengceHook on Sourcify](https://repo.sourcify.dev/196/0xE538979145E67935B85D1912904ce8d5bF19669b)
- [FengceHook6900 on Sourcify](https://repo.sourcify.dev/196/0xAf481abCb80A73C9c300f16aAF1b61BcAaC3BEA5)
- [FengceInspector on Sourcify](https://repo.sourcify.dev/196/0xdeA3e3C305460247686c3EEeAe6552F33D98EE1A)
- [FengceSignatureVerifier on Sourcify](https://repo.sourcify.dev/196/0x81f073BF271230B832aC375ed786373Af75b5B19)
- [FengceStrictHandler on Sourcify](https://repo.sourcify.dev/196/0x846bBD554F31865C9A1301D325D73973A1F884cb)
- [PinRegistry on Sourcify](https://repo.sourcify.dev/196/0xD905dde3A09a9777B98013AD196E3b3F988e3715)
- [PolicyEngine on Sourcify](https://repo.sourcify.dev/196/0x2264B97828454374a56D7407f859fEA6eE7dFAA9)
- [Tick on Sourcify](https://repo.sourcify.dev/196/0xFEb6FD15F8724bfC69a119C0448f480a7D7e5370)
- [UniswapV2RouterDecoder on Sourcify](https://repo.sourcify.dev/196/0x34140a552Aa2c23256B4a3C760257A8CD8f88124)
- [UniswapV3RouterDecoder on Sourcify](https://repo.sourcify.dev/196/0x47FDb3C6E91661562243f97Df2f4b0B8EfFAA479)

## slither

Slither reports 0 High findings for the v2 commit. This is static analysis, not an audit.

Status: **ci** · Network: CI · Release: v2

- [Slither run for e260a37](https://github.com/pgreyy/fengce/actions/runs/44346519214)
- [workflow](../.github/workflows/slither.yml)

## install-count

The Catalog's Stablecoin Transfer Limit has 1 install: the demo Safe's Configured event.

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v2

- [configure transaction](https://www.oklink.com/x-layer/tx/0xd403811630963a741592020823c122fd250c8ad01b34df55356e43d138531e8b)
- [event snapshot](../app/public/events-snapshot.json)

## batches

A batch that hides an over-limit transfer is denied; each call in it is checked.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_multiSendHiding150Blocked_40plus40Passes](../contracts/test/FengceGuard.t.sol#L42)

## outcome-check

FengceInspector checks the outcome after execution: an undecoded drain past the cap, or an unexpected Safe configuration change, reverts the transaction.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_undecodedDrainPastCapDeniedAfterExecution](../contracts/test/FengceInspector.t.sol#L83)
- [test_unexpectedThresholdChangeDenied](../contracts/test/FengceInspector.t.sol#L98)

## floors

Organisation floors: a team policy must also pass the floor; removing a floor needs the floor owner and a timelock.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_teamAllows150ButFloorDenies](../contracts/test/FengceFloors.t.sol#L62)
- [test_removingFloorNeedsFloorOwnerAndTimelock](../contracts/test/FengceFloors.t.sol#L79)

## budgets

Budgets per period across several Safes (Tick): two Safes in one group share one cap; an agent cannot skip it.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_twoSafesInOneGroupShareOneCap](../contracts/test/FengceTickGuard.t.sol#L89)
- [test_agentCannotSkipTick](../contracts/test/FengceTickGuard.t.sol#L67)

## approvals

Approvals are policy-checked too: Permit2, increaseAllowance and NFT approvals; existing allowances are found before install.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_permit2ApproveOverLimitBlocked](../contracts/test/FengceApprovals.t.sol#L80)
- [test_increaseAllowanceTwiceCrossingLimitBlocked](../contracts/test/FengceApprovals.t.sol#L72)
- [test_preflightCatchesExistingAllowance](../contracts/test/FengceBatchB.t.sol#L130)

## signatures

Off-chain signed approvals (Permit2, EIP-2612) through the Safe are checked by the same policy.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_permit2PermitSingleOverLimitFails_underLimitPasses](../contracts/test/FengceSignatures.t.sol#L103)

## swaps

Trading rules: swaps through supported routers are decoded; over-cap swaps and swaps paying out to another recipient are denied.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_swapOverCapDenied](../contracts/test/FengceDecoders.t.sol#L92)
- [test_swapToAnotherRecipientDenied](../contracts/test/FengceDecoders.t.sol#L87)

## agent-executor

Agents act only through AgentExecutor, which refuses to act unless the Fengce module guard is installed; any owner can revoke an agent.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_agentGoesThroughCircuit_overLimitBlocked](../contracts/test/AgentExecutor.t.sol#L30)
- [test_refusesWithoutFengceModuleGuard](../contracts/test/AgentExecutor.t.sol#L58)
- [test_ownerRevokesAgent](../contracts/test/AgentExecutor.t.sol#L45)

## fail-closed

If the circuit reverts or its pin breaks, the guard denies (fails closed); owners can still recover through the timelocked recovery.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_recoveryWorksWhenCircuitReverts](../contracts/test/FengceGuard.t.sol#L60)

## trace-equals-eval

The app's gate-by-gate evaluation (SDK evaluateTrace) equals the processor's on-chain eval (NAND #2, comparator #7).

Status: **mainnet** · Network: X Layer mainnet (196), read-only · Release: n/a

- [check script](../sdk/scripts/trace-check.ts)

## app-client-side

The app reads X Layer from the browser; its pages make no server calls.

Status: **documented** · Network: X Layer mainnet (196), read-only · Release: v2

- [live app](https://fengce.greyy.cc)
- [chain client](../app/src/lib/chain.ts)

## mcp-read-only

The Fengce MCP server's six tools (list_policies, get_policy, quote_policy, simulate_transaction, preflight_transaction, build_install_payload) answer from live X Layer mainnet; none signs or sends, and build_install_payload returns an unsigned payload.

Status: **documented** · Network: X Layer mainnet (196), read-only · Release: v2

- [server source](../mcp/src/server.ts)
- [live check of every tool](../mcp/scripts/call-tools.mts)
- [setup](../mcp/README.md)

## agent-demo-fork

Agent demo: Fengce answers DENIED for 1.5 USDT0 and ALLOWED for 0.5 USDT0 from the v2 demo Safe; submitted through AgentExecutor, the wallet refuses the first (Denied) and executes the second.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [demo script](../mcp/demo/agent-demo.mts)
- [transcript](../docs/demo/agent-demo-transcript.md)
- [the same two transfers on mainnet: denied](https://www.oklink.com/x-layer/tx/0x9b70d386a2782e269ab1d3b1df6de767534a5b5b7904998abd92a651d2584a1b)
- [allowed](https://www.oklink.com/x-layer/tx/0x7a70f5c9713fd9236ecdd81287bcf775253d2cbea19c857524bb1047acfcccab)

## preflight-own-policy

Preflight checks a transaction against the policy actually installed on a Safe (its FengceGuard's checkContext, view only): 1.5 USDT0 from the v2 demo Safe returns deny with FengceDenied, 0.5 returns allow.

Status: **mainnet** · Network: X Layer mainnet (196), read-only · Release: v2

- [implementation](../app/src/lib/data.ts)
- [API function](../app/api-src/preflight.ts)
- [OpenAPI](../docs/openapi.yaml)

## deweb-hosted

The app is hosted on TapeOut DeWeb as 6.2.180.tape: its files are stored on X Layer in SiteRegistry under the container of circuit #6 on processor #180, each with its SHA-256, and the name is paid on DomainBinding until 2036.

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v2

- [container (opened)](https://www.oklink.com/x-layer/address/0xd136c115B2B6dB3179d240503834dE785bF29BB2)
- [open container](https://www.oklink.com/x-layer/tx/0x0a91b7f00fbe6672946a729a6caa0a0e8fb4b72fa8c503bfab1f339b7b727427)
- [SiteRegistry putFile index.html](https://www.oklink.com/x-layer/tx/0xab30bef87a3147e0649bb73ddebb9a7a81c6ecf85509690c3bd22556c53f5ee6)
- [SiteRegistry setFallback](https://www.oklink.com/x-layer/tx/0x69246117dadf1df6b54a61bec16ac6016c890e4095d507785f87929757a649ef)
- [DomainBinding bind 6.2.180.tape](https://www.oklink.com/x-layer/tx/0x08dbe4406210c5d4e966a1fed75505984006f0d80b61b1a9ec9cfafcf579bc41)
- [tape-out of circuit #6](https://www.oklink.com/x-layer/tx/0x7d9d35aee1d036ea695408420934034f0f1c6f5d73d643b29565360be6504a9f)
- [record](../deployments/deweb-xlayer-196.json)
- [TAP-10 resolution and SHA-256 check](../app/scripts/deweb-check.mts)
- [gateway](https://6-2-180.tapekit.org/)

## delegatecall-blocked

FengceGuard refuses owner delegatecalls to anything but MultiSendCallOnly, so a signed contract upgrade like the Bybit one reverts and the Safe singleton stays unchanged.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_ownerDelegatecallUpgradeBlocked](../contracts/test/FengceGuard.t.sol#L66)
- [FengceGuard delegatecall rule](../contracts/src/safe/FengceGuard.sol#L317)

## no-prompt-input

The circuit's inputs are facts decoded from the transaction itself (recipient, token, amount, kind) and pinned constants; no prompt or agent instruction reaches it.

Status: **documented** · Network: n/a · Release: v2

- [TxFacts.Facts (the policy context)](../contracts/src/core/TxFacts.sol#L68)
- [docs/POLICY-INTERFACE.md](../docs/POLICY-INTERFACE.md)
- [v2 demo: agent's 1.5 USDT0 denied (mainnet)](https://www.oklink.com/x-layer/tx/0x9b70d386a2782e269ab1d3b1df6de767534a5b5b7904998abd92a651d2584a1b)

## incident-sources

The four incidents in Why Fengce (Binance, Bybit, Freysa, AIXBT) are described from public reports; losses and dates are as those reports state.

Status: **documented** · Network: n/a · Release: n/a

- [Binance](https://socradar.io/blog/binance-hack-6-3b-hot-wallet-theft/)
- [Bybit](https://blocksec.com/blog/bybit-incident-a-web2-breach-enables-the-largest-crypto-hack-in-history)
- [Freysa](https://www.theblock.co/post/328747/human-player-outwits-freysa-ai-agent-in-47000-crypto-challenge)
- [AIXBT](https://www.theblock.co/post/346911/ai-crypto-bot-aixbt-lost-eth-hack-unauthorized-dashboard-access)

## wallet-types-4

Adapters have a passing test on 4 wallet types. Only Safe makes the limits permanent: FengceGuard is its transaction and module guard, and any change waits on a timelock. The other three use a hook or an extra owner that the account owner can remove: Modular Account v2 (enforced through a hook), and EIP-7702 (SemiModularAccount7702) and Coinbase Smart Wallet (agents only).

Status: **fork-tested** · Network: X Layer mainnet fork (Safe also on X Layer mainnet) · Release: v2

- Safe v1.5.0: [test_ownerSend150Blocked](../contracts/test/FengceGuard.t.sol#L32)
- Alchemy Modular Account v2 (ERC-6900): [test_mav2OverLimitBlocked](../contracts/test/wallets/FengceModularAccountV2.t.sol#L45)
- EIP-7702 EOA (SemiModularAccount7702): [test_7702AgentGoesThroughCircuitOwnerKeyDoesNot](../contracts/test/wallets/Fengce7702.t.sol#L52)
- Coinbase Smart Wallet v1.1: [test_coinbaseAgentThroughCircuit](../contracts/test/wallets/FengceAgentOwner.t.sol#L47)
- [list with status per wallet](WALLETS.md#wallet-types-with-a-tested-adapter-4)

## wallet-mav2

Alchemy Modular Account v2: FengceHook6900 blocks over-limit transfers and hidden batches; uninstall and upgrade wait 2 days.

Status: **fork-tested** · Network: X Layer mainnet fork (live Modular Account v2 code) · Release: v2

- [test_mav2OverLimitBlocked](../contracts/test/wallets/FengceModularAccountV2.t.sol#L45)
- [test_mav2BatchHidingOverLimitBlocked](../contracts/test/wallets/FengceModularAccountV2.t.sol#L67)
- [test_mav2HookUninstall](../contracts/test/wallets/FengceModularAccountV2.t.sol#L83)

## wallet-7702

EIP-7702: agents of a delegated EOA pass the circuit; the EOA key itself is not restricted.

Status: **fork-tested** · Network: X Layer mainnet fork (live SemiModularAccount7702) · Release: v2

- [test_7702AgentGoesThroughCircuitOwnerKeyDoesNot](../contracts/test/wallets/Fengce7702.t.sol#L52)

## wallet-coinbase

Coinbase Smart Wallet: agents act through FengceAgentOwner and are checked; owners are not.

Status: **fork-tested** · Network: X Layer mainnet fork with Coinbase Smart Wallet code from Base · Release: v2

- [test_coinbaseAgentThroughCircuit](../contracts/test/wallets/FengceAgentOwner.t.sol#L47)

## v3-deployed

FengceGuardV3, FengceRulesV3, AgentExecutorV3 and FengceSetupV3 are deployed on X Layer mainnet and verified on Sourcify (FengceGuardV3: match, runtime bytecode identical; the other three: exact match).

Status: **verified** · Network: X Layer mainnet (196) · Release: v3

- [FengceGuardV3 deploy](https://www.oklink.com/x-layer/tx/0xb13183b1c679e042570ee1f1e180dd5b37f5bab657713c46b43e29cc7e2f19f0)
- [FengceGuardV3 on Sourcify](https://repo.sourcify.dev/196/0x8f2Bee582260dF363AAfaE77cb2e1cdB63110941)
- [FengceRulesV3 on Sourcify](https://repo.sourcify.dev/196/0xbc07773b7a19b2a8e8f89adc97bde9d7752b1c2c)
- [AgentExecutorV3 on Sourcify](https://repo.sourcify.dev/196/0x3FFd99E3E2386C863fbcC16362aF233648D6695A)
- [FengceSetupV3 deploy](https://www.oklink.com/x-layer/tx/0xde11a35904a8a7928813e1eb3816555457e1a2b377bbee94c1438e8f54c1a00e)
- [FengceSetupV3 on Sourcify](https://repo.sourcify.dev/196/0x591E804770b0819AF1d3Ce14289215d1c3dC8dA3)

## v3-max-per-buy

Guard v3 on the demo Safe: a 0.2 USDT0 swap was allowed; a 3 USDT0 swap over the 2 USDT0 cap is refused with code 1 (CIRCUIT, NAND circuit #2), recorded on chain with recordRefusal.

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v3

- [allowed swap](https://www.oklink.com/x-layer/tx/0xafb795f9f4c86f301734f61e6f282bf3cc528125b8351c0858c6bfce2af217b6)
- [refusal recorded](https://www.oklink.com/x-layer/tx/0x78dd364b256c32b70eebbac717dd5c8ed7b5876def35ba6118be7a81d4021283)

## v3-tilt-shield

Tilt-shield on mainnet: four 0.2 USDT0 buys in the same half hour tripped it (counter circuit #7 and the Tilt-shield latch, through Tick); the next buy is refused with code 5 (TILT_SHIELD).

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v3

- [buy 1](https://www.oklink.com/x-layer/tx/0xf700d23ea538721ce771b2953ac76c340ec5e9ad8d701181a2e87fcb2c9d1f7e)
- [buy 2](https://www.oklink.com/x-layer/tx/0x5594edd982868806eb3b9418b6c86feddf76dbf583e3d046f1895262cbc9f3e7)
- [buy 3](https://www.oklink.com/x-layer/tx/0x8cbef6186d6cf148ae311bdcf112d5cf081668685f42a22efcef693f537b30be)
- [buy 4](https://www.oklink.com/x-layer/tx/0x26baa17ca5b743fdaefc6c2df186f96e8aa1eb738ec5b7b5f3126a5894fd0f70)
- [refusal recorded](https://www.oklink.com/x-layer/tx/0x52fa8d40882b75e6561a029afde8fc31a8498a911202253e3313e38959de0b2b)

## v3-agent-cap

An OKX Agentic Wallet agent paid 0.3 USDT0 through AgentExecutorV3 (allowed); paying 0.3 again went over its 0.5 USDT0 daily cap and was recorded as Denied with code 6 (AGENT_CAP); nothing moved.

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v3

- [allowed](https://www.oklink.com/x-layer/tx/0x4da52f34ca30b4dae4569bbbbf209b7f162bf5fa6e5632778824917f53ec3b1c)
- [denied](https://www.oklink.com/x-layer/tx/0xbde663dcf559fa162d1bf406836a84859f893dccd805fbac9cd92882c7d728ae)

## setup-one-signature

A Safe is created with guard v3 already installed in one transaction (Safe setup delegatecalls FengceSetupV3); the app's Create a new Safe uses it.

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v3

- [Safe created with guard v3](https://www.oklink.com/x-layer/tx/0xe2031beb8a5ccb08f58549ec785fa35ecdbf5b3fa06a8f8573b5059b73a9f4b8)
- [fork check of the app's calls](../app/scripts/install-create-fork.mts)

## catalog-install-mainnet

A Catalog circuit (Stablecoin Transfer Limit, circuit #2, free during launch) was installed on a second Safe: scheduled, approved early by its partner, applied; a 0.05 USDT0 send was allowed and a 0.5 USDT0 send is refused (code 1).

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v3

- [step 1: execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)](https://www.oklink.com/x-layer/tx/0x057763311385a7bc95a5056f02ff5534e77d08f5f42af991075ca4a4dc74506c)
- [step 2: partnerApprove(address,bytes32)](https://www.oklink.com/x-layer/tx/0xa82f6f146526c1ab0910a57ea2695581bc836978f6bd534544a7449e5256653b)
- [step 3: execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)](https://www.oklink.com/x-layer/tx/0xece1e4402a1d7b90b27e581540d8513b86b9d37972d23a885312ff58469cc977)
- [step 4: execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)](https://www.oklink.com/x-layer/tx/0x5c00b558cfc44d9a8ed82c4c474bcda5ff88ecd083fa88b3fbb2f3e01f1de811)
- [step 5: recordRefusal(address,address,uint256,bytes,uint8)](https://www.oklink.com/x-layer/tx/0xf72e45a6da4c61b8deb0250f5b72a68cc7bdeb1d4eef7aa36c76a1e3327948fd)

## build-your-own-mainnet

A circuit built as Limits -> Build your own builds it (4 NAND: refuse when over 0.1 USDT0 or paying USDC) was taped out as circuit #9 on processor #180, pinned and installed; a 0.05 USDT0 send was allowed and a 0.5 USDT0 send is refused (code 1).

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v3

- [step 1: mint(uint256,uint256)](https://www.oklink.com/x-layer/tx/0xd0b1493cd6973b1663febde9fcd3edc75437f5e8a9d1e717970ebb0f663e8c17)
- [step 2: tapeout(bytes,uint32,uint32)](https://www.oklink.com/x-layer/tx/0x0faa7132581b19d27b99bed91e4d6072e672997b26ca46dd0e5acd41153f613b)
- [step 3: pin(address,uint256,bytes32,bytes32)](https://www.oklink.com/x-layer/tx/0x99960f1119824d44c5ffff0d38f4c0181a84ae527ed666ad38c6f6366f191a50)
- [step 4: execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)](https://www.oklink.com/x-layer/tx/0x0be4db8fa6d9f58f123cddc7c7de552f8d98dd32fd8609778ebf2116a3fd67bb)
- [step 5: partnerApprove(address,bytes32)](https://www.oklink.com/x-layer/tx/0x5df6e22f76edb965e8c0ea92284690fec64b24e1c1db9438a4ae8e3661f0c06a)
- [step 6: execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)](https://www.oklink.com/x-layer/tx/0x60575269110199603a5215abc6aca1084316244e549043636a6a5febb7369a88)
- [step 7: execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)](https://www.oklink.com/x-layer/tx/0x01b9db8f71505d9a82615eca1fe069fe7308ea3ee007bcf55f51298a6dc2d1ba)
- [step 8: recordRefusal(address,address,uint256,bytes,uint8)](https://www.oklink.com/x-layer/tx/0x2046dca0cc95f97b3340b5d9c4b6f41abebc961627f2d4bcf101c92e5908f3eb)

## import-any-circuit

Any TapeOut circuit on X Layer can be imported: an unlisted circuit (1.2.131) mapped to guard facts is pinned and installed with guard v3 in one signature, and decides allow and refuse; a circuit with memory (2.2.364) is added through Tick at first install.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v3

- [import fork check](../app/scripts/import-fork.mts)
- [memory fork check](../app/scripts/import-stateful-fork.mts)

## templates

The Admin key guard and Vault templates install guard v3 on a new Safe in one signature; each was shown to allow one transaction and refuse one (Admin: a delegatecall to a contract other than MultiSendCallOnly, and adding an owner right away; Vault: a send over the cap).

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v3

- [templates fork check](../app/scripts/templates-fork.mts)

## v3-hold-lock

Hold lock on mainnet: with a 6-hour hold lock, a 0.05 USDT0 buy went through and selling it right away is refused with code 4 (HOLD_LOCK).

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v3

- [step 1](https://www.oklink.com/x-layer/tx/0xb6248ca7f44629c47f7f71752440ac3fe593912af35e7ef87d7b4ad3f486f660)
- [step 2](https://www.oklink.com/x-layer/tx/0xf0125accabbfb3b57adb4a3151ed30f814ee4c100b90acf77818cef6f9199f81)
- [step 3](https://www.oklink.com/x-layer/tx/0x3b1d2f6b7f8ce24fb910f2011d5377daa127eb413b81bdc3d1ddab12743e61d5)

## v3-quiet-hours

Quiet hours on mainnet: with quiet hours over the current UTC hour (a tightening, applied at once), a buy is refused with code 3 (QUIET_HOURS).

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v3

- [step 1](https://www.oklink.com/x-layer/tx/0xa382acff9721a59f3fc4a43dee0e13c23397d08ed4c45d36caa7b57bac4d36ea)
- [step 2](https://www.oklink.com/x-layer/tx/0x9e9115a971ee51146251464e5bebf527ebacd2dd91af35f17d11e24a9b1ce798)
