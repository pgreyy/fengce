# Public API

`https://getfengce.vercel.app/api/...`, specified in [openapi.yaml](openapi.yaml) (OpenAPI 3.1). Read-only: every endpoint
reads X Layer mainnet (chain 196, release v2) through the public RPCs and sends nothing. It runs the same code as the app's
pages ([app/src/lib/data.ts](../app/src/lib/data.ts)) as Vercel functions ([app/api-src](../app/api-src)); the pages
themselves read the chain from the browser and never call this API.

| Method and path | What | Cache |
|---|---|---|
| `GET /api/catalog` | Listed policies: pin, processor and circuit, tier, Catalog eval gas, full Safe path gas (Quote), gates, installs, designer | 30 s |
| `GET /api/circuit/:processor/:id` | A circuit: sizes, hashes, dependency tree, eval gas, vectors evaluated on chain now | 30 s |
| `GET /api/safe/:address` | A Safe: owners, threshold, guards, modules, Fengce configuration, Denied agent calls, guard events | 10 s |
| `POST /api/simulate` | What a policy would decide for a transaction: facts, input bits, output, decision | none |
| `POST /api/preflight` | A transaction against the policy installed on a Safe (its own circuit and bindings): allow, deny or not enforced | none |
| `POST /api/install` | Preflight of existing approvals and, if clean, Safe Transaction Builder JSON | none |

**Simulation is not enforcement.** `/api/simulate` runs one `eth_call`: a PolicySimulator contract is created inside the
call (never deployed), decodes the transaction, encodes the input and evaluates the pinned circuit. It predicts the
decision. The decision that counts is made in the wallet, when FengceGuard or a Fengce hook runs during execution.

**Preflight is the check an agent should make before acting** for a Safe: it asks the Safe's own FengceGuard
(`checkContext`, view only). A `deny` means the wallet will refuse the transaction. Budgets per period, floors and the outcome
check also apply at execution.

**Events.** Installs and Safe events come from the event snapshot shipped with the build
([app/public/events-snapshot.json](../app/public/events-snapshot.json), refreshed by `npm run snapshot` in `app/`) plus a
live scan of newer blocks in 100-block windows (the X Layer `eth_getLogs` limit). Every response with events says which
blocks it covers (`history`).

**Errors.** `400` with `{ "error": "...", "details": ... }` for bad input, an unknown policy, or an RPC that did not answer;
`405` for a GET on a POST route.

```sh
curl -s https://getfengce.vercel.app/api/catalog | jq '.entries[] | {name, tier, installs}'
curl -s https://getfengce.vercel.app/api/safe/0x0bb926DC7F79e4CEFFB30a67E8291C56C3F50707 | jq '.deniedAgentCalls'
curl -s -X POST https://getfengce.vercel.app/api/simulate -H 'content-type: application/json' \
  -d '{"preset":"nand-limit","cap":"1000000","to":"0x779Ded0c9e1022225f8E0630b35a9b54bE713736","data":"0xa9059cbb000000000000000000000000000000000000000000000000000000000000beef000000000000000000000000000000000000000000000000000000000016e360"}'
```
