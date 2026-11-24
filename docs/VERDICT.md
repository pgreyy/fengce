# Verdict V1: settlement rules

**Status: next, in progress.** Verdict is not deployed on X Layer mainnet and nothing here is live. The code
below is a draft and may change before release.

Code: `src/verdict` (imports only `src/core`). Tests: `test/Verdict.t.sol` (fork of X Layer mainnet).

## Lifecycle

1. **Create.** `MarketFactory.createMarket` checks that the rule circuit is pinned, that the schema is the one
   the pin committed to, and that the data source (if pinned) is pinned. Everything is then fixed in the new
   `Market` contract; it has no setters.
2. **Bet.** USDT0 on YES or NO before the cutoff.
3. **Settle.** Anyone can call `settle()` inside the settle window: from the observation time T to
   T + settle window. Before T it reverts.
4. **Claim.** Winners split the pool minus the fee. INVALID markets refund every stake in full.
5. **Sweep.** After the claim period of a YES/NO market, what is left (rounding dust and unclaimed winnings)
   goes to the reserve. INVALID refunds never expire.

## Settle window

- Set per market at creation: default **30 minutes**, minimum **5 minutes**, maximum **6 hours**
  (`MarketFactory.DEFAULT_SETTLE_WINDOW`, `MIN_SETTLE_WINDOW`, `MAX_SETTLE_WINDOW`).
- If nobody settles inside the window, the market is INVALID with full refunds. The first `settle()` or
  `claim()` after the window records this, so a market can never get stuck.

## The value is read at call time

The observed value (for example the TapeOut factory's `cpuCount()`) is read in the settle transaction itself:
it is the on-chain state of the block that settle runs in, **not** the state at T. A contract cannot read past
state.

Whoever settles can choose any block inside the settle window. **The manipulation window therefore equals the
settle window**: anyone able to move the observed value during that window, and settle at a moment that suits
them, can affect the outcome. A short window narrows this; a market creator should pick the shortest window
that still leaves time for someone to settle.

## Settler reward

- The caller of a successful `settle()` gets a reward of `rewardBps` of the total pool (default 0.5%), capped at
  the fee.
- It is paid **out of the fee**, never from winners: winners always receive the pool minus the fee.
- INVALID outcomes pay no fee and no reward.
- Fee and reward rates are set when the factory is deployed (fee at most 10%, reward at most the fee).

## INVALID cases (full refund, no fee)

| Reason | When |
|---|---|
| `OneSided` | Nobody bet on one of the sides |
| `Late` | Not settled inside the settle window |
| `SourceUnpinned` | The data source's pin no longer holds |
| `SourceReadFailed` | The data source call failed or returned malformed data |
| `RuleFailed` | The rule circuit is not pinned any more, the value does not fit the schema, or `eval` failed |

`settle()` refuses to run with less gas than the rule check needs, so a caller cannot force `RuleFailed` by
sending too little gas.

## Known limits

- The TapeOut factory proxy exposes no implementation getter, so it is pinned by code hash only and an upgrade
  of its implementation is not detected on-chain (see `docs/ADDRESSES.md`).
- The deployed comparator (`0xF9bBdc7f678eb3A49D338ffAcDaaD9339de50a0F` #7) is 16-bit: observed values and
  thresholds must be at most 65,535.
