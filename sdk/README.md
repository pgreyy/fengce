# @fengce/sdk

TypeScript tools for [Fengce](https://github.com/pgreyy/fengce): TapeOut circuit schemas, Quote certificates and
Safe guard install calldata. Built on [viem](https://viem.sh). Node 20 or later.

## Install

Not published yet. From the repository:

```sh
cd sdk && npm ci && npm run build
```

## Schemas

```ts
import { parseSchema, schemaHash, encodeInputs, toLayout } from "@fengce/sdk";

const schema = parseSchema(readFileSync("nand-limit.schema.json", "utf8")); // validates like Schema.validate
schemaHash(schema);                        // equals Schema.hash on-chain; pin this
encodeInputs(schema, { overLimit: true }); // "0x03": strict, LSB first, never truncates
toLayout(schema);                          // the Schema.Layout struct for contract calls
```

File format and binding sources: see `src/schema.ts` and `docs/INTEGRATION.md`. Examples:
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
measures gas on the full Safe -> guard -> circuit path, assigns a tier (`src/tiers.ts`: Green up to 1M gas,
Amber up to 3.5M, Red above), pins the circuit on the fork with the resulting `certificateHash` and checks what
the registry stored. Nothing is sent to the real chain. Programmatic use: `quote(env, processor, id, options)`.

The certificate hash is keccak256 of the certificate's canonical JSON (`canonicalJson`: keys sorted, no
whitespace). Certificates are not signed.

Other exports: `parseRefs` (netlist REF records), `refClosure` (dependency closure hash, as PinRegistry computes
it), `tierFor`, `PinRegistryArtifact` and `FengceGuardArtifact` (ABI and bytecode).

## Local evaluation

```ts
import { evaluateLocally, preSign } from "@fengce/sdk";

await evaluateLocally(client, processor, circuitId, "0x02");               // { output, newState }, from the on-chain netlist
await preSign(client, { processor, circuitId, schema }, safe, { to, value, data }); // facts -> input -> "allow" | "deny"
```

The interpreter follows TAP-02 (NAND, LATCH with state, REF sub-circuits) on the netlist bytes read from chain.
`scripts/differential.ts` compares it with on-chain `eval` on random inputs (`npm run test:live`).
`preSign` covers native transfers, ERC-20 transfer and approve offline; use the app's simulator for other calls.

## Development

| Command | What |
|---|---|
| `npm test` | Unit tests |
| `npm run typecheck` | Type check |
| `npm run sync-artifacts` | Refresh `src/artifacts.ts` after `forge build` in the repository root |
| `npx tsx scripts/gen-vectors.ts` | Refresh `test/vectors/hashes.json` (read-only RPC calls) |

## License

MIT
