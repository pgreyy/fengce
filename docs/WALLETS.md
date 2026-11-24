# Wallet compatibility

Which smart wallets can host Fengce, through which adapter, and what each one guarantees. Machine-readable copy:
[wallets.json](wallets.json). Every status links to its evidence in [CLAIMS.md](CLAIMS.md).

All fork tests run on a fork of X Layer mainnet, because the policy circuits live on X Layer. For wallets that are not
deployed on X Layer, the test reads the canonical runtime code from a Base fork and places it at the same addresses on the
X Layer fork. Nothing from these wallets is stored in this repository. Items marked "from source" were read in the
wallet's code and are not covered by a test.

## Legend

- **Mainnet**: adapter deployed on X Layer mainnet and exercised there with real transactions.
- **Fork-tested**: adapter deployed on X Layer mainnet; behaviour proven by fork tests against live chain state.
- **Agent-only**: agents are checked; the wallet's own owner key or keys are not.
- **Partial**: pre-execution checks work, with a known way to remove the hook or skip the timelock.
- **Not integrated**: no adapter for this wallet.

Non-Safe hooks (FengceHook, FengceHook6900) still check every call before it executes. What they lack compared with a Safe
is the Safe configuration invariants (owners, threshold, modules, guards, fallback handler), which FengceInspector can only
read on Safe accounts; on other accounts it checks the outcome and the account's code hash.

## Wallet types with a tested adapter (8)

