# contracts

The Foundry project: every Fengce contract, its tests and its deploy scripts. Solidity 0.8.28, EVM cancun.

- `src/` the contracts. Entry point: [`src/safe/FengceGuard.sol`](src/safe/FengceGuard.sol) (release v2, deployed) and
  [`src/safe/FengceGuardV3.sol`](src/safe/FengceGuardV3.sol) with [`src/safe/FengceRulesV3.sol`](src/safe/FengceRulesV3.sol)
  (guard v3: rules decided on TapeOut circuits). Core: `src/core/` (PinRegistry, PolicyEngine, Tick, Catalog, Schema, TxFacts).
- `test/` unit tests (`test/unit/`, no network) and fork tests against live X Layer state (`test/fork/`, `test/wallets/`).
- `script/` deploy and on-chain scripts, for example [`script/M2Demo.s.sol`](script/M2Demo.s.sol), driven by `../scripts/m2-onchain.sh`.
- `circuits/` TapeOut netlists built and checked by the SDK (trades per hour counter, Tilt-shield latch).
- `archive/` source of a deployed contract that is no longer part of Fengce.

```sh
forge build && forge test --match-path 'test/unit/*.t.sol'
```
