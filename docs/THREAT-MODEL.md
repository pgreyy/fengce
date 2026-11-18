# Threat model

Scope: `src/core`, `src/safe` (FengceGuard on Safe v1.5.0) and the SDK, on X Layer mainnet (chain 196).
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
| The pinned circuit has not changed | Every evaluation re-checks processor code hashes, factory registration, the beacon implementation and its code hash for every processor in the dependency closure, and the chain id | `test/unit/PinRegistry.t.sol` |
| Dependencies are pinned too | At pin time the registry walks every REF record recursively and hashes the closure; processors in it are checked on every call | `test/fork/RefClosure.t.sol` |
| No lenient input | Schema rejects oversized values, unmapped and overlapping bits; PolicyEngine requires exact input and output lengths with zero padding | `test/unit/Schema.t.sol`, `test/unit/PolicyEngine.t.sol` |
| Fail closed | Any revert, out-of-gas, malformed return data or pin mismatch denies the transaction | `test/unit/PolicyEngine.t.sol`, `test/FengceGuard.t.sol` |
| Module path covered | The same policy runs as the Safe's module guard; modules cannot reach admin functions, recovery or the timelock | `test/FengceGuard.t.sol` |
| Batches covered | Delegatecall only to MultiSendCallOnly v1.5.0, decoded strictly; every inner call is checked; inner calls to the Safe or the guard are denied | `test/FengceGuard.t.sol` |
| Approvals covered | `approve`, `increaseAllowance` (as the new total), Permit2 `approve` go through the policy; ERC-721 `approve` and `setApprovalForAll(true)` also need the allowlist | `test/FengceApprovals.t.sol`, `test/FengceBatchB.t.sol` |
| Signed approvals covered | Permit2 `PermitSingle` / `PermitBatch` and EIP-2612 `Permit` signatures go through the policy; Strict mode refuses unknown domains | `test/FengceSignatures.t.sol` |
| Unknown calls denied | Only recognised calls and allowlisted (contract, function) pairs reach the circuit | `test/FengceApprovals.t.sol` |
| A broken circuit cannot lock the Safe | Recovery is checked before any circuit or registry call | `test/FengceGuard.t.sol` |

## Known limits and open issues

### Off-chain signatures

Safe owners can sign messages that move assets without any Safe transaction (EIP-2612 `permit`, Permit2
`permit`, other EIP-1271 messages). Fengce covers this with two pieces (`test/FengceSignatures.t.sol`):

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
chosen by the Safe at configuration, but `configure` enforces minimums (`src/safe/FengceLimits.sol`): admin
timelock at least 1 day, recovery delay at least 2 days, recovery window at least 1 day
(`test/FengceLimits.t.sol`).

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

Quote assigns Green / Amber / Red from measured gas. The guard does not read the tier; it forwards at most the
`evalGasCap` set when the guard was deployed, and a circuit that runs out of gas denies the transaction.

### Approvals that existed before install

Approvals granted before install let spenders move funds with no transaction. The first configuration runs a
preflight over the tokens and spenders the caller lists (Permit2 is always added) and reverts if it finds any,
unless the override flag is set. Approvals for tokens or spenders not listed are not found: X Layer RPCs limit
`eth_getLogs` to 100 blocks, so history cannot be scanned on-chain.

### Modules enabled before install

`configure` reads the Safe's enabled modules (`getModulesPaginated`) and reverts if there are any, unless the
`acceptExistingModules` flag is set, in which case it emits `ExistingModuleAccepted` for each module
(`test/FengceLimits.t.sol`). The check runs when `configure` runs: a module enabled after `configure` but before
`setGuard` / `setModuleGuard` is not caught, so install in one batch (the SDK's `buildInstall` also refuses a
Safe with modules). After install, enabling a module needs the admin timelock.

### Agents, ERC-7579, Tick and Catalog

- **AgentExecutor**: an agent key acts only through `execTransactionFromModule`, so the Safe's module guard
  (Fengce) checks every call; the executor refuses to act if FengceGuard is not the module guard. Any single
  owner can revoke an agent at once. Adding an agent needs an allowlisted Safe transaction
  (`test/AgentExecutor.t.sol`).
- **ERC-7579 module changes (Safe7579 + FengceGuard)**: the guarantee below holds only for a Safe that runs
  Rhinestone's Safe7579 adapter v1.0.0 **with FengceGuard as both transaction guard and module guard**.
  `installModule` / `uninstallModule` are timelocked admin calls on every route: an owner transaction, a
  validator-approved user operation (the adapter's helper delegatecall is allowed only for a matured schedule),
  another module (always refused), and bundles of module changes in one MultiSend or one 7579 batch (always
  refused; each change must be made on its own) (`test/FengceSafe7579Admin.t.sol`). The schedule covers
  (install or uninstall, module type, module), not the init data. The helper and MultiSendCallOnly are checked
  by runtime code hash, not only by address. With FengceGuard as module guard, Safe7579 batch executions are
  refused (they delegatecall the adapter's helper); use single executions. If `FengceHook` is also installed,
  its `preCheck` call must be allowlisted on the guard.
- **ERC-7579 (`FengceHook`)**: executions (`execute`, `executeFromExecutor`, single and batch) go through the
  same policy; delegatecall and unknown modes are denied (`test/FengceHook7579.t.sol`, on Safe7579). Limits:
  Safe7579 v1.0.0 does not run a hook when that same hook is being uninstalled, so on Safe7579 the hook's
  uninstall delay never applies and whoever can authorise `uninstallModule` (validators, or the Safe itself)
  can remove it at once. Installing or removing other modules is not checked by the hook.
- **Tick**: state lives in the Tick contract per policy group (several Safes or agents can share one budget),
  resets to zero at each period boundary (period index = floor(timestamp / period), Unix-epoch aligned), and
  advances only when the circuit allows (`test/FengceTick.t.sol`). FengceGuard advances the Safe's group on
  every checked call, on the owner and module paths, so an agent cannot skip it; if the Safe reports the
  execution failed, the guard rolls the advance back (`test/FengceTickGuard.t.sol`). Off-chain signed approvals
  (the signature verifier path) do not advance Tick. A group's admin controls membership: removing a Safe makes
  its guarded transactions fail closed until the Safe reconfigures (timelocked).
- **Catalog**: entries carry the certificate hash from the pin; the tier and gas figures are the lister's
  statement and are not verified on-chain. Readers should fetch the certificate and check its hash. Designer
  revenue share is not implemented.

### Other limits

- A dependency closure can contain at most 64 circuits (`PinRegistry.MAX_CLOSURE`).
- Pins assume every processor embeds the factory's current circuit beacon; other processors cannot be pinned.
- Circuits with state (LATCH) cannot be evaluated with `eval` and therefore cannot be policies.
- Allowlisted calls run arbitrary code at the target; the circuit only sees target, value and selector.
- A native transfer to a contract runs that contract's receive logic.
- Recovery stays open until the transaction guard is changed, it is cancelled, or its window ends.
