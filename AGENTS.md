# AGENTS.md

Orientation for automated tools and for people new to the repository: where the canonical data lives, how to run the
checks, and which claims rest on mainnet evidence.

## Canonical deployment data

- Release **v2** on X Layer mainnet (chain 196): [deployments/xlayer-196-v2.json](deployments/xlayer-196-v2.json) (addresses,
  pins, demo Safe) and [deployments/manifest-xlayer-196-v2.json](deployments/manifest-xlayer-196-v2.json) (per contract:
  salt, init code hash, constructor arguments, runtime code hash, full solc metadata). Built from commit `e260a37`,
  solc 0.8.28, via_ir, 200 runs, EVM cancun. All 18 contracts verified on Sourcify (exact match).
- The app on TapeOut DeWeb: [deployments/deweb-xlayer-196.json](deployments/deweb-xlayer-196.json) (`6.2.180.tape`, container, files with SHA-256).
- Verdict V1 (prediction markets): [deployments/verdict-xlayer-196.json](deployments/verdict-xlayer-196.json), `0xb2589D3153411c5dcedFA83692AcaAC3d93A7c55`, verified on
  Sourcify (exact match); rules in [docs/VERDICT.md](docs/VERDICT.md).
- Release v1 (previous): [deployments/xlayer-196.json](deployments/xlayer-196.json), [deployments/manifest-xlayer-196.json](deployments/manifest-xlayer-196.json).
- Event history (installs, Denied, timelocks) from the v2 deploy block: [app/public/events-snapshot.json](app/public/events-snapshot.json).
- Hackathon write-up: [docs/SUBMISSION.md](docs/SUBMISSION.md).
- Every README claim with its evidence: [docs/claims.json](docs/claims.json) ([docs/CLAIMS.md](docs/CLAIMS.md)).
- Wallet guarantees: [docs/wallets.json](docs/wallets.json) ([docs/WALLETS.md](docs/WALLETS.md)).

| Contract (v2) | Address |
|---|---|
| AaveV3PoolDecoder | `0x8007856430d5A6a22D3de3a4d9b70582A7097f89` |
| AgentExecutor | `0xc01b590227149169260e030235b78d6e034E590c` |
| BoundVault | `0xbf76fC88e16fD18f87992f1927Aa31a713263e41` |
| Catalog | `0x26C5437428cdD7e4854614DC5DDEFE2776B51dFe` |
| FengceAgentOwner | `0xd857d1850684aC80E7DDa4ab52ea6E1B1CB0aD21` |
| FengceBinding | `0x20157A63Df8ab6728698630E38f6d7683Ca6b6F8` |
| FengceFloors | `0xD842C5B9EdDdd218d2Dbe91c3911934DdA7Ff7D4` |
| FengceGuard | `0x9D2A482fFA86fa3193F85c451A44576E2f1C8E6e` |
| FengceHook | `0xE538979145E67935B85D1912904ce8d5bF19669b` |
| FengceHook6900 | `0xAf481abCb80A73C9c300f16aAF1b61BcAaC3BEA5` |
| FengceInspector | `0xdeA3e3C305460247686c3EEeAe6552F33D98EE1A` |
| FengceSignatureVerifier | `0x81f073BF271230B832aC375ed786373Af75b5B19` |
| FengceStrictHandler | `0x846bBD554F31865C9A1301D325D73973A1F884cb` |
| PinRegistry | `0xD905dde3A09a9777B98013AD196E3b3F988e3715` |
| PolicyEngine | `0x2264B97828454374a56D7407f859fEA6eE7dFAA9` |
| Tick | `0xFEb6FD15F8724bfC69a119C0448f480a7D7e5370` |
| UniswapV2RouterDecoder | `0x34140a552Aa2c23256B4a3C760257A8CD8f88124` |
| UniswapV3RouterDecoder | `0x47FDb3C6E91661562243f97Df2f4b0B8EfFAA479` |

Demo Safe `0x0bb926DC7F79e4CEFFB30a67E8291C56C3F50707`, demo agent `0x81DeB61C444f5505F4d3343B366E71D31a4BF91E`, treasury Safe `0x5c53CDaED1cd64fc25AcC071b0Ca7ef891bB5661`, deployer `0x6eAC9821430aCa193a717a7C17D68f8033D46087`.

## Interfaces

