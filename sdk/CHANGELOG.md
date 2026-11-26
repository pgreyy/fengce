# Changelog

## 0.1.1

- `readCatalog` reads every Catalog entry in parallel (one round of calls; a batching transport sends them together)
  instead of one call after another. Same result, in listing order.
- README: links to the app (Okun, getokun.vercel.app) and its engine page, and to this changelog.

## 0.1.0

- First release: schemas and schema hashes, Quote certificates, Safe guard install calldata, local evaluation and
  `evaluateTrace`, the `fengce-quote` CLI.
