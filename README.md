# Fengce

Fengce lets the smart wallet you already have obey any TapeOut circuit. No new wallet, no moving funds.

- **FengceGuard** plugs into a Safe v1.5.0 as its transaction guard and checks every owner transaction.
- **Module guard** (the same FengceGuard, set with `setModuleGuard`) plugs into the Safe's module path and checks every module transaction.
- **FengceHook** plugs into ERC-7579 accounts (tested on Safe7579, Kernel v3.3, Nexus 1.2.0 and Etherspot) as a hook and checks every execution.
- **FengceHook6900** plugs into ERC-6900 accounts (tested on Alchemy Modular Account v2, also as an EIP-7702 delegate) as execution hooks.
- **FengceAgentOwner** gives agents a checked path on wallets with no hook system (tested on Coinbase Smart Wallet) by being one of their owners.
- **AgentExecutor** plugs into a Safe as a module and lets an agent key act only through the policy.
- **Signature verifier** (FengceSignatureVerifier) plugs into the Safe's fallback handler and checks off-chain Permit2 and EIP-2612 approvals.

Fengce lets a [Safe](https://github.com/safe-global/safe-smart-account) v1.5.0 enforce a spending policy that is
defined by a [TapeOut](https://github.com/TapeOutProtocol/TAPs) circuit on X Layer. The circuit is pinned: its
wiring, every circuit it references and the code that evaluates it are recorded on-chain, and the guard refuses
to run it if any of that changes.

It has three parts:

| Part | What it does |
|---|---|
| `src/core` | Wallet-agnostic contracts and libraries: `PinRegistry` (approved circuits), `Schema` (strict typed input encoding), `PolicyEngine` (fail-closed evaluation), `TxFacts` (call decoding), `ApprovalScan`, `Netlist` |
| `src/safe` | `FengceGuard`: a Safe v1.5.0 transaction guard and module guard sharing one policy path, with recovery, an admin timelock and a MultiSend decoder. `FengceSignatureVerifier` and `FengceStrictHandler`: the same policy for off-chain signed approvals |
| `src/erc7579` | `FengceHook`: the same policy as an ERC-7579 hook (tested on Safe7579, Kernel v3.3, Nexus 1.2.0, Etherspot) |
| `src/erc6900` | `FengceHook6900`: the same policy as ERC-6900 execution hooks (tested on Alchemy Modular Account v2 and SemiModularAccount7702) |
| `src/agent` | `FengceAgentOwner`: agent path for owner-only wallets (tested on Coinbase Smart Wallet) |
| `src/core` (state and listing) | `Tick`: state host for stateful (LATCH) policies with per-period reset. `Catalog`: public list of pinned circuits with their certificate hash and a tier from eval gas |
| `src/safe` (agents) | `AgentExecutor`: a Safe module that lets an agent key act only through the Fengce module guard |
| `sdk/` | TypeScript: schema file format and encoder, Quote certificates (dependency tree, full Safe path gas and tier), install calldata builder, Catalog reader |

Status: version 0.1.0, deployed on X Layer mainnet (addresses: [deployments/xlayer-196.json](deployments/xlayer-196.json)).
Not independently reviewed. The on-chain behaviour below is tested against X Layer mainnet state on local forks.

App: [getfengce.vercel.app](https://getfengce.vercel.app) (read-only, live X Layer data).

## Wallet compatibility

| Wallet | On X Layer | Adapter | Owner path | Agents | Uninstall protection |
|---|---|---|---|---|---|
| Safe v1.5.0 | yes | FengceGuard | checked | checked (AgentExecutor) | admin timelock, recovery |
| Safe + Safe7579 | Safe7579 no | FengceHook + FengceGuard | checked | checked | gap: hook not run on its own uninstall |
| Kernel v3.3 | yes | FengceHook (root validation hook) | checked | only validations with the hook (not tested) | delay enforced; gap: `changeRootValidator` |
| Nexus 1.2.0 | no | FengceHook | checked | not tested | delay enforced; gap: `emergencyUninstallHook` (not tested) |
| Etherspot modular | no | FengceHook | checked | not tested | gap: removable at once |
| Modular Account v2 | yes | FengceHook6900 | checked | checked | uninstall and upgrade wait 2 days |
| EIP-7702 EOA (SemiModularAccount7702) | yes | FengceHook6900 | not restricted | checked | 2 days |
| MetaMask 7702 DeleGator, OKX Wallet 7702 | no / not checked | none | not restricted | not supported / not tested | n/a |
| Coinbase Smart Wallet | no | FengceAgentOwner | not checked | checked | n/a (owners can remove it) |
| MultiOwnerLightAccount v2 | yes | FengceAgentOwner | not checked | not tested | n/a |

Details, sources and the test behind each cell: [docs/WALLETS.md](docs/WALLETS.md).

## Security statement

Fengce enforces circuit-defined policies across a Safe's owner and module execution paths, re-verifies the
approved circuit identity on every evaluation, and makes privileged policy changes delayed and observable.

Owners holding every signature remain the final authority: they can remove the guard through recovery, after a
delay they chose. Fengce makes overrides slow and visible, not impossible.

**Not covered** (details in [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md)):

- Off-chain signatures, unless the Safe uses the Fengce signature verifier. With it, Permit2 and EIP-2612
  permits go through the policy; with Strict Signatures mode (`FengceStrictHandler`), signatures on any other
  domain are refused. Without Strict mode, other domains still accept plain owner signatures.
- Approvals granted before install, beyond the tokens and spenders the install preflight was asked to check.
- Upgrades of the TapeOut processor factory's own implementation (a contract cannot read it).
- Quote certificates are not signed; their hash is only a commitment.
- Gas tiers are reported (Quote: full Safe path; Catalog: eval gas) but not enforced on-chain.

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

**3. Quote a circuit** (starts an anvil fork of X Layer, deploys the contracts on it, measures gas on the full
Safe path: Safe execution overhead, the guard's pre-check and the outcome check):

```sh
npm run build
node dist/cli/quote.js 0x839bdD6fa7A66416A609A735e11DE5411B98574e 2
```

(Once the package is installed in another project, the same command is `npx fengce-quote`.)

The certificate reports 3 gates, no dependencies, 288,485 gas on the full Safe path (72,770 Safe execution
overhead + 116,448 pre-check + 99,267 outcome check), tier Green, and a
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
| Minimum delays enforced; configure refuses Safes with modules unless overridden | `test/FengceLimits.t.sol` |
| Signed Permit2 / EIP-2612 approvals go through the policy; Strict mode refuses unknown domains | `test/FengceSignatures.t.sol` |
| Agent calls go through the circuit; owners can revoke | `test/AgentExecutor.t.sol` |
| ERC-7579 account (Safe7579) blocked over the limit, including batches | `test/FengceHook7579.t.sol` |
| Stateful cap: second spend in a period denied, allowed after reset | `test/FengceTick.t.sol` |
| Catalog listing runs its test vectors on-chain (a wrong vector reverts); tier from eval gas measured on-chain; fee split | `test/FengceCatalog.t.sol` |
| Catalog entry carries the Quote certificate hash | Quote run (`forkCheck.catalog`) |
| Swaps decoded (Uniswap V3): foreign recipient and over-cap amount denied, valid swap passes | `test/FengceDecoders.t.sol` |
| ERC-7579 module changes timelocked on all four routes | `test/FengceSafe7579Admin.t.sol` |
| Kernel v3.3, Nexus 1.2.0, Etherspot: over the limit and batches blocked; hook uninstall delay or its gap per wallet | `test/wallets/FengceKernel.t.sol`, `test/wallets/FengceNexus.t.sol`, `test/wallets/FengceEtherspot.t.sol` |
| Alchemy Modular Account v2: over the limit and batches blocked; uninstall and upgrade wait 2 days | `test/wallets/FengceModularAccountV2.t.sol` |
| EIP-7702: agents of a delegated EOA blocked over the limit; the EOA key itself is not restricted | `test/wallets/Fengce7702.t.sol` |
| Coinbase Smart Wallet: agents blocked over the limit through FengceAgentOwner; owners not checked | `test/wallets/FengceAgentOwner.t.sol` |
| Tick wired into the guard: agents capped, groups share one budget, failed executions roll back | `test/FengceTickGuard.t.sol` |

## App

`app/` is a read-only Next.js app over live X Layer data (no wallet connection, nothing is sent), hosted at
[getfengce.vercel.app](https://getfengce.vercel.app):

| Page or route | What |
|---|---|
| `/` and `/api/catalog` | Catalog entries and known circuits on X Layer |
| `/policy/[processor]/[id]` and `/api/circuit/[processor]/[id]` | Description, construction, allow and deny vectors with reasons, dependency tree, eval gas and tier (eval gas) |
| `/simulator` and `POST /api/simulate` | A proposed transaction through a policy in one `eth_call`: facts, circuit input bits, output, decision |
| `/install` and `POST /api/install` | Preflight per token and spender (checked, found, not checked, kept), then Safe Transaction Builder JSON |
| `/safe/[address]` and `/api/safe/[address]` | Owners, modules, guards, Fengce configuration, recovery, timelock events |

```sh
cd sdk && npm ci && cd ../app && npm ci && npm run build && npm start
```

`XLAYER_RPC` sets the RPC endpoint (default `https://xlayerrpc.okx.com`). Contract addresses come from
`deployments/xlayer-196.json`; `CATALOG_ADDRESS` and `AGENT_EXECUTOR` override them.

## Documentation

- [docs/INTEGRATION.md](docs/INTEGRATION.md): pin a circuit, write a schema, install on a Safe, operate and recover
- [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md): trust assumptions, what is enforced, known limits
- [docs/ADDRESSES.md](docs/ADDRESSES.md): X Layer addresses Fengce depends on
- [docs/WALLETS.md](docs/WALLETS.md): wallet compatibility, adapters and gaps per wallet
- [sdk/README.md](sdk/README.md): SDK API and CLI

## License

MIT. See [LICENSE](LICENSE).