- Solidity: [src/core](src/core) (PinRegistry, Schema, PolicyEngine, TxFacts, Catalog, Tick, FengceFloors),
  [src/safe](src/safe) (FengceGuard, AgentExecutor, FengceInspector, signature verifier), [src/erc7579](src/erc7579)
  (FengceHook), [src/erc6900](src/erc6900) (FengceHook6900), [src/agent](src/agent) (FengceAgentOwner),
  [src/binding](src/binding) (FengceBinding, BoundOnly). Policy context: [docs/POLICY-INTERFACE.md](docs/POLICY-INTERFACE.md).
- SDK: [sdk/README.md](sdk/README.md) (schemas, Quote, install calldata, local evaluation and `evaluateTrace`).
- HTTP API: [docs/API.md](docs/API.md), [docs/openapi.yaml](docs/openapi.yaml).
- MCP server for agents: [mcp/README.md](mcp/README.md); OnchainOS skill: [skills/fengce/SKILL.md](skills/fengce/SKILL.md).
- App: [app/](app) (static pages reading X Layer from the browser): Catalog (policy pages with a Try it tab), Protect
  (choose a wallet, install, check a wallet), Verdict. The old /simulator, /install, /safe and /wallets URLs redirect there.

## Running the checks

```sh
git submodule update --init --recursive
forge build
forge test --match-path 'test/unit/*.t.sol'                              # unit tests, no network (44 for the v2 release; Verdict adds 19)
forge test --match-path 'test/{PinNand,Fengce*,AgentExecutor}.t.sol'      # fork tests against X Layer mainnet state
forge test --match-path 'test/fork/*.t.sol'
forge test --match-path 'test/wallets/*.t.sol'                           # also reads wallet code from the public Base RPC
cd sdk && npm ci && npm run typecheck && npm test
cd app && npm ci && npm run build
```

Fork tests need the `xlayer` RPC alias in [foundry.toml](foundry.toml) to answer (the public endpoint works; CI uses a
private one through the `XLAYER_RPC_URL` secret). Nothing in the test suite sends a transaction.

## Evidence levels

- **Mainnet transactions**: the v2 demo (an agent's 1.5 USDT0 transfer denied, 0.5 allowed), the v1 demo, the v2
  deployment (pins, Catalog listings with on-chain vector checks, demo Safe setup). Links in [docs/CLAIMS.md](docs/CLAIMS.md).
- **Verified**: 18/18 v2 contracts on Sourcify.
- **Wallet types**: 8 with a tested adapter (Safe on mainnet, the other 7 on forks); list and tests in
  [docs/WALLETS.md](docs/WALLETS.md#wallet-types-with-a-tested-adapter-8), claim `wallet-types-8`.
- **Fork-tested**: owner-path blocking, recovery and timelocks, outcome checks, floors, Tick budgets, approvals and
  signatures, swaps, and every non-Safe wallet adapter. Fork tests run against live X Layer mainnet state.
- **CI**: 112 tests for the release commit (44 unit, 53 core and Safe fork, 15 wallet fork); Slither 0 High (not an audit).

## Experimental or deferred

- Verdict V1 is live (`0xb2589D3153411c5dcedFA83692AcaAC3d93A7c55`) with one demo market; no independent review, and the first checkpoint picks the
  block (docs/VERDICT.md). Code in [src/verdict](src/verdict) (tests: test/unit/Verdict.t.sol, test/fork/VerdictFork.t.sol), notes in [docs/VERDICT.md](docs/VERDICT.md).
- No independent security review. The TapeOut processor factory and circuit beacon are upgradeable and not sealed;
  PinRegistry fails closed (denies) if a pinned circuit's code or REF closure changes.
- Non-Safe adapters (FengceHook, FengceHook6900, FengceAgentOwner) are deployed on mainnet but exercised only on forks;
  some wallets let the hook be removed without running it (docs/WALLETS.md, "Known bypasses").
- Catalog install fees, Tick groups and FengceFloors are deployed but unused on mainnet so far.
- Explorer verification on OKX: not done (the API rejected every submission); Sourcify is complete.
- The app is published on TapeOut DeWeb as `6.2.180.tape` ([deployments/deweb-xlayer-196.json](deployments/deweb-xlayer-196.json));
  republish changed files with [script/DeployDeWeb.s.sol](script/DeployDeWeb.s.sol), check with `app/scripts/deweb-check.mts`.
