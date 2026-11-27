# Changelog

## 0.2.0

- `check(client, safe, tx)`: runs the Safe's guard on a transaction (one `eth_call`, nothing sent) and returns
  `{ allowed, reason, code?, limit?, guard, refusedTo?, detail? }`. Reason codes for FengceGuard v2 and FengceGuardV3:
  `MAX_PER_BUY`, `CIRCUIT`, `TRADES_PER_HOUR`, `QUIET_HOURS`, `HOLD_LOCK`, `TILT_SHIELD`, `AGENT_CAP`,
  `NOT_CONFIGURED`, `DELEGATECALL`, `ADMIN`, `OTHER`. Exports `V3_REASONS` and `MAX_BUY_PIN`.
- README: the app is getfengce.vercel.app.

## 0.1.1

- `readCatalog` reads every Catalog entry in parallel (one round of calls; a batching transport sends them together)
  instead of one call after another. Same result, in listing order.
- README: links to the app (Okun, getokun.vercel.app) and its engine page, and to this changelog.

## 0.1.0

- First release: schemas and schema hashes, Quote certificates, Safe guard install calldata, local evaluation and
  `evaluateTrace`, the `fengce-quote` CLI.
