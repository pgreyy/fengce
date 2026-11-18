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
| The Safe owners chose the policy, delays and allowlist deliberately | All of these are set by the owners; Fengce enforces what they set, including delays of zero |
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
| Unknown calls denied | Only recognised calls and allowlisted (contract, function) pairs reach the circuit | `test/FengceApprovals.t.sol` |
| A broken circuit cannot lock the Safe | Recovery is checked before any circuit or registry call | `test/FengceGuard.t.sol` |

## Known limits and open issues

### Off-chain signatures (open)

Safe owners can sign messages that move assets without any Safe transaction:

- EIP-2612 `permit` and Permit2 `permit` signatures, validated through the Safe's EIP-1271 `isValidSignature`
  (the fallback handler) or by the owners' keys where the token supports it;
- other EIP-1271 messages accepted by protocols on the Safe's behalf.

The guard only sees transactions, so these bypass the policy. A verifier on Safe's ExtensibleFallbackHandler
that applies the policy to Permit/Permit2 typed data, and an opt-in mode that refuses other off-chain signatures,
are planned but not built. Until then, treat off-chain signing by owners as outside the policy.

### Owner override

Owners holding every signature can schedule recovery and, after the recovery delay and inside the recovery
window, replace or remove either guard. Owners holding the normal threshold can, through the admin timelock,
add modules, change owners or threshold, or change the fallback handler after the admin delay. Fengce makes
these changes slow and public (events `RecoveryScheduled`, `AdminScheduled`), not impossible. The delays are
chosen by the Safe at configuration and may be zero; a zero delay gives no protection.

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

`configure` does not check for existing modules. The SDK's `buildInstall` refuses a Safe that has modules
enabled; integrators that build calldata themselves must check.

### Other limits

- A dependency closure can contain at most 64 circuits (`PinRegistry.MAX_CLOSURE`).
- Pins assume every processor embeds the factory's current circuit beacon; other processors cannot be pinned.
- Circuits with state (LATCH) cannot be evaluated with `eval` and therefore cannot be policies.
- Allowlisted calls run arbitrary code at the target; the circuit only sees target, value and selector.
- A native transfer to a contract runs that contract's receive logic.
- Recovery stays open until the transaction guard is changed, it is cancelled, or its window ends.
