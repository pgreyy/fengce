# Try Fengce

A short guide for outside testers. Fengce runs on X Layer mainnet (chain 196) with real money, so test with a **fresh
Safe holding a few dollars, never a real treasury**.

## Before you start

- **Use a new Safe.** Create a Safe v1.5.0 on X Layer just for this test and put a few dollars of USDT0 in it, plus a
  little OKB in your owner account for gas (each transaction costs a fraction of a cent).
- **Removal takes time on purpose.** Once Fengce is installed, removing it needs **every owner's signature** and waits at
  least **2 days** (recovery delay), and the recovery is visible on chain. Changing the policy waits at least **1 day**
  (admin delay). Do not install it on a Safe you might need to empty quickly.
- **No audit yet.** Fengce has not been independently reviewed. Slither reports 0 High findings, which is not an audit.
- **Nothing on the website signs for you.** [getfengce.vercel.app](https://getfengce.vercel.app) only reads the chain and
  builds an unsigned payload; you review and sign in your Safe.

## Install in five steps

1. **Create the test Safe.** Use Safe{Wallet} at app.safe.global (check that X Layer is in its network list) or any Safe
   v1.5.0 deployment on X Layer. One owner is fine for a test. Send it a few dollars of USDT0.
2. **Open Protect.** On [getfengce.vercel.app/protect](https://getfengce.vercel.app/protect/), choose **Safe**, go to **Install**, paste your
   Safe address, pick a policy (for example *Stablecoin Transfer Limit*) and a cap in base units (USDT0 has 6 decimals:
   `1000000` is 1 USDT0). Add the tokens to check (USDT0 is filled in).
3. **Run the preflight.** It checks existing approvals from your Safe. If something is found, revoke it first, or tick
   *keep* to install anyway (the guard then records a warning). A new Safe has none.
4. **Download the Transaction Builder JSON** and import it in your Safe's Transaction Builder. It holds three transactions,
   in order: `configure` on FengceGuard, `setGuard`, `setModuleGuard`. Review them, then sign and execute the batch.
5. **Check the result** on [Protect → Check a wallet](https://getfengce.vercel.app/protect/?step=3&wallet=safe): enter your address. *Fengce guards* should
   read **ON**, with your policy pin and timelocks.

## See Allowed and Denied

- **Before sending**, test any transaction in the **Try it** tab of the policy's page in the [Catalog](https://getfengce.vercel.app/catalog/): use the
  same cap, enter the transfer, press Run, and watch the circuit decide gate by gate. For your own Safe's exact policy, the
  API answers too: `POST https://getfengce.vercel.app/api/preflight` with `{"safe", "to", "value", "data"}` (see
  [API.md](API.md)).
- **From your Safe**: propose a USDT0 transfer **above** your cap. The guard refuses it: the Safe interface reports the
  transaction would fail, and if you execute anyway it reverts and nothing moves. A transfer **within** the cap goes through.
  Owner transactions that the guard refuses revert and leave no event.
- **Agents**: an agent acting through AgentExecutor that hits the limit does not revert; it records a `Denied` event, which
  Protect → Check a wallet lists. See the live example on the [v2 demo Safe](https://getfengce.vercel.app/protect/?step=3&wallet=safe&address=0x0bb926DC7F79e4CEFFB30a67E8291C56C3F50707).

## Removing it

Schedule a recovery from the Safe with every owner's signature, wait the recovery delay (at least 2 days), then execute it
within the recovery window. Details: [INTEGRATION.md](INTEGRATION.md).

## Feedback

Open an issue with the [feedback template](https://github.com/pgreyy/fengce/issues/new?template=feedback.yml): what you
tried, the transaction hashes, and what you expected. Never post a private key, seed phrase or signature.
