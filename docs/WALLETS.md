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

The non-Safe hook (FengceHook6900) still checks every call before it executes. What they lack compared with a Safe
is the Safe configuration invariants (owners, threshold, modules, guards, fallback handler), which FengceInspector can only
read on Safe accounts; on other accounts it checks the outcome and the account's code hash.

## Wallet types with a tested adapter (4)

Every wallet in the matrix whose adapter has a passing test. Enforcement is permanent only on Safe; Modular Account v2 is enforced but
its hook can be removed, and two are agent-only.
Alchemy MultiOwnerLightAccount v2 (agent-only, not tested) and the three not-integrated wallets are not counted. Claim:
[wallet-types-4](CLAIMS.md#wallet-types-4).

| # | Wallet | Status | Test |
|---|---|---|---|
| 1 | Safe v1.5.0 | **Mainnet** | [`test_ownerSend150Blocked`](../contracts/test/FengceGuard.t.sol#L32) in `contracts/test/FengceGuard.t.sol` (plus the v2 mainnet demo) |
| 2 | Alchemy Modular Account v2 (ERC-6900) | **Fork-tested** | [`test_mav2OverLimitBlocked`](../contracts/test/wallets/FengceModularAccountV2.t.sol#L45) in `contracts/test/wallets/FengceModularAccountV2.t.sol` |
| 3 | EIP-7702 EOA (SemiModularAccount7702) | **Agent-only** | [`test_7702AgentGoesThroughCircuitOwnerKeyDoesNot`](../contracts/test/wallets/Fengce7702.t.sol#L52) in `contracts/test/wallets/Fengce7702.t.sol` |
| 4 | Coinbase Smart Wallet v1.1 | **Agent-only** | [`test_coinbaseAgentThroughCircuit`](../contracts/test/wallets/FengceAgentOwner.t.sol#L47) in `contracts/test/wallets/FengceAgentOwner.t.sol` |

## Matrix

| Wallet | Status | Adapter (live on mainnet) | Test environment | Pre-execution check | Outcome check | Safe config invariants | Uninstall / admin protection | Agent-only | isBound | Known bypasses | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Safe v1.5.0 | **Mainnet** | FengceGuard (transaction guard and module guard): [`0x9D2A…8E6e`](https://www.oklink.com/x-layer/address/0x9D2A482fFA86fa3193F85c451A44576E2f1C8E6e) | X Layer mainnet; X Layer mainnet fork | yes | yes (FengceInspector) | yes (owners, threshold, modules, guards, fallback handler) | admin timelock (at least 1 day); guard removal only by recovery: all owners, at least 2 days | no | yes | none known | [enforced-at-execution](CLAIMS.md#enforced-at-execution), [binds-owners](CLAIMS.md#binds-owners), [no-quiet-swap](CLAIMS.md#no-quiet-swap), [outcome-check](CLAIMS.md#outcome-check), [verifiable](CLAIMS.md#verifiable) |
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
| `FengceGuard` (`contracts/src/safe`) | Safe v1.5.0 | `configure`, then `setGuard` and `setModuleGuard` (the app's Protect page, Install step, builds the Safe Transaction Builder JSON) |
| `FengceHook6900` (`contracts/src/erc6900`) | ERC-6900 v0.8 accounts (Modular Account v2, SemiModularAccount7702) | `installExecution(hook, hook.executionManifest(), abi.encode(pinId, layout, bindings))` |
| `FengceAgentOwner` (`contracts/src/agent`) | wallets that accept extra owners and expose `execute(address,uint256,bytes)` | add as owner, then from the wallet `configure(pinId, layout, bindings)` and `addAgent(agent, expiresAt)` |

## FengceBinding (`isBound`)

Binding vouches only for Safe accounts guarded by FengceGuard: the trusted guard as transaction and module guard, a pinned
policy, and a notice period before any change. Every account that uses FengceHook6900 or FengceAgentOwner
returns `isBound == false`, because the hook or owner can be removed without a notice period.
