# Try Okun (powered by Fengce)

A short guide for outside testers. Fengce runs on X Layer mainnet (chain 196) with real money, so test with a **fresh
Safe holding a few dollars, never a real treasury**.

## Before you start

- **Use a new Safe.** Create a Safe v1.5.0 on X Layer just for this test and put a few dollars of USDT0 in it, plus a
  little OKB in your owner account for gas (each transaction costs a fraction of a cent).
- **Removal takes time on purpose.** Once Fengce is installed, removing it needs **every owner's signature** and waits at
  least **2 days** (recovery delay), and the recovery is visible on chain. Changing the policy waits at least **1 day**
  (admin delay). Do not install it on a Safe you might need to empty quickly.
- **No audit yet.** Fengce has not been independently reviewed. Slither reports 0 High findings, which is not an audit.
- **Nothing on the website signs for you.** [getokun.vercel.app](https://getokun.vercel.app) reads the chain and builds
  transactions; your browser wallet shows each one and you sign it. Every Safe transaction is simulated first.

## Install in four steps

1. **Connect.** Open [getokun.vercel.app/start](https://getokun.vercel.app/start/) and connect OKX Wallet or MetaMask. The app
   switches it to X Layer.
2. **Choose a Safe.** Create a new 1-of-1 Safe (one transaction, owned only by your wallet) or paste an existing Safe you own.
   Send the Safe a few dollars of USDT0.
3. **Set and test.** Pick **max per buy** (USDT0) and **trades per hour**. Move the test amount: the app runs the real pinned
   circuit on X Layer and shows ALLOWED or REFUSED before you sign.
4. **Install with one signature.** One Safe transaction sets the guard, its configuration (changes wait 1 day, removal 2 days),
   the swap decoder and the hourly counter. Then [My wallet](https://getokun.vercel.app/wallet/) reads your limits back from
   chain.

One signature works for a 1-of-1 Safe. A Safe with more owners needs its own threshold of signatures; use the Safe app.

## See allowed and refused

- **Swap or send** on [Try it](https://getokun.vercel.app/try/). A swap under your cap goes through on Uniswap V3; one over it is
  refused with the reason, before anything is sent. You can also record a refusal on chain (it reverts and costs a little gas).
- **Trades per hour**: after your N swaps in a clock hour (UTC), the next swap is refused until the hour turns.
- **Any other app** through the same Safe meets the same checks: they live in the wallet, not in this site.
- **Raising a limit** on [Limits](https://getokun.vercel.app/limits/) is scheduled on chain and can apply after 1 day; My wallet
  shows the countdown. Today the engine applies the same wait to tightening.
- **Agents**: an agent acting through AgentExecutor that hits the limit records a `Denied` event. See the live example on the
  [demo Safe](https://getokun.vercel.app/wallet/) (shown when no wallet is connected).
- **Developers**: `POST https://getfengce.vercel.app/api/preflight` with `{"safe", "to", "value", "data"}` checks a transaction
  against the policy installed on a Safe (see [API.md](API.md)).

## Removing it

Schedule a recovery from the Safe with every owner's signature, wait the recovery delay (at least 2 days), then execute it
within the recovery window. Details: [INTEGRATION.md](INTEGRATION.md).

## Feedback

Open an issue with the [feedback template](https://github.com/pgreyy/fengce/issues/new?template=feedback.yml): what you
tried, the transaction hashes, and what you expected. Never post a private key, seed phrase or signature.
