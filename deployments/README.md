# Deployments

Fengce's own contracts are **not deployed** yet. `xlayer-196.template.json` is the format for the X Layer
mainnet address file; copy it to `xlayer-196.json` when a real deployment happens and fill in every `null`.

## Predicting the addresses

`script/Deploy.s.sol` deploys through the standard CREATE2 deployer
(`0x4e59b44847b379578588920cA78FbF26c0B4956C`, present on X Layer), so the addresses depend only on the salt
and the exact creation bytecode. The script only simulates; it never records or sends a transaction:

```sh
forge script script/Deploy.s.sol --rpc-url xlayer
```

It prints the predicted addresses, salts and init code hashes, deploys on the simulated chain, checks the
addresses and runs a smoke check.

The creation bytecode includes the compiler metadata hash, so any source change (including comments), compiler
setting or dependency version changes the addresses. Record `sourceCommit` and `initCodeHash` with every
deployment, and re-run the simulation from that exact commit before deploying.

A simulation on 2026-11-18, with the sources after Batch D2 (FengceGuard compiled with via_ir), predicted:

| Contract | Predicted address | initCodeHash |
|---|---|---|
| PinRegistry | `0x76Bc4eA2b5A224C2C079089c359bD7FE4388581a` | `0xa204b6930d689cbbb2104e006fb1feec15f43b135c7c15c84249016437590f96` |
| FengceGuard | `0xD632655A4f2d838b9Fd8F767BCCdB033b32059c0` | `0x11c285e5ac2c7792477840166c8fc0ed27c22164eb416292335e43a411dac905` |

These hold only for the bytecode built from that commit. Nothing is deployed at these addresses.
