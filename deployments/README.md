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

A simulation on 2026-11-18, with the sources after Batch C (minimum delays, module check, signature path), predicted:

| Contract | Predicted address | initCodeHash |
|---|---|---|
| PinRegistry | `0xEEBaF2476126e09dB6915872d9501de7FABCE8Aa` | `0xca7ad51e1ff6c3a72c08dc05ad246f1bb1f0fcfa59243f002d74d931fa9de71c` |
| FengceGuard | `0x89c4716dAf60b6213c33D181b534b49eB57e2e67` | `0x64a1e5529ef2bd6fb026dee30ca5da3af29c20b1a9ed388b131852f7f5bbda7c` |

These hold only for the bytecode built from that commit. Nothing is deployed at these addresses.