The app's "wallet types" figure counts these: every wallet in the matrix whose adapter has a passing test.
Alchemy MultiOwnerLightAccount v2 (agent-only, not tested) and the three not-integrated wallets are not counted. Claim:
[wallet-types-8](CLAIMS.md#wallet-types-8).

| # | Wallet | Status | Test |
|---|---|---|---|
| 1 | Safe v1.5.0 | **Mainnet** | [`test_ownerSend150Blocked`](../test/FengceGuard.t.sol#L32) in `test/FengceGuard.t.sol` (plus the v2 mainnet demo) |
| 2 | Safe + Safe7579 v1.0.0 | **Partial** | [`test_7579AccountBlockedOverLimit`](../test/FengceHook7579.t.sol#L86) in `test/FengceHook7579.t.sol` (admin routes: test/FengceSafe7579Admin.t.sol) |
| 3 | ZeroDev Kernel v3.3 | **Fork-tested** | [`test_kernelOverLimitBlocked`](../test/wallets/FengceKernel.t.sol#L78) in `test/wallets/FengceKernel.t.sol` |
| 4 | Biconomy Nexus 1.2.0 | **Partial** | [`test_nexusOverLimitBlocked`](../test/wallets/FengceNexus.t.sol#L51) in `test/wallets/FengceNexus.t.sol` |
| 5 | Etherspot ModularEtherspotWallet v1.0.0 | **Partial** | [`test_etherspotOverLimitBlocked`](../test/wallets/FengceEtherspot.t.sol#L44) in `test/wallets/FengceEtherspot.t.sol` |
| 6 | Alchemy Modular Account v2 (ERC-6900) | **Fork-tested** | [`test_mav2OverLimitBlocked`](../test/wallets/FengceModularAccountV2.t.sol#L45) in `test/wallets/FengceModularAccountV2.t.sol` |
| 7 | EIP-7702 EOA (SemiModularAccount7702) | **Agent-only** | [`test_7702AgentGoesThroughCircuitOwnerKeyDoesNot`](../test/wallets/Fengce7702.t.sol#L52) in `test/wallets/Fengce7702.t.sol` |
| 8 | Coinbase Smart Wallet v1.1 | **Agent-only** | [`test_coinbaseAgentThroughCircuit`](../test/wallets/FengceAgentOwner.t.sol#L47) in `test/wallets/FengceAgentOwner.t.sol` |

## Matrix

| Wallet | Status | Adapter (live on mainnet) | Test environment | Pre-execution check | Outcome check | Safe config invariants | Uninstall / admin protection | Agent-only | isBound | Known bypasses | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Safe v1.5.0 | **Mainnet** | FengceGuard (transaction guard and module guard): [`0x9D2A…8E6e`](https://www.oklink.com/x-layer/address/0x9D2A482fFA86fa3193F85c451A44576E2f1C8E6e) | X Layer mainnet; X Layer mainnet fork | yes | yes (FengceInspector) | yes (owners, threshold, modules, guards, fallback handler) | admin timelock (at least 1 day); guard removal only by recovery: all owners, at least 2 days | no | yes | none known | [enforced-at-execution](CLAIMS.md#enforced-at-execution), [binds-owners](CLAIMS.md#binds-owners), [no-quiet-swap](CLAIMS.md#no-quiet-swap), [outcome-check](CLAIMS.md#outcome-check), [verifiable](CLAIMS.md#verifiable) |
| Safe + Safe7579 v1.0.0 | **Partial** | FengceHook, with FengceGuard for Safe owner transactions: [`0xE538…669b`](https://www.oklink.com/x-layer/address/0xE538979145E67935B85D1912904ce8d5bF19669b) | X Layer mainnet fork with Safe7579 code from Base | yes | yes (FengceInspector, Safe-based) | yes (Safe-based) | module changes timelocked on four routes | no | no | Safe7579 does not run a hook on its own uninstall | [wallet-safe7579](CLAIMS.md#wallet-safe7579) |
| ZeroDev Kernel v3.3 | **Fork-tested** | FengceHook (root validation hook): [`0xE538…669b`](https://www.oklink.com/x-layer/address/0xE538979145E67935B85D1912904ce8d5bF19669b) | X Layer mainnet fork, live Kernel v3.3 code | yes | available (setInspector), not tested on Kernel | no (code hash only) | hook uninstall waits 2 days; validator, executor, fallback installs, root validator changes and upgrades are scheduled admin actions (2 days) | no | no | installing another hook is not checked; validations installed without FengceHook do not run it | [wallet-kernel](CLAIMS.md#wallet-kernel) |
| Biconomy Nexus 1.2.0 | **Partial** | FengceHook (global hook): [`0xE538…669b`](https://www.oklink.com/x-layer/address/0xE538979145E67935B85D1912904ce8d5bF19669b) | X Layer mainnet fork with Nexus code from Base | yes | available, not tested on Nexus | no (code hash only) | hook uninstall waits 2 days | no | no | emergencyUninstallHook (owner-signed, Nexus's own 1-day timelock) removes the hook without running it (from source, not tested) | [wallet-nexus](CLAIMS.md#wallet-nexus) |
| Etherspot ModularEtherspotWallet v1.0.0 | **Partial** | FengceHook (global hook): [`0xE538…669b`](https://www.oklink.com/x-layer/address/0xE538979145E67935B85D1912904ce8d5bF19669b) | X Layer mainnet fork with Etherspot code from Base | yes | available, not tested on Etherspot | no (code hash only) | none: uninstallModule does not run the hook | no | no | uninstallModule removes the hook at once | [wallet-etherspot](CLAIMS.md#wallet-etherspot) |
| Alchemy Modular Account v2 (ERC-6900) | **Fork-tested** | FengceHook6900 (execution hooks): [`0xAf48…BEA5`](https://www.oklink.com/x-layer/address/0xAf481abCb80A73C9c300f16aAF1b61BcAaC3BEA5) | X Layer mainnet fork, live Modular Account v2 code | yes | yes (FengceInspector wired in the test) | no (code hash only) | uninstall and account upgrade wait 2 days | no | no | performCreate with value 0 is allowed; other installs are not delayed | [wallet-mav2](CLAIMS.md#wallet-mav2) |
| EIP-7702 EOA (SemiModularAccount7702) | **Agent-only** | FengceHook6900: [`0xAf48…BEA5`](https://www.oklink.com/x-layer/address/0xAf481abCb80A73C9c300f16aAF1b61BcAaC3BEA5) | X Layer mainnet fork, live SemiModularAccount7702 | yes, for agents | available | no | uninstall and upgrade wait 2 days | yes | no | the EOA key can always send a plain transaction | [wallet-7702](CLAIMS.md#wallet-7702) |
| Coinbase Smart Wallet v1.1 | **Agent-only** | FengceAgentOwner (an extra owner): [`0xd857…aD21`](https://www.oklink.com/x-layer/address/0xd857d1850684aC80E7DDa4ab52ea6E1B1CB0aD21) | X Layer mainnet fork with Coinbase code from Base | yes, for agents | available (setInspector) | no | none: owners can remove FengceAgentOwner at any time | yes | no | owners are not checked | [wallet-coinbase](CLAIMS.md#wallet-coinbase) |
| Alchemy MultiOwnerLightAccount v2 | **Agent-only** | FengceAgentOwner (same execute entry point): [`0xd857…aD21`](https://www.oklink.com/x-layer/address/0xd857d1850684aC80E7DDa4ab52ea6E1B1CB0aD21) | not tested | yes, for agents (not tested) | available | no | none | yes | no | owners are not checked | – |
| MetaMask EIP-7702 DeleGator | **Not integrated** | none: – | none | no | no | no | n/a | n/a | no | agents use delegations and caveat enforcers; Fengce has no caveat enforcer yet | – |
| OKX Wallet (EIP-7702) | **Not integrated** | not checked: – | none | not checked | no | no | n/a | n/a | no | not checked which contract it delegates to | – |
| Alchemy LightAccount v2 (single owner) | **Not integrated** | none: – | none | no | no | no | n/a | n/a | no | a single owner: FengceAgentOwner would replace the owner's own access | – |

## Adapters

| Contract | Accounts | Install |
|---|---|---|
| `FengceGuard` (`src/safe`) | Safe v1.5.0 | `configure`, then `setGuard` and `setModuleGuard` (the app's Protect page, Install step, builds the Safe Transaction Builder JSON) |
| `FengceHook` (`src/erc7579`) | ERC-7579 accounts with a hook slot | `installModule(4, hook, abi.encode(pinId, layout, bindings))`; on Kernel as the validation's hook, with a 1-byte flag before the data. Admin changes: `scheduleAdmin(keccak256(call))`, wait 2 days |
| `FengceHook6900` (`src/erc6900`) | ERC-6900 v0.8 accounts (Modular Account v2, SemiModularAccount7702) | `installExecution(hook, hook.executionManifest(), abi.encode(pinId, layout, bindings))` |
| `FengceAgentOwner` (`src/agent`) | wallets that accept extra owners and expose `execute(address,uint256,bytes)` | add as owner, then from the wallet `configure(pinId, layout, bindings)` and `addAgent(agent, expiresAt)` |

## FengceBinding (`isBound`)

Binding vouches only for Safe accounts guarded by FengceGuard: the trusted guard as transaction and module guard, a pinned
policy, and a notice period before any change. Every account that uses FengceHook, FengceHook6900 or FengceAgentOwner
returns `isBound == false`, because on some of them the hook can be removed without running it (Etherspot uninstall,
Nexus emergency uninstall), so no notice period can be promised.
