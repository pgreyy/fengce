# Demo video script (about 2 minutes 30)

Every number below is a real transaction on X Layer mainnet or a fork check in this repo ([CLAIMS.md](CLAIMS.md)). Circuits
shown as "ours" are Fengce's own; the import example (1.2.131) is someone else's unlisted circuit and is labelled so.

| Time | Screen | Say |
|---|---|---|
| 0:00 | Home, the vinyl hero | "Fengce puts limits inside your Safe on X Layer. Every app and every agent gets the same answer, because the check lives in the wallet." |
| 0:15 | Home, the live strip | "One Safe, four outcomes, all on mainnet: a 0.2 USDT0 swap allowed; 3 USDT0 refused by the max per buy circuit; the fifth buy after four in the same half hour refused by Tilt-shield; an agent over its daily cap denied." |
| 0:35 | Wallet menu, Create a new Safe | "A new Safe comes with guard v3 already on, in one signature." |
| 0:45 | /limits, Templates, open Vault | "Templates: Vault. Small sends now, big ones tomorrow. It limits USDT0 sends; raising the cap waits a day, or your partner approves sooner." |
| 1:00 | /limits, Add a circuit, Import, 1.2.131 | "Any TapeOut circuit can be a limit. This one is someone else's NAND, marked Unlisted. Map its inputs, see every case run on chain, and the sheet tells you exactly what changes and what gets looser." |
| 1:20 | /try, swap over the cap | "Try a swap over the cap: the Safe refuses before money moves, with the reason." |
| 1:30 | /wallet, Activity and Changes | "Everything is read back from chain. A scheduled change shows what it does in plain words, and any owner can cancel it." |
| 1:45 | /tilt-shield, live panel | "Tilt-shield on the demo Safe: tripped on mainnet by four buys in the same half hour; the latch circuit holds the pause on chain." |
| 2:00 | /agents | "Agents act through the Safe. The OKX Agentic Wallet keeps its key; over its daily cap the chain says no, with AGENT_CAP." |
| 2:15 | /docs, For judges | "Contracts on Sourcify, pinned circuits, and every transaction are on For judges. Tightening is instant; loosening waits a day." |
