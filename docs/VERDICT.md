# Verdict V1: settlement rules

**Status: next, in progress.** Verdict is not deployed on X Layer mainnet and nothing here is live. The code
below may change before release.

Code: [src/verdict/Verdict.sol](../src/verdict/Verdict.sol) (imports only `src/core`). Tests:
[test/unit/Verdict.t.sol](../test/unit/Verdict.t.sol) (no network) and
[test/fork/VerdictFork.t.sol](../test/fork/VerdictFork.t.sol) (fork of X Layer mainnet). Deploy:
[script/DeployVerdict.s.sol](../script/DeployVerdict.s.sol); demo market: [script/SeedVerdict.s.sol](../script/SeedVerdict.s.sol).

Verdict runs parimutuel YES/NO prediction markets in USDT0. Each market is settled by a TapeOut circuit pinned
in the Fengce `PinRegistry`, evaluated on values read from X Layer contracts. One contract holds every market.
There is no admin, no upgrade and no fee.

## Lifecycle

1. **Create.** `createMarket` takes a question, a pinned circuit with its input layout, a list of inputs, a
   deadline and a settle window. The circuit must be pinned, and the layout must be the one the pin committed
   to. Each input is either a read (`source` address, `callData`, and which 32-byte word of the return data to
   use) or a constant. Verdict records each source's code hash and the pin's REF closure hash. Nothing about the
   market can change afterwards.
2. **Bet.** USDT0 on YES or NO, until the deadline (exclusive).
3. **Checkpoint.** Once, by anyone, inside `[deadline, deadline + settleWindow]`. It staticcalls every input,
   stores the values and the block number, and emits them. It reverts if any source's code hash changed.
4. **Settle.** By anyone, after the checkpoint. It encodes the stored values with the market's layout and
   evaluates the pinned circuit (output bit 0 = 1 means YES). The pin must still hold: `PinRegistry.isPinned`
   re-checks every processor in the closure and the circuit implementation.
5. **Claim.** Winners split the whole pool pro rata to their stake on the winning side. No fee is taken.
   Rounding dust (at most a few base units per market) stays in the contract; there is no sweep.

Anyone can re-run a settlement: `evaluateStored(id)` returns the encoded input and the circuit output, and the
same input can be sent straight to the processor's `eval`.

## Refunds (VOID)

Every stake is refunded in full when the market is VOID:

| Reason | When it is recorded |
|---|---|
| `NoCheckpoint` | Nobody checkpointed inside the window; the first `refund` after the window records it |
| `SourceChanged` | A source's code hash changed before the checkpoint; the first `refund` records it (bets stop) |
| `ClosureChanged` | At `settle`, the circuit pin no longer holds |
| `EvalFailed` | At `settle`, a value does not fit the layout or the circuit evaluation failed |
| `OneSided` | At `settle`, one side has no stake |

`settle` refuses to run with less gas than the evaluation needs (`settleMinGas`), so a caller cannot force
`EvalFailed` by sending too little gas.

## The first checkpoint decides

The values are read in the checkpoint transaction: they are the state of the block that transaction runs in. A
contract cannot read past state, so V1 cannot check "the value at the deadline". **The first caller inside the
window picks the block.** Anyone able to move a source value during the settle window, and checkpoint at a moment
that suits them, can affect the outcome; the manipulation window equals the settle window. A market creator
should pick the shortest window (minimum 5 minutes, maximum 1 day) that still leaves time for someone to
checkpoint, and sources that are hard to move.

## EIP-2935 on X Layer (checked 2026-11-24)

The block-hash history contract `0x0000F90827F1C53a10cb7A02335B175320002935` exists on X Layer mainnet: 83 bytes of
code, code hash `0x6e49e66782037c0555897870e29fa5e552daf4719552131a0abce779daec0a5d`. At head 76,754,928 it
returned the correct block hash for blocks 1, 10, 100 and 8,191 back (compared with `eth_getBlockByNumber`) and
reverted for 8,192 back, as EIP-2935 specifies. The fork test `test_eip2935HistoryContract` checks the same.
At about one block per second, 8,191 blocks is roughly 2.3 hours of history.

This makes a V2 possible in which the value at a fixed block is proven instead of read at call time (state proof
against a block hash from the history contract), removing the first-checkpoint choice.

## Known limits

- The Catalog's comparator (`0xF9bBdc7f678eb3A49D338ffAcDaaD9339de50a0F` #7, `a >= b`) is 16-bit: values and
  thresholds must be at most 65,535, or the market settles VOID (`EvalFailed`).
- A source whose logic lives behind a proxy can change behaviour without its own code hash changing; only the code
  hash of the called address is recorded.
- No independent security review.
