# Integration guide

This guide takes a TapeOut circuit from selection to a running policy on a Safe v1.5.0 on X Layer, then covers
day-to-day operation, configuration changes and recovery. Read [THREAT-MODEL.md](THREAT-MODEL.md) first.

Addresses used below are in [ADDRESSES.md](ADDRESSES.md). Fengce's own contracts are not deployed yet; see
`script/` for the deployment script and `deployments/` for the address file.

## 1. Choose and quote a circuit

The policy is any stateless TapeOut circuit: the guard allows a transaction when output bit 0 is 1.

```sh
cd sdk && npm ci && npm run build
node dist/cli/quote.js <processor> <circuitId> --out quote.json
```

Quote reads the circuit and every circuit it references (REF), measures gas on the real Safe -> guard ->
circuit path on a local fork, and assigns a tier (Green up to 1M gas, Amber up to 3.5M, Red above). If the
circuit denies all-zero input, give a probe input with `--input 0x…` or `--schema file --values '{…}'`.
The `certificateHash` in the output is what you pin.

## 2. Write a schema

A schema maps named fields onto the circuit's input bits (least significant bit first) and, for FengceGuard,
binds each field to a fact of the transaction.

```json
{
  "format": "fengce-schema/1",
  "netlistHash": "0xc738359c3dde133a010e00bbc3dc1bd8685e3028a04e5df6e0f00cffa2ce2524",
  "nIn": 2,
  "fields": [
    { "name": "overLimit", "kind": "bool", "offset": 0, "width": 1 },
    { "name": "one", "kind": "flag", "offset": 1, "width": 1, "value": 1 }
  ],
  "bindings": [{ "field": "overLimit", "source": "AmountGt", "param": "100" }]
}
```

- Kinds: `uint` (1 to 256 bits), `bool` (1 bit), `flag` (1 bit fixed by the schema).
- Every input bit must belong to exactly one field.
- `netlistHash` is `keccak256` of the circuit's `netlist(id)`; Quote prints it.
- Values that do not fit are rejected, never truncated.

Binding sources (`TxFacts.Source`):

| Source | Value |
|---|---|
| `To` | Recipient, spender or call target, as an integer |
| `Value` | Native value sent |
| `Token` | Token contract (0 for native and plain calls) |
| `Amount` | Native value, transfer amount or approval amount |
| `Kind` | 0 native, 1 transfer, 2 approval, 3 allowlisted call |
| `AmountGt` | 1 if amount > `param` |
| `ToIs` | 1 if `to` equals the address in `param` |
| `TokenIs` | 1 if the token equals the address in `param` |
| `Selector` | Function selector as an integer (0 for native) |

`schemaHash(schema)` in the SDK equals `Schema.hash` on-chain. Names and bindings are not part of the hash.

## 3. Pin the circuit

```solidity
bytes32 pinId = pinRegistry.pin(processor, circuitId, schemaHash, certificateHash);
```

Pinning is permissionless and content-addressed: the same inputs on the same chain give the same id, and a
second pin of identical content reverts with `PinExists`. `isPinned(pinId)` returns false (never reverts) if any
recorded value no longer matches the chain.

## 4. Allowlist (optional, before configuring)

Calls other than native transfers, ERC-20 transfers and approvals are denied unless the Safe allowlists the
(contract, function) pair. ERC-721 `approve` and `setApprovalForAll(true)` also need an entry for the token.
Before the first configuration the Safe can set entries directly (a Safe transaction to the guard):

```solidity
guard.setAllowlisted(target, selector, true);
```

After the first configuration, allowlist changes go through the timelock (step 7).

## 5. Install

Use the SDK to build the calldata. It refuses a Safe with modules enabled.

```ts
import { buildInstall, parseSchema } from "@fengce/sdk";

const { calls, multiSend } = await buildInstall(publicClient, {
  safe, guard, pinId, schema: parseSchema(schemaJson),
  recoveryDelay: 86_400n, recoveryWindow: 172_800n, adminDelay: 86_400n,
  preflightTokens: [usdt0], preflightSpenders: [],
});
```

