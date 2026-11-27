# Threat model

Scope: `contracts/src/core`, `contracts/src/safe` (FengceGuard on Safe v1.5.0) and the SDK, on X Layer mainnet (chain 196).
Version 0.1.0. Not independently reviewed.

## What Fengce protects

A Safe's assets against outgoing transactions that the Safe's chosen circuit policy does not allow, whether
they come from owners (`execTransaction`) or from modules (`execTransactionFromModule`), including calls hidden
inside MultiSend batches.

## Trust assumptions

| Assumption | Why it matters |
|---|---|
| The TapeOut processor factory (`0x1f09…0761`) reports registered processors honestly through `isCPU` | `isPinned` treats deregistration as a change and fails closed; a dishonest or upgraded factory could report a swapped processor as registered |
| The circuit beacon's implementation behaves as TAP-02 describes | Fengce pins the implementation address and code hash, so a change is detected, but it cannot judge the code itself |
| The Safe owners chose the policy, delays and allowlist deliberately | All of these are set by the owners; Fengce enforces what they set, above fixed minimum delays |
| Tokens implement ERC-20 / ERC-165 truthfully | Facts come from calldata and a few reads (`allowance`, `supportsInterface`); a lying token can only misreport its own approvals |

## What is enforced

| Property | How | Test |
|---|---|---|
| The pinned circuit has not changed | Every evaluation re-checks processor code hashes, factory registration, the beacon implementation and its code hash for every processor in the dependency closure, and the chain id | `contracts/test/unit/PinRegistry.t.sol` |
| Dependencies are pinned too | At pin time the registry walks every REF record recursively and hashes the closure; processors in it are checked on every call | `contracts/test/fork/RefClosure.t.sol` |
| No lenient input | Schema rejects oversized values, unmapped and overlapping bits; PolicyEngine requires exact input and output lengths with zero padding | `contracts/test/unit/Schema.t.sol`, `contracts/test/unit/PolicyEngine.t.sol` |
| Fail closed | Any revert, out-of-gas, malformed return data or pin mismatch denies the transaction | `contracts/test/unit/PolicyEngine.t.sol`, `contracts/test/FengceGuard.t.sol` |
| Module path covered | The same policy runs as the Safe's module guard; modules cannot reach admin functions, recovery or the timelock | `contracts/test/FengceGuard.t.sol` |
| Batches covered | Delegatecall only to MultiSendCallOnly v1.5.0, decoded strictly; every inner call is checked; inner calls to the Safe or the guard are denied | `contracts/test/FengceGuard.t.sol` |
| Approvals covered | `approve`, `increaseAllowance` (as the new total), Permit2 `approve` go through the policy; ERC-721 `approve` and `setApprovalForAll(true)` also need the allowlist | `contracts/test/FengceApprovals.t.sol`, `contracts/test/FengceBatchB.t.sol` |
| Signed approvals covered | Permit2 `PermitSingle` / `PermitBatch` and EIP-2612 `Permit` signatures go through the policy; Strict mode refuses unknown domains | `contracts/test/FengceSignatures.t.sol` |
| Unknown calls denied | Only recognised calls and allowlisted (contract, function) pairs reach the circuit | `contracts/test/FengceApprovals.t.sol` |
| A broken circuit cannot lock the Safe | Recovery is checked before any circuit or registry call | `contracts/test/FengceGuard.t.sol` |

## Known limits and open issues

### Off-chain signatures

Safe owners can sign messages that move assets without any Safe transaction (EIP-2612 `permit`, Permit2
`permit`, other EIP-1271 messages). Fengce covers this with two pieces (`contracts/test/FengceSignatures.t.sol`):

- **FengceSignatureVerifier**, registered on the Safe's fallback handler as the verifier for the Permit2 domain
  and for EIP-2612 token domains. It decodes Permit2 `PermitSingle` / `PermitBatch` and EIP-2612 `Permit` into
  approval facts, runs them through the Safe's policy (the same circuit and schema as transactions), and only
  then checks the owners' signatures. Other message types on those domains are rejected.
