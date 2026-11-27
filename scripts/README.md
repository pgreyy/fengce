# scripts

Shell helpers that drive on-chain steps. Each prints what it does; none stores a key or a password.

- [`m2-onchain.sh`](m2-onchain.sh) Milestone 2 on X Layer mainnet: tape out the Tilt-shield latch, deploy FengceGuardV3, a
  demo Safe with an allowed swap, recorded refusals and a Tilt-shield trip. `--dry-run` runs it on a local fork.
- [`m2-agent-calls.sh`](m2-agent-calls.sh) prints the two AgentExecutorV3 calls for the OKX Agentic Wallet demo.
