# Fengce

Fengce lets a [Safe](https://github.com/safe-global/safe-smart-account) v1.5.0 enforce a spending policy that is
defined by a [TapeOut](https://github.com/TapeOutProtocol/TAPs) circuit on X Layer. The circuit is pinned: its
wiring, every circuit it references and the code that evaluates it are recorded on-chain, and the guard refuses
to run it if any of that changes.

It has three parts:

| Part | What it does |
|---|---|
| `src/core` | Wallet-agnostic contracts and libraries: `PinRegistry` (approved circuits), `Schema` (strict typed input encoding), `PolicyEngine` (fail-closed evaluation), `TxFacts` (call decoding), `ApprovalScan`, `Netlist` |
| `src/safe` | `FengceGuard`: a Safe v1.5.0 transaction guard and module guard sharing one policy path, with recovery, an admin timelock and a MultiSend decoder |
| `sdk/` | TypeScript: schema file format and encoder, Quote certificates (dependency tree, measured gas, budget tier), install calldata builder |

Status: version 0.1.0. Not deployed, not independently reviewed. All on-chain behaviour below is tested against
X Layer mainnet state on local forks; no transaction has been sent.

## Security statement

Fengce enforces circuit-defined policies across a Safe's owner and module execution paths, re-verifies the
approved circuit identity on every evaluation, and makes privileged policy changes delayed and observable.

Owners holding every signature remain the final authority: they can remove the guard through recovery, after a
delay they chose. Fengce makes overrides slow and visible, not impossible.

**Not covered** (details in [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md)):

- Off-chain signatures. An owner-signed `permit`, Permit2 signature or EIP-1271 message lets tokens move with no
  Safe transaction, so the guard never sees it.
- Approvals granted before install, beyond the tokens and spenders the install preflight was asked to check.
- Upgrades of the TapeOut processor factory's own implementation (a contract cannot read it).
- Quote certificates are not signed; their hash is only a commitment.
- Gas budget tiers are reported by Quote but not enforced on-chain.

## Install

Contracts (Foundry):

```sh
forge install pgreyy/fengce
```

Remappings used in this repository: `@fengce/core/=src/core/`, `@fengce/safe/=src/safe/`,
`@safe/=lib/safe-smart-account/contracts/`.

SDK (not published yet; build from source, Node 20 or later):

```sh
cd sdk && npm ci && npm run build
```

## Five-minute example

Needs Foundry (`forge`, `anvil`) and Node 20+. Everything runs locally or on a local fork; nothing is sent to
the chain.

**1. Build and run the core fork test.** It pins the one-NAND test circuit (processor
`0x839bdD6fa7A66416A609A735e11DE5411B98574e`, circuit 2), evaluates it, and shows that an oversized value is
rejected instead of truncated.

```sh
git clone --recurse-submodules https://github.com/pgreyy/fengce && cd fengce
forge build
forge test --match-path test/PinNand.t.sol
```

**2. Encode circuit inputs from a schema file** (offline):

```sh
cd sdk && npm ci
npx tsx examples/encode.ts
```

```
schemaHash (pin this): 0xf98ca2032a8ac8374dc5feca2d1b75af530bd435fcb0f5987d858e61d89b4827
overLimit = false -> 0x02
overLimit = true  -> 0x03
a=430, b=400 -> 0xae019001
processor would read: 4464n
encodeInputs refuses: "a": value 70000 does not fit in 16 bit(s)
```

**3. Quote a circuit** (starts an anvil fork of X Layer, deploys the contracts on it, measures gas on the real
Safe -> guard -> circuit path):

```sh
npm run build
node dist/cli/quote.js 0x839bdD6fa7A66416A609A735e11DE5411B98574e 2
```

(Once the package is installed in another project, the same command is `npx fengce-quote`.)

The certificate reports 3 gates, no dependencies, about 175,000 gas on the full path, tier Green, and a
`certificateHash` that matches what `PinRegistry` stores (see `sdk/quotes/nand-839bdd-2.json`).

**4. Install on a Safe.** `sdk/examples/install-calldata.ts` builds the three Safe transactions (configure,
`setGuard`, `setModuleGuard`) for a Safe, after checking it has no modules enabled. See
[docs/INTEGRATION.md](docs/INTEGRATION.md) for the full flow.

## What the guard does

For every Safe transaction and every module transaction:

1. A delegatecall is allowed only to MultiSendCallOnly v1.5.0; every call inside the batch is checked.
2. A call to the guard itself: recovery (all owners must sign), timelock scheduling, configuration.
3. A call to the Safe itself: installing this guard passes; changing either guard needs recovery; other admin
   calls (`enableModule`, `disableModule`, owner and threshold changes, `setFallbackHandler`) need the timelock;
   anything else is denied.
4. Anything else is decoded into facts (recipient, token, amount, kind), encoded with the Safe's schema and
   evaluated by the pinned circuit. Output bit 0 = 1 allows. Every error denies.

Recognised calls: native transfers, ERC-20 `transfer`, `approve`, `increaseAllowance`, `setApprovalForAll`,
Permit2 `approve`, and calls the Safe allowlisted by (contract, function). ERC-721 `approve` and
`setApprovalForAll(true)` additionally require the allowlist.

## Tests

| Command | What |
|---|---|
| `forge test --match-path 'test/unit/*.t.sol'` | Unit and fuzz tests, no network |
| `forge test --match-path 'test/*.t.sol'` and `'test/fork/*.t.sol'` | Fork tests against X Layer mainnet (`xlayer` RPC alias in `foundry.toml`) |
| `cd sdk && npm test` | SDK unit tests |

Behaviour with a test behind it:

| Claim | Test |
|---|---|
| Pin fails closed when processor code, beacon implementation, implementation code, factory registration or chain change | `test/unit/PinRegistry.t.sol` |
| Dependency closure of real REF circuits matches the SDK's independent computation | `test/fork/RefClosure.t.sol` |
| Inputs and outputs must be exact length with zero padding; failures revert | `test/unit/PolicyEngine.t.sol` |
| Oversized values are rejected, never truncated | `test/unit/Schema.t.sol`, `test/PinNand.t.sol` |
| Owner, module and batched transfers over the limit are blocked | `test/FengceGuard.t.sol` |
| Recovery works while the circuit is broken; guard swaps need recovery; recovery expires; one of two owners cannot schedule it | `test/FengceGuard.t.sol`, `test/FengceBatchB.t.sol` |
| Admin calls wait for the timelock | `test/FengceBatchB.t.sol` |
| Approvals go through the policy; NFT approvals need the allowlist; preflight finds existing allowances | `test/FengceApprovals.t.sol`, `test/FengceBatchB.t.sol`, `test/unit/ApprovalScan.t.sol` |

## Documentation

- [docs/INTEGRATION.md](docs/INTEGRATION.md): pin a circuit, write a schema, install on a Safe, operate and recover
- [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md): trust assumptions, what is enforced, known limits
- [docs/ADDRESSES.md](docs/ADDRESSES.md): X Layer addresses Fengce depends on
- [sdk/README.md](sdk/README.md): SDK API and CLI

## License

MIT. See [LICENSE](LICENSE).