- **Strict Signatures mode**: `FengceStrictHandler` as the fallback handler. It is Safe's ExtensibleFallbackHandler
  without the default path, so a signature on a domain with no registered verifier, a plain owner signature or
  an approved hash is refused.

With FengceGuard installed, changing the fallback handler or a domain verifier needs the admin timelock.

Remaining limits:

- With Safe's stock ExtensibleFallbackHandler (not strict), domains without a verifier still fall back to plain
  owner signatures and bypass the policy. Only Strict mode closes that.
- Strict mode breaks dApps that rely on plain off-chain Safe signatures (sign-in, off-chain orders).
- Permit variants other than EIP-2612 `Permit` (for example DAI-style permits) and Permit2 signature-transfer
  types are rejected, not policed.
- The legacy `isValidSignature(bytes,bytes)` is not provided by the strict handler.

### Owner override

Owners holding every signature can schedule recovery and, after the recovery delay and inside the recovery
window, replace or remove either guard. Owners holding the normal threshold can, through the admin timelock,
add modules, change owners or threshold, or change the fallback handler after the admin delay. Fengce makes
these changes slow and public (events `RecoveryScheduled`, `AdminScheduled`), not impossible. The delays are
chosen by the Safe at configuration, but `configure` enforces minimums (`contracts/src/safe/FengceLimits.sol`): admin
timelock at least 1 day, recovery delay at least 2 days, recovery window at least 1 day
(`contracts/test/FengceLimits.t.sol`).

### Processor beacon upgrades

TapeOut processors are beacon proxies: about 295 bytes that call `implementation()` on a beacon address written into
their code (checked by disassembly on 2026-11-26: no storage read, one static call to the beacon, one delegatecall).
A beacon upgrade therefore leaves every processor's code hash unchanged. A pin records the beacon, its
`implementation()` and that implementation's code hash, and `isPinned` re-reads both on every evaluation, so an
upgrade fails the check (`test_beaconUpgradeKeepsProcessorCodehashButBreaksThePin`). At block 76,924,400 the
beacon `0xf70d…991C` (an OpenZeppelin `UpgradeableBeacon`) returned the zero address from `owner()`, so its
owner-only `upgradeTo` cannot be called.

### Unsealed factory and its implementation

The TapeOut processor factory is an upgradeable proxy that is not sealed. Its implementation address lives only
in the ERC-1967 storage slot with no getter, so no contract can read it: `PinRegistry.pinContract(factory, 0)`
pins the proxy's code hash only, and an upgrade of the factory is not detected on-chain. `isPinned` relies on
the factory's `isCPU`, so an upgraded factory could change what counts as registered. Monitor the factory's
ERC-1967 slot off-chain.

### Quote certificates are unsigned

A certificate's `certificateHash` (keccak256 of its canonical JSON) is stored in the pin as a commitment. Nothing
proves who produced the certificate or that its gas figures are right; anyone can recompute it with the SDK.

### Gas tiers are not enforced

Quote assigns Green / Amber / Red from the full Safe path gas; the Catalog assigns one from eval gas. The guard
does not read either tier; it forwards at most the
`evalGasCap` set when the guard was deployed, and a circuit that runs out of gas denies the transaction.

### Approvals that existed before install

Approvals granted before install let spenders move funds with no transaction. The first configuration runs a
preflight over the tokens and spenders the caller lists (Permit2 is always added) and reverts if it finds any,
unless the override flag is set. Approvals for tokens or spenders not listed are not found: X Layer RPCs limit
`eth_getLogs` to 100 blocks, so history cannot be scanned on-chain.

### Modules enabled before install

`configure` reads the Safe's enabled modules (`getModulesPaginated`) and reverts if there are any, unless the
`acceptExistingModules` flag is set, in which case it emits `ExistingModuleAccepted` for each module
(`contracts/test/FengceLimits.t.sol`). The check runs when `configure` runs: a module enabled after `configure` but before
`setGuard` / `setModuleGuard` is not caught, so install in one batch (the SDK's `buildInstall` also refuses a
Safe with modules). After install, enabling a module needs the admin timelock.

