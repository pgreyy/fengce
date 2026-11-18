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
| [wallet-kernel](#wallet-kernel) | fork-tested | X Layer mainnet fork (live Kernel v3.3 code) | v2 |
| [wallet-nexus](#wallet-nexus) | fork-tested | X Layer mainnet fork with Nexus code from Base | v2 |
| [wallet-etherspot](#wallet-etherspot) | fork-tested | X Layer mainnet fork with Etherspot code from Base | v2 |
| [wallet-mav2](#wallet-mav2) | fork-tested | X Layer mainnet fork (live Modular Account v2 code) | v2 |
| [wallet-7702](#wallet-7702) | fork-tested | X Layer mainnet fork (live SemiModularAccount7702) | v2 |
| [wallet-coinbase](#wallet-coinbase) | fork-tested | X Layer mainnet fork with Coinbase Smart Wallet code from Base | v2 |
| [wallet-safe7579](#wallet-safe7579) | fork-tested | X Layer mainnet fork with Safe7579 code from Base | v2 |

## binds-owners

Owner transactions are checked by the circuit, not only agent keys: FengceGuard is the Safe's transaction guard.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_ownerSend150Blocked](../test/FengceGuard.t.sol#L32)
- [test_ownerSend50Passes](../test/FengceGuard.t.sol#L27)
- [demo Safe: setGuard (mainnet)](https://www.oklink.com/x-layer/tx/0x020f676574b4120184690ca528f09cfe98d020c4a1344d9536a9100da6d507b6)

## enforced-at-execution

The wallet runs the check while executing the transaction; a denied call does not execute.

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v2

- [1.5 USDT0 agent transfer denied](https://www.oklink.com/x-layer/tx/0x9b70d386a2782e269ab1d3b1df6de767534a5b5b7904998abd92a651d2584a1b)
- [0.5 USDT0 agent transfer allowed](https://www.oklink.com/x-layer/tx/0x7a70f5c9713fd9236ecdd81287bcf775253d2cbea19c857524bb1047acfcccab)
- [test_moduleSend150Blocked](../test/FengceGuard.t.sol#L37)

## no-quiet-swap

The policy and the guard cannot be changed quietly: changes wait for a public admin timelock (at least 1 day); removing the guard needs every owner and at least a 2-day recovery delay.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_guardRemovalWithoutScheduleBlocked](../test/FengceGuard.t.sol#L55)
- [test_guardSwapNeedsRecovery](../test/FengceBatchB.t.sol#L52)
- [test_twoOwnerSafe_oneSignatureCannotScheduleRecovery](../test/FengceBatchB.t.sol#L86)
- [test_zeroAndBelowFloorDelaysRevert](../test/FengceLimits.t.sol#L20)
- [demo Safe configure: admin 1 day, recovery 2 days (mainnet)](https://www.oklink.com/x-layer/tx/0xd403811630963a741592020823c122fd250c8ad01b34df55356e43d138531e8b)

## verifiable

Other contracts can verify that an account is bound to a policy with a minimum notice period (FengceBinding.isBound, BoundOnly).

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_boundSafeDeposits](../test/FengceBinding.t.sol#L43)
- [test_pendingChangeInsideNoticeWindowFails](../test/FengceBinding.t.sol#L55)
- [FengceBinding v2 on Sourcify](https://repo.sourcify.dev/196/0x20157A63Df8ab6728698630E38f6d7683Ca6b6F8)

## tapeout-circuit

The rule is a TapeOut circuit on X Layer, pinned by content (netlist, every referenced circuit, the evaluator).

Status: **mainnet** · Network: X Layer mainnet (196) · Release: v2

- [pin of the NAND policy (mainnet)](https://www.oklink.com/x-layer/tx/0x7edc0878f7bdb77f1c7b1a2fa7dec42ebec4adf68ee756d1d56e6b0ce543f7eb)
- [Catalog listing, vectors run on chain (mainnet)](https://www.oklink.com/x-layer/tx/0x0d964b58f374da96d8d6d4f457a207c64b4797b99a7412e80baff0df175b8ead)
- [test_fork_pinAndEvaluateNand](../test/PinNand.t.sol#L16)
- [test_pinNestedRefCircuit](../test/fork/RefClosure.t.sol#L38)

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
- [live status page](https://getfengce.vercel.app/safe/)

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

- [test_multiSendHiding150Blocked_40plus40Passes](../test/FengceGuard.t.sol#L42)

## outcome-check

FengceInspector checks the outcome after execution: an undecoded drain past the cap, or an unexpected Safe configuration change, reverts the transaction.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_undecodedDrainPastCapDeniedAfterExecution](../test/FengceInspector.t.sol#L83)
- [test_unexpectedThresholdChangeDenied](../test/FengceInspector.t.sol#L98)

## floors

Organisation floors: a team policy must also pass the floor; removing a floor needs the floor owner and a timelock.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_teamAllows150ButFloorDenies](../test/FengceFloors.t.sol#L62)
- [test_removingFloorNeedsFloorOwnerAndTimelock](../test/FengceFloors.t.sol#L79)

## budgets

Budgets per period across several Safes (Tick): two Safes in one group share one cap; an agent cannot skip it.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_twoSafesInOneGroupShareOneCap](../test/FengceTickGuard.t.sol#L89)
- [test_agentCannotSkipTick](../test/FengceTickGuard.t.sol#L67)

## approvals

Approvals are policy-checked too: Permit2, increaseAllowance and NFT approvals; existing allowances are found before install.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_permit2ApproveOverLimitBlocked](../test/FengceApprovals.t.sol#L80)
- [test_increaseAllowanceTwiceCrossingLimitBlocked](../test/FengceApprovals.t.sol#L72)
- [test_preflightCatchesExistingAllowance](../test/FengceBatchB.t.sol#L130)

## signatures

Off-chain signed approvals (Permit2, EIP-2612) through the Safe are checked by the same policy.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_permit2PermitSingleOverLimitFails_underLimitPasses](../test/FengceSignatures.t.sol#L103)

## swaps

Trading rules: swaps through supported routers are decoded; over-cap swaps and swaps paying out to another recipient are denied.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_swapOverCapDenied](../test/FengceDecoders.t.sol#L92)
- [test_swapToAnotherRecipientDenied](../test/FengceDecoders.t.sol#L87)

## agent-executor

Agents act only through AgentExecutor, which refuses to act unless the Fengce module guard is installed; any owner can revoke an agent.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_agentGoesThroughCircuit_overLimitBlocked](../test/AgentExecutor.t.sol#L30)
- [test_refusesWithoutFengceModuleGuard](../test/AgentExecutor.t.sol#L58)
- [test_ownerRevokesAgent](../test/AgentExecutor.t.sol#L45)

## fail-closed

If the circuit reverts or its pin breaks, the guard denies (fails closed); owners can still recover through the timelocked recovery.

Status: **fork-tested** · Network: X Layer mainnet fork · Release: v2

- [test_recoveryWorksWhenCircuitReverts](../test/FengceGuard.t.sol#L60)

## trace-equals-eval

The app's gate-by-gate evaluation (SDK evaluateTrace) equals the processor's on-chain eval (NAND #2, comparator #7).

Status: **mainnet** · Network: X Layer mainnet (196), read-only · Release: n/a

- [check script](../sdk/scripts/trace-check.ts)

## app-client-side

The app reads X Layer from the browser; its pages make no server calls.

Status: **documented** · Network: X Layer mainnet (196), read-only · Release: v2

- [live app](https://getfengce.vercel.app)
- [chain client](../app/src/lib/chain.ts)

## wallet-kernel

ZeroDev Kernel v3.3: FengceHook blocks over-limit transfers and hidden batches; uninstall waits 2 days; validator and root changes are timelocked admin actions.

Status: **fork-tested** · Network: X Layer mainnet fork (live Kernel v3.3 code) · Release: v2

- [test_kernelOverLimitBlocked](../test/wallets/FengceKernel.t.sol#L78)
- [test_kernelBatchHidingOverLimitBlocked](../test/wallets/FengceKernel.t.sol#L85)
- [test_kernelHookUninstall](../test/wallets/FengceKernel.t.sol#L93)
- [test_kernelValidatorChangesTimelocked](../test/wallets/FengceKernel.t.sol#L109)

## wallet-nexus

Biconomy Nexus 1.2.0: FengceHook blocks over-limit transfers and hidden batches; uninstall waits 2 days.

Status: **fork-tested** · Network: X Layer mainnet fork with Nexus code from Base · Release: v2

- [test_nexusOverLimitBlocked](../test/wallets/FengceNexus.t.sol#L51)
- [test_nexusBatchHidingOverLimitBlocked](../test/wallets/FengceNexus.t.sol#L59)
- [test_nexusHookUninstall](../test/wallets/FengceNexus.t.sol#L68)

## wallet-etherspot

Etherspot modular wallet: FengceHook blocks over-limit transfers and hidden batches; known gap: uninstall does not run the hook.

Status: **fork-tested** · Network: X Layer mainnet fork with Etherspot code from Base · Release: v2

- [test_etherspotOverLimitBlocked](../test/wallets/FengceEtherspot.t.sol#L44)
- [test_etherspotBatchHidingOverLimitBlocked](../test/wallets/FengceEtherspot.t.sol#L52)
- [test_etherspotSkipsHookOnUninstall](../test/wallets/FengceEtherspot.t.sol#L62)

## wallet-mav2

Alchemy Modular Account v2: FengceHook6900 blocks over-limit transfers and hidden batches; uninstall and upgrade wait 2 days.

Status: **fork-tested** · Network: X Layer mainnet fork (live Modular Account v2 code) · Release: v2

- [test_mav2OverLimitBlocked](../test/wallets/FengceModularAccountV2.t.sol#L45)
- [test_mav2BatchHidingOverLimitBlocked](../test/wallets/FengceModularAccountV2.t.sol#L67)
- [test_mav2HookUninstall](../test/wallets/FengceModularAccountV2.t.sol#L83)

## wallet-7702

EIP-7702: agents of a delegated EOA pass the circuit; the EOA key itself is not restricted.

Status: **fork-tested** · Network: X Layer mainnet fork (live SemiModularAccount7702) · Release: v2

- [test_7702AgentGoesThroughCircuitOwnerKeyDoesNot](../test/wallets/Fengce7702.t.sol#L52)

## wallet-coinbase

Coinbase Smart Wallet: agents act through FengceAgentOwner and are checked; owners are not.

Status: **fork-tested** · Network: X Layer mainnet fork with Coinbase Smart Wallet code from Base · Release: v2

- [test_coinbaseAgentThroughCircuit](../test/wallets/FengceAgentOwner.t.sol#L47)

## wallet-safe7579

Safe + Safe7579: FengceHook blocks over-limit and hidden batches; known gap: Safe7579 skips the hook on its own uninstall; module changes are timelocked on four routes.

Status: **fork-tested** · Network: X Layer mainnet fork with Safe7579 code from Base · Release: v2

- [test_7579AccountBlockedOverLimit](../test/FengceHook7579.t.sol#L86)
- [test_7579BatchHiding150Blocked](../test/FengceHook7579.t.sol#L99)
- [test_safe7579SkipsHookOnItsOwnUninstall](../test/FengceHook7579.t.sol#L119)
