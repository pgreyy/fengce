# Gas

Per-policy gas on X Layer. Definitions:

- **Full Safe path** = Safe execution overhead + pre-check + outcome check, measured on a Safe v1.5.0 transaction through
  FengceGuard and FengceInspector (the tier is taken from this figure: Green up to 1,000,000, Amber up to 3,500,000, Red above).
- **Eval gas** = the circuit evaluation only (`eval` on the processor), without the Safe or the guard.
- **Catalog eval gas** = what the Catalog measured on chain when the policy was listed (vectors run at listing).

Figures come from each policy's Quote certificate (`sdk/quotes/*.json`, `eth_estimateGas` on a fork of X Layer at the
block in the certificate) and from the v2 Catalog. Gas prices on X Layer were about 0.02 gwei on 2026-11-18, so 1,000,000 gas
cost about 0.00002 OKB.

| Policy | What it enforces | Gates | Catalog eval gas | Eval gas (Quote) | Pre-check | Outcome check | Safe overhead | Full Safe path | Tier | Certificate |
|---|---|---|---|---|---|---|---|---|---|---|
| Stablecoin Transfer Limit | a transfer passes only if its amount is at most the cap | 3 | 34,085 | 53,212 | 116,448 | 99,267 | 72,770 | 288,485 | Green | [`nand-839bdd-2.json`](../sdk/quotes/nand-839bdd-2.json) |
| Numeric Transaction Limit | a value must be at or below a limit (16-bit comparator) | 114 | 293,333 | 316,305 | 405,549 | 398,458 | 105,456 | 909,463 | Green | [`comparator-f9bbdc-7.json`](../sdk/quotes/comparator-f9bbdc-7.json) |
| Organization-Wide Policy Floor | a team policy plus an organisation's floor; both must allow | 6 | 159,800 | 180,922 | 244,159 | 207,293 | 72,770 | 524,222 | Green | [`xor-b04eb7-5.json`](../sdk/quotes/xor-b04eb7-5.json) |
| Periodic Spending Budget | one transaction per period, reset each period (stateful, through Tick) | 5 | 33,191 | – | – | – | – | – | Unsupported | [`toggle-e2a6c6-18.json`](../sdk/quotes/toggle-e2a6c6-18.json) |
| Protected Swap Policy | a swap within the cap whose proceeds return to the account | 4 | 36,174 | 55,322 | 118,287 | 101,165 | 72,770 | 292,222 | Green | [`nor-87bfca-52.json`](../sdk/quotes/nor-87bfca-52.json) |

Periodic Spending Budget is stateful (one LATCH); its state lives in Tick, so the Quote marks it Unsupported for the
plain Safe path and gives no full-path figure. The Catalog listed it Green from its on-chain eval gas.

The floor circuit used with Organization-Wide Policy Floor (circuit #3, one NAND) has its own Quote:
[`nand-floor-b04eb7-3.json`](../sdk/quotes/nand-floor-b04eb7-3.json), full Safe path 279,273 gas.

A larger circuit for comparison, [`big-2046aa-3.json`](../sdk/quotes/big-2046aa-3.json): eval 2,808,102 gas, tier Amber.

Refresh a figure: `cd sdk && npx fengce-quote <processor> <circuitId>` (needs `anvil`; nothing is sent to the chain).