### Agents, Tick and Catalog

- **AgentExecutor**: an agent key acts only through `execTransactionFromModule`, so the Safe's module guard
  (Fengce) checks every call; the executor refuses to act if FengceGuard is not the module guard. Any single
  owner can revoke an agent at once. Adding an agent needs an allowlisted Safe transaction
  (`contracts/test/AgentExecutor.t.sol`).
- The ERC-6900 and EIP-7702 limits are listed in `docs/WALLETS.md`.

### Outcome facts (FengceInspector)

For Safes that connect an Inspector (`configureInspector`), every policy-checked execution on the owner and
module paths is checked after it runs
(`contracts/test/FengceInspector.t.sol`):
- a change to owners, threshold, modules (first 64), guard, module guard or fallback handler outside the admin
  path reverts the transaction;
- the decrease of watched balances and the increase of allowances to listed spenders are evaluated by the same
  circuit as outcome facts.
Limits: only the declared assets (at most 8) and spenders (at most 8) are measured; native outflow includes
any gas refund the Safe pays to a relayer; an asset whose balance cannot be read makes every checked
transaction fail; transactions on the admin path (calls to the Safe or the guard) are not outcome-checked.

### Policy floors (FengceFloors)

A Safe can connect a floor: a minimum rule set once by the Safe, naming a floor owner and a change delay (at
least 1 day). Every evaluation requires the floor circuit to be in the policy's REF closure (checked once per
policy by walking the pinned netlists) and evaluates floor AND policy (`contracts/test/FengceFloors.t.sol`). Only the floor
owner can change or remove the floor, after its delay; the Safe cannot detach the floors contract while a floor
is set. Limits: owners holding every signature can still remove the guard through recovery; after the Safe
changes its own policy, transactions fail until someone calls `verifyPolicy` for the new policy, and fail for
good if the new policy does not contain the floor.

### Other limits

- A dependency closure can contain at most 64 circuits (`PinRegistry.MAX_CLOSURE`).
- Pins assume every processor embeds the factory's current circuit beacon; other processors cannot be pinned.
- Circuits with state (LATCH) cannot be evaluated with `eval` and therefore cannot be policies.
- Allowlisted calls run arbitrary code at the target; the circuit only sees target, value and selector.
- A native transfer to a contract runs that contract's receive logic.
- Recovery stays open until the transaction guard is changed, it is cancelled, or its window ends.

## Static analysis

Slither 0.11.3 runs on `contracts/src/` in CI on every push (`.github/workflows/slither.yml`) and fails the build on any
High finding. First run (commit `6b4cf8a`): **0 High**, 115 findings in total, reviewed as follows.

| Impact | Check | Count | Assessment |
|---|---|---|---|
| Medium | uninitialized-local | 28 | Counters, flags and accumulators that rely on Solidity's zero default (for example `needed`, `sum`, `seen`). Intended. |
| Medium | unused-return | 7 | Tuple reads where only some fields are needed (`registry.evalInfo`), and calls whose result is not needed because they revert on denial (`Tick.advanceFacts`, `guard.checkContext`). Intended. |
| Medium | incorrect-equality | 4 | Strict comparisons on stored values used as "not set" markers (`readyAt == 0`) and on period indices. Intended. |
| Low | calls-loop | 18 | External calls in loops over bounded lists (closure of at most 64 circuits, module pages, MultiSend calls, approval scan). Each call is gas-capped or bounded by the caller. |
| Low | timestamp | 16 | Delays, windows and periods are timestamp-based by design; minimum delays are days, far above any validator influence. |
| Low | return-bomb | 3 | `PolicyEngine._evaluate`, `Tick._advance` (pinned TapeOut processors, return data length-checked) and `Market.readSource`. The callees are pinned contracts; `isPinned` itself copies at most one word. |
| Low | missing-zero-check | 2 | Constructor arguments of `AgentExecutor` and `Catalog` (deployment-time configuration). |
| Informational | assembly, low-level-calls, naming-convention, cyclomatic-complexity | 37 | Deliberate (bit packing, bounded return-data copies, Safe calldata reconstruction). |
