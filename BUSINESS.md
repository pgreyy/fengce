# Business model

Fengce is on-chain limits for Safe and agent wallets on X Layer. The core stays free; revenue comes from circuits,
checks and integrations around it.

| Stream | Who pays | How | Status |
|---|---|---|---|
| Core limits | nobody | Max per buy, trades per hour, quiet hours, hold lock, Tilt-shield, agent caps: free to install and use, forever. Users pay only X Layer gas. | live (v2), v3 built |
| Catalog install fee | the Safe installing a circuit | A designer lists a pinned circuit with test vectors and sets an install fee. `Catalog.payInstall` splits each fee on chain: **80% to the designer, 20% to the Fengce treasury**. Designers opt in by listing. | contract live, fees unused so far |
| Per-check fees (x402) | agents and apps that call the check API at volume | `check(safe, tx)` stays free as an SDK call against a public RPC; a hosted, rate-limit-free check endpoint charges per check over HTTP 402 (x402), paid in USDT0 on X Layer. | later |
| Wallet integrations | wallets | Licensing and support for showing a Safe's limits and the guard's answer on the wallet's own confirm screen (the SDK does the reading). | later |

## Why this order

Limits only protect people if they are installed, so the part that protects is free. Designers are paid for circuits
others choose to install, which grows the catalog without Fengce writing every rule. Paid checks only make sense once
agents call them at volume.

## The OKX path

1. **Hackathon**: Fengce on X Layer mainnet, built on TapeOut circuits, with the OKX Agentic Wallet as an agent key on a
   Fengce-bound Safe.
2. **Plugin Store**: the `fengce` agent skill (OnchainOS format) so any agent checks a Safe's limits before it acts
   ([docs/plugin-store-pr.md](docs/plugin-store-pr.md); submissions are closed for now).
3. **Wallet confirm screen**: OKX Wallet reads a Safe's limits with the SDK and shows "this would be refused: over your
   max per buy" before the user signs.

Treasury Safe on X Layer: `0x5c53CDaED1cd64fc25AcC071b0Ca7ef891bB5661`.