Execute `calls` in order as Safe transactions (or `multiSend` as one delegatecall to MultiSendCallOnly):

1. `FengceGuard.configure(...)`: stores the pin, schema, bindings and delays. On the first configuration it
   checks the listed tokens and spenders (plus Permit2) for existing approvals and reverts if it finds any,
   unless `acceptExistingApprovals` is set, in which case it emits `ExistingApprovalAccepted` for each.
2. `Safe.setGuard(guard)`.
3. `Safe.setModuleGuard(guard)`.

Choose delays you can live with: they are the time your co-signers and monitors have to react, and also the time
you wait when you need to change something.

## 6. Operate

Transactions go through the Safe as usual. The guard decodes each call (see the README for the recognised
calls), encodes the facts with your schema, and evaluates the pinned circuit. A denial reverts with
`FengceDenied(safe, to)`; other reverts name the reason (`TxUnsupportedCall`, `TxNftApprovalDenied`,
`EngineNotPinned`, `EngineEvalFailed`, …).

Batches: use MultiSendCallOnly v1.5.0 (`0xA83c336B20401Af773B6219BA5027174338D1836`) by delegatecall. Any other
delegatecall is denied.

## 7. Change the configuration (timelock)

Admin calls to the Safe (`enableModule`, `disableModule`, `addOwnerWithThreshold`, `removeOwner`, `swapOwner`,
`changeThreshold`, `setFallbackHandler`) and changes to the guard's configuration or allowlist after the first
configuration must be scheduled:

1. Safe transaction: `guard.scheduleAdmin(target, data)` where `target` is the Safe or the guard and `data` is
   the exact calldata. Emits `AdminScheduled` with the full calldata and the ready time.
2. Wait the admin delay.
3. Safe transaction: the call itself (`to = target`, same `data`). It passes once and emits `AdminExecuted`.

`guard.cancelAdmin(target, data)` cancels. Changing either guard is not possible through the timelock; it needs
recovery.

## 8. Recovery

Recovery replaces or removes the guards. It never calls the circuit or the registry, so it works when the circuit
is broken.

1. Safe transaction `guard.scheduleRecovery()`, signed by **all** owners. Emits `RecoveryScheduled`.
2. After the recovery delay and before the window ends: `Safe.setModuleGuard(x)` and `Safe.setGuard(x)` for any
   `x` (zero to remove). Changing the transaction guard ends recovery.
3. After the window, recovery must be scheduled again. `guard.cancelRecovery()` cancels it.

## 9. Monitor

Watch these events and react within your delays:

| Contract | Event | Meaning |
|---|---|---|
| FengceGuard | `RecoveryScheduled`, `RecoveryExecuted`, `RecoveryCancelled` | A guard change is coming or happened |
| FengceGuard | `AdminScheduled`, `AdminExecuted`, `AdminCancelled` | An admin or configuration change is coming or happened |
| FengceGuard | `Configured`, `AllowlistSet`, `ExistingApprovalAccepted` | Policy changes |
| PinRegistry | `CircuitPinned`, `ContractPinned` | New pins |

Also poll `PinRegistry.isPinned(pinId)`: once it is false, every guarded transaction is denied until the
configuration points at a valid pin. Off-chain, watch the TapeOut factory's ERC-1967 implementation slot (see
THREAT-MODEL.md).

## Using the core without a Safe

`src/core` has no Safe dependency. To evaluate a pinned circuit from your own contract, inherit `PolicyEngine`
(or call a deployed one through `IPolicyEngine`):

```solidity
contract MyRule is PolicyEngine {
    constructor(PinRegistry r) PolicyEngine(r, 2_000_000) {}

    function check(bytes32 pinId, Schema.Layout memory layout, uint256[] memory values) external view returns (bool) {
        bytes memory out = evaluateFields(pinId, layout, values); // reverts on any failure
        return uint8(out[0]) & 1 == 1;
    }
}
```

Interfaces: `src/core/interfaces/IPinRegistry.sol`, `IPolicyEngine.sol`, `ITapeOut.sol`.
