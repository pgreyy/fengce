# Security

Short version of what Fengce enforces, what it cannot stop, and what you trust. Details and tests:
[THREAT-MODEL.md](THREAT-MODEL.md). There has been **no independent security review**; Slither reports 0 High findings
(not an audit).

## Timelocks

| Change | Wait | Who |
|---|---|---|
| Tighten a limit (lower max per buy, fewer trades per hour, longer hold, longer cooldown) | none (guard v3); 1 day on v2 | the Safe's owners |
| Loosen a limit, change the circuit, add an allowlist entry or decoder | 1 day (7 days if the Safe names a partner, unless the partner approves earlier) | the Safe's owners |
| Owner, module or fallback handler changes on the Safe | 1 day (same timelock) | the Safe's owners |
| Remove or replace the guard | recovery: 2 days, then a 2-day window, signed by **every** owner | all owners |

Every scheduled change is a public `AdminScheduled` event; the app shows it with its countdown.

## What the guard stops

- Any call from the Safe that the pinned circuit refuses (max per buy, trades per hour, and on v3 quiet hours, hold lock,
  Tilt-shield and agent caps), whichever app, owner, module or agent sends it, including calls inside MultiSend batches.
- Delegatecalls to anything but MultiSendCallOnly 1.5.0 (checked by code hash): no wallet upgrade through a delegatecall.
- A swapped circuit: PinRegistry fingerprints the circuit, every processor it depends on and the code behind them; any
  change makes every check fail closed (deny).
- Agents loosening their own rules: agents act as modules through AgentExecutor and cannot reach the guard or the Safe's
  admin functions.

## What it cannot stop

- Funds in wallets without Fengce (plain EOAs, 7702 and embedded wallets): move funds to a Safe.
- Approvals granted before install (the first configuration refuses to proceed if it finds them, unless overridden).
- All owners together: owners holding every signature can schedule recovery and remove the guard after the wait.
- ERC-6900 accounts: enforced through a hook that the wallet lets you remove without running it
  ([WALLETS.md](WALLETS.md), Known bypasses).
- What a circuit cannot see: price, counterparty risk, or whether an allowed transaction is a good idea.

## What you trust

- **TapeOut processor factory.** An upgradeable proxy that is not sealed; its implementation sits only in the ERC-1967
  slot, so no contract can read it, and an upgrade is not detected on-chain. `isPinned` relies on the factory's `isCPU`, so
  an upgraded factory could change what counts as registered. Watch the factory off chain.
- **Processor beacon.** Processors are beacon proxies; a beacon upgrade keeps their code hash. Pins record the beacon's
  implementation and its code hash, so an upgrade fails the check (tested). At block 76,924,400 the beacon's `owner()`
  returned the zero address, so `upgradeTo` cannot be called.
- **X Layer and Safe 1.5.0.**
