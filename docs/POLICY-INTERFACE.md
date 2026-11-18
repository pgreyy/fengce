# Policy interface

Every Fengce adapter (the Safe guard, the ERC-7579 hook, the signature verifier, Tick) turns an action into one
**canonical policy context** and feeds it to a pinned circuit through a schema. This document fixes that
context so circuits, schemas and decoders written today keep their meaning.

**Version 1.** `TxFacts.CONTEXT_VERSION = 1`; adapters report it through
`IFengcePolicy.policyContextVersion()`.

## Context fields (`TxFacts.Facts`)

| Field | Type | Meaning |
|---|---|---|
| `kind` | `Kind` | `Native` 0, `Transfer` 1, `Approval` 2, `Call` 3 (allowlisted), `Swap` 4, `Lending` 5 |
| `account` | address | The wallet whose policy applies (the Safe or 7579 account) |
| `actor` | address | Who initiated it: the owner transaction's sender, the module (an agent executor, Safe7579), or 0 if unknown (signature path) |
| `to` | address | Recipient (transfer), spender (approval), or call target (call, swap, lending) |
| `value` | uint256 | Native value sent |
| `token` | address | Token moved or approved; swap `tokenIn`; lending asset |
| `amount` | uint256 | Amount moved or approved; swap `amountIn` (`amountInMaximum` for exact-output); lending amount |
| `selector` | bytes4 | Function selector, 0 for a plain transfer of native value |
| `tokenOut` | address | Swap output token |
| `minAmountOut` | uint256 | Swap minimum output (the exact output for exact-output swaps) |
| `recipient` | address | Where swap output or lending proceeds go (`onBehalfOf`, or `to` for withdraw); 0 when not applicable |
| `deadline` | uint256 | Swap deadline, 0 when the call carries none (SwapRouter02) |
| `action` | `LendingAction` | `None` 0, `Supply` 1, `Withdraw` 2, `Borrow` 3, `Repay` 4 |

**State** is not part of the context: a stateful (LATCH) circuit's state is held by Tick per policy group and
passed to `step()` by Tick itself (see THREAT-MODEL.md).

## Bindings (`TxFacts.Source`)

A schema binds each non-flag input field to one source. Indices are stable; new sources are only appended.

| # | Source | Value |
|---|---|---|
| 0 | `To` | `to` as an integer |
| 1 | `Value` | `value` |
| 2 | `Token` | `token` as an integer |
| 3 | `Amount` | `amount` |
| 4 | `Kind` | `kind` |
| 5 | `AmountGt` | 1 if `amount > param` |
| 6 | `ToIs` | 1 if `to == param` |
| 7 | `TokenIs` | 1 if `token == param` |
| 8 | `Selector` | `selector` as an integer |
| 9 | `Actor` | `actor` as an integer (v1) |
| 10 | `ActorIs` | 1 if `actor == param` (v1) |
| 11 | `TokenOut` | `tokenOut` (v1) |
| 12 | `MinAmountOut` | `minAmountOut` (v1) |
| 13 | `Recipient` | `recipient` (v1) |
| 14 | `RecipientIsForeign` | 1 if `recipient` is set and is not `account` (v1) |
| 15 | `Deadline` | `deadline` (v1) |
| 16 | `Action` | `action` (v1) |

## Where the context comes from

1. A decoder registered by the account for `(target, selector)` (`IFengceDecoder`), for example
   `UniswapV3RouterDecoder`, `UniswapV2RouterDecoder`, `AaveV3PoolDecoder`. A decoder must revert on any call
   it cannot decode exactly; a revert denies the transaction.
2. Otherwise the generic decoder `TxFacts.decode`: native transfers, ERC-20 transfer, approvals
   (`approve`, `increaseAllowance`, `setApprovalForAll`, Permit2 `approve`), and allowlisted calls.
3. Off-chain approvals (Permit2 `PermitSingle` / `PermitBatch`, EIP-2612 `Permit`): `FengceSignatureVerifier`
   builds an `Approval` context.

Adapters then set `account` and `actor` themselves; a decoder's values for those two are overwritten.

## `IFengcePolicy`

```solidity
interface IFengcePolicy {
    function policyContextVersion() external pure returns (uint16);
    function checkContext(address account, TxFacts.Facts calldata ctx)
        external view returns (bytes memory input, bytes memory output);
}
```

`checkContext` encodes the context with the account's schema, evaluates the pinned circuit, reverts unless
output bit 0 is 1, and returns the input and output bits. Implemented by `FengceGuard` and `FengceHook`.
