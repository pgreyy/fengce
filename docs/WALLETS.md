# Wallet compatibility

Which smart wallets can host Fengce, through which adapter, and what each one guarantees. "Owner path" means
transactions approved by the wallet's own owners or validators; "agents" means keys or modules that act for the
wallet with limited rights (session keys, executors, AgentExecutor). Every "yes" and every listed gap is backed
by the test named in the last column. Items marked "from source, not tested" were read in the wallet's source
code and are not covered by a test.

All fork tests run on an X Layer mainnet fork, because the policy circuit lives on X Layer. For wallets that are
not deployed on X Layer, the test reads the canonical runtime code from a Base fork and places it at the same
addresses on the X Layer fork. Nothing from these wallets is stored in this repository.

## Table

| Wallet | On X Layer (checked 2026-11-18) | Adapter | Owner path | Agents | Uninstall protection | Tests |
|---|---|---|---|---|---|---|
| Safe v1.5.0 | yes | FengceGuard (transaction guard and module guard) | checked | checked (AgentExecutor) | admin timelock; removal by recovery with all owners | `test/FengceGuard.t.sol`, `test/AgentExecutor.t.sol` |
| Safe + Safe7579 v1.0.0 | Safe yes, Safe7579 adapter no | FengceHook (with FengceGuard for Safe owner transactions) | checked | checked (FengceGuard as module guard) | **gap**: Safe7579 does not run the hook on its own uninstall | `test/FengceHook7579.t.sol`, `test/FengceSafe7579Admin.t.sol` |
| ZeroDev Kernel v3.3 | yes (v3.1 also deployed, not tested) | FengceHook as the root validation's hook | checked (root user operations) | only validations or executors installed with FengceHook as their hook (Kernel hooks are per validation; not tested) | hook delay enforced; changing the root validator and installing a validator are timelocked admin actions (2 days, scheduled per call) | `test/wallets/FengceKernel.t.sol` |
| Biconomy Nexus 1.2.0 | no | FengceHook (global hook) | checked | executors go through `executeFromExecutor`, which runs the hook (from source, not tested) | hook delay enforced; **gap**: `emergencyUninstallHook` (owner-signed, Nexus's own 1-day timelock) removes the hook without running it (from source, not tested) | `test/wallets/FengceNexus.t.sol` |
| Startale smart account | not checked | Nexus base, so FengceHook should apply | not tested | not tested | not tested | none |
| Etherspot ModularEtherspotWallet v1.0.0 | no | FengceHook (global hook) | checked | not tested | **gap**: `uninstallModule` does not run the hook; removable at once | `test/wallets/FengceEtherspot.t.sol` |
| Alchemy Modular Account v2 (ERC-6900) | yes | FengceHook6900 (execution hooks from its manifest) | checked | checked (any validation calling `execute` or `executeBatch`) | uninstall and account upgrade wait 2 days | `test/wallets/FengceModularAccountV2.t.sol` |
| EIP-7702 EOA delegating to Alchemy SemiModularAccount7702 | yes | FengceHook6900 | **not restricted**: the EOA key can always send a plain transaction | checked | uninstall and upgrade wait 2 days (same module) | `test/wallets/Fengce7702.t.sol` |
| MetaMask EIP-7702 DeleGator | no | none | not restricted | not supported: agents act through delegations and caveat enforcers, which Fengce does not provide yet | n/a | none |
| OKX Wallet (EIP-7702) | not checked | not sure which contract it delegates to; if it is an ERC-7579 or ERC-6900 account, the matching adapter applies | not restricted | not tested | not tested | none |
| Coinbase Smart Wallet v1.1 | no | FengceAgentOwner (added as an extra owner) | **not checked**: no hook or module system exists | checked | n/a: the wallet's owners can remove FengceAgentOwner at any time | `test/wallets/FengceAgentOwner.t.sol` |
| Alchemy MultiOwnerLightAccount v2 | yes | FengceAgentOwner (same `execute` entry point) | not checked | should work as for Coinbase Smart Wallet (not tested) | n/a | none |
| Alchemy LightAccount v2 (single owner) | yes | none | not checked | only by making FengceAgentOwner the single owner, which removes the owner's own access | n/a | none |

## Notes per wallet

**EIP-7702 wallets.** The EOA's own key is never restricted: a plain transaction from the EOA runs no account code,
so no hook can see it. Fengce restricts the agents and session keys acting for the EOA, through the account code
the EOA delegates to (`test/wallets/Fengce7702.t.sol`: an agent's over-limit transfer and an over-limit batch are
refused; the owner key's plain transfer goes through).

**Wallets with no hook or module system (Coinbase Smart Wallet, Light Account).** No extension point checks the
owners. Both accept extra owners (Coinbase Smart Wallet: any owner; Light Account: the multi-owner variant), so
`FengceAgentOwner` is added as an owner and agents act only through it. The test shows an agent's over-limit
transfer refused and recorded as `Denied`, an agent's call to the wallet itself refused, and the wallet owner's own
transfer not checked.

**ERC-7579 accounts and module changes.** Besides executions, FengceHook (v2) treats these calls as timelocked
admin actions: installing or uninstalling a validator, executor or fallback module (types 1 to 3), upgrading the
account (`upgradeTo`, `upgradeToAndCall`), and on Kernel v3 `changeRootValidator`, `installValidations` and
`uninstallValidation`. The account schedules the exact call with `scheduleAdmin(keccak256(call))` (an execution
to the hook); after 2 days that call passes once. This works only where the account runs the hook on the admin
call. Kernel v3.3 does (tested: root validator change and validator install). Nexus and Etherspot do not run the
hook on `installModule` (from source, not tested), so there the timelock does not apply; installing a validator
there does not bypass the global hook, but their uninstall gaps in the table remain. Installing other hooks is
not checked.

**FengceBinding (`isBound`).** Binding vouches only for Safe accounts guarded by FengceGuard: the trusted guard as
transaction and module guard, a pinned policy, and a notice period before any change. Every account that uses
FengceHook, FengceHook6900 or FengceAgentOwner returns `isBound == false`, because on some of them the hook can be
removed without running it (Etherspot uninstall, Nexus emergency uninstall), so no notice period can be promised.
Shown on a Kernel v3.3 account in `test/wallets/FengceKernel.t.sol`; the same code path (the Safe guard slots read
as empty) applies to every non-Safe account (from source).

**FengceInspector (outcome checks).** v2 accepts all four adapters (FengceGuard, FengceHook, FengceHook6900,
FengceAgentOwner). On Safe accounts it also detects configuration changes (owners, threshold, modules, guards,
fallback handler). On other accounts it checks only the outcome (outflow and allowance increase) and the account's
code hash (`test/wallets/FengceModularAccountV2.t.sol` wires it on Modular Account v2).

## Adapters

| Contract | Accounts | Install |
|---|---|---|
| `FengceHook` (`src/erc7579`) | ERC-7579 accounts with a hook slot | `installModule(4, hook, abi.encode(pinId, layout, bindings))` (Kernel: as the validation's hook, with a 1-byte flag before the data) |
| `FengceHook6900` (`src/erc6900`) | ERC-6900 v0.8 accounts (Alchemy Modular Account v2, SemiModularAccount7702) | `installExecution(hook, hook.executionManifest(), abi.encode(pinId, layout, bindings))` |
| `FengceAgentOwner` (`src/agent`) | wallets that accept extra owners and expose `execute(address,uint256,bytes)` | add as owner, then from the wallet: `configure(pinId, layout, bindings)`, `addAgent(agent, expiresAt)` |
