# @fengce/sdk

TypeScript tools for [Fengce](https://github.com/pgreyy/fengce): check a Safe transaction against its on-chain limits
before you send it, TapeOut circuit schemas, Quote certificates and Safe guard install calldata. Built on
[viem](https://viem.sh). Node 20 or later.

App: [getfengce.vercel.app](https://getfengce.vercel.app) (limits on your Safe) and the [docs](https://getfengce.vercel.app/docs/). Changes: [CHANGELOG.md](CHANGELOG.md).

## Install

On npm as [@fengce/sdk](https://www.npmjs.com/package/@fengce/sdk):

```sh
npm install @fengce/sdk
npx fengce-quote <processor> <circuitId> --out quote.json   # the Quote CLI
```

From the repository instead: `cd sdk && npm ci && npm run build`.

## Check a transaction before you send it

```ts
import { createPublicClient, http } from "viem";
import { check } from "@fengce/sdk";

const client = createPublicClient({ transport: http("https://rpc.xlayer.tech") });
const r = await check(client, safe, { to: USDT0, data: transferCalldata });
// { allowed: false, reason: "MAX_PER_BUY", limit: 30000000n, guard: "0x9D2A…8E6e", refusedTo: "0x779D…3736" }
```

`check` runs the Safe's own guard on the transaction (one `eth_call` with the Safe as sender; nothing is sent and no
signature is needed), so the answer is the one the Safe would give. Batches: pass the MultiSendCallOnly call with
`operation: 1`. A Safe without a guard returns `{ allowed: true, guard: null }`.

| `reason` | Meaning |
|---|---|
| `MAX_PER_BUY` | the max-per-buy circuit (NAND #2) refused: over the cap, paying USDT0; `limit` is the cap |
| `CIRCUIT` | another pinned policy circuit refused |
| `TRADES_PER_HOUR` | counter circuit #7: too many swaps this clock hour (UTC) |
| `QUIET_HOURS`, `HOLD_LOCK`, `TILT_SHIELD`, `AGENT_CAP` | FengceGuardV3 rules (`code` 3, 4, 5, 6) |
| `NOT_CONFIGURED` | a Fengce guard is installed but has no policy for this Safe |
| `DELEGATECALL` | a delegatecall other than MultiSendCallOnly |
| `ADMIN` | a Safe admin change that must wait for the timelock or recovery |
| `OTHER` | anything else (`detail` has the decoded error) |

## Schemas

```ts
import { parseSchema, schemaHash, encodeInputs, toLayout } from "@fengce/sdk";

const schema = parseSchema(readFileSync("nand-limit.schema.json", "utf8")); // validates like Schema.validate
schemaHash(schema);                        // equals Schema.hash on-chain; pin this
encodeInputs(schema, { overLimit: true }); // "0x03": strict, LSB first, never truncates
toLayout(schema);                          // the Schema.Layout struct for contract calls
```

File format and binding sources: see `contracts/src/schema.ts` and `docs/INTEGRATION.md`. Examples:
`examples/nand-limit.schema.json`, `examples/comparator16.schema.json`, `examples/encode.ts`.

## Install calldata for a Safe

```ts
import { buildInstall } from "@fengce/sdk";

const { calls, multiSend } = await buildInstall(publicClient, {
  safe, guard, pinId, schema,
  recoveryDelay: 172_800n, recoveryWindow: 172_800n, adminDelay: 86_400n,
});
```

Returns `configure`, `setGuard`, `setModuleGuard` (in that order) and the same three as one MultiSendCallOnly
batch. Throws `InstallError` if the Safe has modules enabled. It only builds calldata. Example:
`examples/install-calldata.ts`.

## Quote

```sh
fengce-quote <processor> <circuitId> [--rpc URL] [--port N] [--out FILE] [--input 0xBYTES] [--schema FILE --values JSON]
```

Needs `anvil` (Foundry) on PATH. Starts a local fork of X Layer, deploys PinRegistry and FengceGuard on it,
measures gas on the full Safe path (Safe execution overhead, pre-check and outcome check, reported separately),
assigns a tier from the full Safe path (`contracts/src/tiers.json`: Green up to 1M gas, Amber up to 3.5M, Red above), pins the circuit on the fork with the resulting `certificateHash` and checks what
the registry stored. Nothing is sent to the real chain. Programmatic use: `quote(env, processor, id, options)`.

The certificate hash is keccak256 of the certificate's canonical JSON (`canonicalJson`: keys sorted, no
whitespace). Certificates are not signed.

Other exports: `parseRefs` (netlist REF records), `refClosure` (dependency closure hash, as PinRegistry computes
it), `tierFor`, `PinRegistryArtifact` and `FengceGuardArtifact` (ABI and bytecode).

## Local evaluation

```ts
import { evaluateLocally, evaluateTrace, preSign } from "@fengce/sdk";

await evaluateLocally(client, processor, circuitId, "0x02");               // { output, newState }, from the on-chain netlist
await evaluateTrace(client, processor, circuitId, "0x02");                 // also every gate's output and topological level (REF nested)
await preSign(client, { processor, circuitId, schema }, safe, { to, value, data }); // facts -> input -> "allow" | "deny"
```

The interpreter follows TAP-02 (NAND, LATCH with state, REF sub-circuits) on the netlist bytes read from chain.
`scripts/differential.ts` compares it with on-chain `eval` on random inputs (`npm run test:live`);
`scripts/trace-check.ts` compares `evaluateTrace` with on-chain `eval` (`npx tsx scripts/trace-check.ts`).
`preSign` covers native transfers, ERC-20 transfer and approve offline; use the app's [Try it](https://getfengce.vercel.app/try/) page for real calls through a Safe.

## Development

| Command | What |
|---|---|
| `npm test` | Unit tests |
| `npm run typecheck` | Type check |
| `npm run sync-artifacts` | Refresh `contracts/src/artifacts.ts` after `forge build` in the repository root |
| `npx tsx scripts/gen-vectors.ts` | Refresh `contracts/test/vectors/hashes.json` (read-only RPC calls) |

## License

MIT
