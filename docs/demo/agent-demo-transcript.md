# Agent demo transcript

Local anvil fork of X Layer mainnet at block 76268614 (2026-11-18T21:34Z). Nothing here was sent to the real chain; the
demo agent is impersonated on the fork, no key is used. The agent talks to the Fengce MCP server (`mcp/`) and then acts
through AgentExecutor on the v2 demo Safe `0x0bb926DC7F79e4CEFFB30a67E8291C56C3F50707` (policy: Stablecoin Transfer Limit, cap 1 USDT0).

**Fork:** demo Safe holds 1 USDT0.

**Agent:** I want to send 1.5 USDT0 from the demo Safe. Asking Fengce first (simulate_transaction).

**Fengce:** DENIED by Stablecoin Transfer Limit (cap 1000000): stage evaluated. Simulation only. Input bits 11, output 0.

**Agent:** I want to send 0.5 USDT0 from the demo Safe. Asking Fengce first (simulate_transaction).

**Fengce:** ALLOWED by Stablecoin Transfer Limit (cap 1000000): stage evaluated. Simulation only. Input bits 01, output 1.

**Agent:** Fengce said DENIED for 1.5 USDT0. For this demo I submit it anyway, to show the wallet itself refuses it.

**Wallet:** fork tx `0x332f4be772a0c853c06b055dcba3658e3de3c07db5a38fefd029a946e2f2c30c` (block 76268615, 179347 gas): Denied by the Safe's guard (reason 0x8374c3c0…, FengceDenied); nothing moved. Demo Safe now holds 1 USDT0.

**Agent:** Fengce said ALLOWED for 0.5 USDT0. Submitting through AgentExecutor.

**Wallet:** fork tx `0xe8c3307cb09ce4ff3b2aa09581c18d47759aa69ced4ef09ca35552fc05d237ac` (block 76268616, 212907 gas): AgentExecuted: the transfer went through. Demo Safe now holds 0.5 USDT0.

**Agent:** Done: 1.5 USDT0 refused by Fengce and by the wallet; 0.5 USDT0 allowed and sent.
