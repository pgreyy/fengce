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

A simulation on 2026-11-18, with the sources as of the commit that added this file, predicted:

| Contract | Predicted address | initCodeHash |
|---|---|---|
| PinRegistry | `0xEEBaF2476126e09dB6915872d9501de7FABCE8Aa` | `0xca7ad51e1ff6c3a72c08dc05ad246f1bb1f0fcfa59243f002d74d931fa9de71c` |
| FengceGuard | `0xF7bFd38Bde321d40722f63E8086FE99A680d2374` | `0x63301caca0c2b884465d8050e707c8c53ee4ce1eeac699d12b607ce3829cdbd8` |

These hold only for the bytecode built from that commit. Nothing is deployed at these addresses.
