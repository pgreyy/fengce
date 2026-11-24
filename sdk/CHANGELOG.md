# Changelog

## 0.1.1

- `readCatalog` reads every Catalog entry in parallel (one round of calls; a batching transport sends them together)
  instead of one call after another. Same result, in listing order.
- README: the app's simulator is now the **Try it** tab of each policy page in the Catalog; the wording says so.
- README: links to the app pages (Catalog, Protect, Verdict) and to this changelog.

## 0.1.0

- First release: schemas and schema hashes, Quote certificates, Safe guard install calldata, local evaluation and
  `evaluateTrace`, the `fengce-quote` CLI.
