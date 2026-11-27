import { useEffect, useState } from "react";
import { getAddress, isAddress, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { DEPLOYMENT, client } from "../lib/chain";
import { check } from "@fengce/sdk";
import { ActivityTable, useActivity } from "../fengce/ActivityTable";
import { record } from "../fengce/activity";
import { TOKENS, multiSend, sendCall, swapCalls } from "../fengce/engine";
import { readInstalled, usdt0, type Installed } from "../fengce/reads";
import { Addr, href, mount, short, StartLink } from "../fengce/ui";
import { EXPLORER_TX, balances, sendFromWallet, simulateSafeTx, useWallet } from "../fengce/wallet";

type Sym = keyof typeof TOKENS;
const SYMS: Sym[] = ["USDT0", "WOKB", "USDC"];
const label = (s: Sym) => TOKENS[s].symbol;
const FACTORY = "0x4B2ab38DBF28D31D467aA8993f6c2585981D6804" as Address;
const factoryAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const poolAbi = parseAbi(["function slot0() view returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool)", "function liquidity() view returns (uint128)", "function token0() view returns (address)"]);
const DEMO = getAddress(DEPLOYMENT.demoSafe) as Address;
/** The mainnet acceptance Safe (max per buy 30 USDT0): what /try checks against when no wallet is connected. */
const SIM_SAFE = getAddress("0x5641DA334011832Feec997875781a3D40239465e") as Address;
const SIM_PAYEE = "0x000000000000000000000000000000000000dEaD" as Address;

/** Deepest Uniswap V3 pool for a pair and its mid price (tokenOut per tokenIn, in whole units). */
async function quote(a: Sym, b: Sym): Promise<{ fee: number; price: number } | null> {
  const A = TOKENS[a], B = TOKENS[b];
  let best: { fee: number; price: number; liq: bigint } | null = null;
  for (const fee of [100, 500, 3000, 10000]) {
    const pool = await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "getPool", args: [A.address, B.address, fee] });
    if (/^0x0+$/.test(pool)) continue;
    const [liq, [sqrt], t0] = await Promise.all([
      client.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" }),
      client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
      client.readContract({ address: pool, abi: poolAbi, functionName: "token0" }),
    ]);
    if (liq === 0n) continue;
    const p01 = (Number(sqrt) / 2 ** 96) ** 2; // token1 per token0, base units
    const aIs0 = t0.toLowerCase() === A.address.toLowerCase();
    const raw = aIs0 ? p01 : 1 / p01; // B base units per A base unit
    const price = raw * 10 ** (A.decimals - B.decimals);
    if (!best || liq > best.liq) best = { fee, price, liq };
  }
  return best ? { fee: best.fee, price: best.price } : null;
}

function Try() {
  const w = useWallet();
  const safe = w.safe;
  const [mode, setMode] = useState<"swap" | "send">("swap");
  const [from, setFrom] = useState<Sym>("USDT0");
  const [to, setTo] = useState<Sym>("WOKB");
  const [amt, setAmt] = useState("5");
  const [recipKind, setRecipKind] = useState<"mine" | "other">("mine");
  const [recip, setRecip] = useState("");
  const [recipFocus, setRecipFocus] = useState(false);
  const [q, setQ] = useState<{ fee: number; price: number } | null>(null);
  const [usd, setUsd] = useState<number | null>(null);
  const [inst, setInst] = useState<Installed | null>(null);
  const [bal, setBal] = useState<Record<string, bigint> | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; reason: string; tx?: Hex; canRecord?: { data: Hex }; simulated?: boolean; code?: string | null } | null>(null);
  const [seen, setSeen] = useState(0);
  useEffect(() => void (res && setSeen((x) => x + 1)), [res]);
  const recent = useActivity(safe ?? DEMO, 10, seen);

  useEffect(() => {
    readInstalled(safe ?? DEMO).then(setInst, () => setInst(null));
    if (safe) balances(safe).then(setBal, () => setBal(null));
  }, [safe]);
  useEffect(() => {
    setQ(null);
    if (mode === "swap" && from !== to) quote(from, to).then(setQ, () => setQ(null));
    const toUsd = from === "WOKB" ? quote("WOKB", "USDT0").then((x) => x?.price ?? null) : Promise.resolve(1);
    toUsd.then((p) => setUsd(p === null ? null : (parseFloat(amt) || 0) * p));
  }, [from, to, mode, amt]);

  const amount = (() => {
    try {
      return parseUnits(amt || "0", TOKENS[from].decimals);
    } catch {
      return 0n;
    }
  })();
  const recipient = recipKind === "mine" ? w.account : isAddress(recip) ? getAddress(recip) : null;

  /** No wallet: run the transaction against the acceptance Safe's guard (one eth_call, nothing sent). */
  async function simulate() {
    setBusy(true);
    setRes(null);
    try {
      if (amount === 0n) throw new Error("Enter an amount.");
      const tx = mode === "swap"
        ? { ...multiSend(swapCalls(SIM_SAFE, TOKENS[from].address, TOKENS[to].address, amount, 0n, q?.fee ?? 500)), operation: 1 as const }
        : (() => {
            const c = sendCall(TOKENS[from].address, recipKind === "other" && isAddress(recip) ? getAddress(recip) : SIM_PAYEE, amount);
            return { to: c.to, data: c.data, operation: 0 as const };
          })();
      const r = await check(client as never, SIM_SAFE, tx);
      const why = r.allowed
        ? `within its limits${r.limit ? "" : ""}`
        : r.reason === "MAX_PER_BUY" && r.limit !== undefined
          ? `over its max per buy of ${Number(r.limit) / 1e6} USDT0`
          : r.reason === "TRADES_PER_HOUR"
            ? "too many trades this clock hour"
            : (r.reason ?? "refused").toLowerCase().replace(/_/g, " ");
      setRes({ ok: r.allowed, reason: `Simulated on the demo Safe ${short(SIM_SAFE)}: ${why}.`, simulated: true, code: r.allowed ? null : r.reason });
    } catch (e) {
      setRes({ ok: false, reason: (e as Error).message, simulated: true });
    } finally {
      setBusy(false);
    }
  }

  async function go(forceOnChain = false, data?: Hex) {
    setBusy(true);
    try {
      if (!w.account || !safe) throw new Error("Connect your wallet and choose your Safe first.");
      if (amount === 0n) throw new Error("Enter an amount.");
      const tx = mode === "swap"
        ? multiSend(swapCalls(safe, TOKENS[from].address, TOKENS[to].address, amount, 0n, q?.fee ?? 500))
        : (() => {
            if (!recipient) throw new Error("Enter a recipient address.");
            const c = sendCall(TOKENS[from].address, recipient, amount);
            return { to: c.to, data: c.data, operation: 0 as const };
          })();
      const what = mode === "swap" ? `Swap ${amt} ${label(from)} → ${label(to)}` : `Send ${amt} ${label(from)}`;
      const app = mode === "swap" ? "Uniswap V3" : recipKind === "mine" ? "to my other wallet" : `to ${short(recipient!)}`;
      if (forceOnChain && data) {
        const r = await sendFromWallet(safe, data, 1_500_000n);
        record(safe, { time: Date.now(), action: what, app, amount: amt, ok: r.status === "success", reason: res?.reason ?? "refused", tx: r.hash });
        setRes({ ok: r.status === "success", reason: r.status === "success" ? "it went through" : `${res?.reason ?? "refused"} (reverted on chain)`, tx: r.hash });
        return;
      }
      const sim = await simulateSafeTx(w.account, safe, tx);
      if (!sim.ok) {
        record(safe, { time: Date.now(), action: what, app, amount: amt, ok: false, reason: sim.reason.text });
        setRes({ ok: false, reason: sim.reason.text, canRecord: { data: sim.data } });
        return;
      }
      const r = await sendFromWallet(safe, sim.data);
      record(safe, { time: Date.now(), action: what, app, amount: amt, ok: r.status === "success", reason: r.status === "success" ? "within your limits" : "reverted", tx: r.hash });
      setRes({ ok: r.status === "success", reason: r.status === "success" ? "within your limits" : "reverted on chain", tx: r.hash });
      balances(safe).then(setBal, () => undefined);
      readInstalled(safe).then(setInst, () => undefined);
    } catch (e) {
      setRes({ ok: false, reason: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const chip = (on: boolean) => ({ "aria-pressed": on, className: "chip" });
  const fmt = (v: bigint | undefined, s: Sym) => (v === undefined ? "–" : (Number(v) / 10 ** TOKENS[s].decimals).toLocaleString("en-US", { maximumFractionDigits: 4 }));
  const out = q ? (parseFloat(amt) || 0) * q.price * (1 - q.fee / 1e6) : null;

  return (
    <main className="pg w" style={{ paddingTop: 64, paddingBottom: 110, display: "flex", flexDirection: "column", gap: 26 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="lbl">Try it · your limits apply across supported apps</span>
          <h1 className="disp" style={{ fontSize: 46 }}>{mode === "swap" ? "Swap through your Safe" : "Send from your Safe"}</h1>
        </div>
        <div className="seg" role="group" aria-label="Mode">
          <button type="button" aria-pressed={mode === "swap"} onClick={() => (setMode("swap"), setRes(null))}>Swap</button>
          <button type="button" aria-pressed={mode === "send"} onClick={() => (setMode("send"), setRes(null))}>Send</button>
        </div>
      </div>
      {(!w.account || !safe) && (
        <p className="note">
          <b>Connect your wallet and choose your Safe</b> to run real trades through your limits. <StartLink className="alink accent">Get started</StartLink>
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 520px) minmax(0, 1fr)", gap: 40, alignItems: "start" }} className="try-cols">
        <section className="panel" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14, borderRadius: 16 }}>
          <div className="card" style={{ borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="lbl">{mode === "swap" ? "You pay" : "You send"}</span>
              <span className="mono" style={{ fontSize: 12.5, color: "var(--muted)" }}>balance {bal ? fmt(bal[label(from)], from) : "–"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input aria-label="Amount" value={amt} onChange={(e) => (setAmt(e.target.value.replace(/[^0-9.]/g, "")), setRes(null))} inputMode="decimal" className="num" style={{ flex: 1, minWidth: 0, fontSize: 34, background: "transparent", border: 0, outline: "none", padding: 0 }} />
              <span style={{ padding: "8px 14px", borderRadius: 999, background: "var(--raised)", border: "1px solid var(--line)", fontWeight: 500 }}>{label(from)}</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SYMS.map((s) => (
                <button key={s} type="button" {...chip(from === s)} onClick={() => (setFrom(s), s === to && setTo(from), setRes(null))}>{label(s)}</button>
              ))}
            </div>
          </div>
          {mode === "swap" ? (
            <>
              <button type="button" className="swap-flip" aria-label="Switch tokens" onClick={() => (setFrom(to), setTo(from), setRes(null))} style={{ alignSelf: "center", width: 36, height: 36, margin: "-6px 0", borderRadius: 10, border: "1px solid var(--line)", background: "var(--raised)" }}>⇅</button>
              <div className="card" style={{ borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="lbl">You get</span>
                  <span className="mono" style={{ fontSize: 12.5, color: "var(--muted)" }}>via Uniswap V3{q ? ` · fee ${q.fee / 1e4}%` : ""}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="num" style={{ flex: 1, fontSize: 34 }}>≈ {out === null ? "–" : out.toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
                  <span style={{ padding: "8px 14px", borderRadius: 999, background: "var(--raised)", border: "1px solid var(--line)", fontWeight: 500 }}>{label(to)}</span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {SYMS.filter((s) => s !== from).map((s) => (
                    <button key={s} type="button" {...chip(to === s)} onClick={() => (setTo(s), setRes(null))}>{label(s)}</button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="card" style={{ borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="lbl">To</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" {...chip(recipKind === "mine")} onClick={() => setRecipKind("mine")}>My other wallet</button>
                <button type="button" {...chip(recipKind === "other")} onClick={() => setRecipKind("other")}>Someone else</button>
              </div>
              {recipKind === "mine" ? (
                w.account ? <Addr value={w.account} label="Copy your wallet address" /> : <span className="mono small">connect your wallet</span>
              ) : (
                <input
                  aria-label="Recipient"
                  title={recip || undefined}
                  value={recipFocus || !isAddress(recip) ? recip : short(recip)}
                  onFocus={() => setRecipFocus(true)}
                  onBlur={() => setRecipFocus(false)}
                  onChange={(e) => setRecip(e.target.value.trim())}
                  placeholder="0x…"
                  className="field mono"
                  spellCheck={false}
                  autoComplete="off"
                />
              )}
            </div>
          )}
          <div className="kv"><span className="muted">Value</span><span className="num">≈ ${usd === null ? "–" : usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span></div>
          {w.account && safe ? (
            <button type="button" className="pill accent big" style={{ borderRadius: 12 }} disabled={busy} onClick={() => go()}>
              {busy ? "Confirm in your wallet" : mode === "swap" ? `Swap ${label(from)} → ${label(to)}` : `Send ${amt || 0} ${label(from)}`}
            </button>
          ) : (
            <button type="button" className="pill accent big" style={{ borderRadius: 12 }} disabled={busy} onClick={simulate}>
              {busy ? "Checking on X Layer" : "Test it (simulated)"}
            </button>
          )}
          {res && (
            <div className="result">
              <span className="mono" style={{ color: res.ok ? "var(--allow)" : "var(--deny)" }}>{res.ok ? "ALLOWED" : res.tx ? "REVERTED" : "REFUSED"}</span>
              {res.code && <span className="tag n mono">{res.code}</span>}
              <span style={{ fontSize: 15, color: "var(--muted)", flex: "1 1 220px" }}>
                {res.reason}
                {res.tx && (
                  <>
                    {" · "}
                    <a className="alink accent" href={EXPLORER_TX(res.tx)} target="_blank" rel="noreferrer noopener">tx {short(res.tx)}</a>
                  </>
                )}
              </span>
              {res.simulated && (
                <span style={{ display: "flex", gap: 12, alignItems: "center", flexBasis: "100%" }}>
                  <span className="tag n">Simulated · nothing sent</span>
                  <StartLink className="alink accent">Do it for real</StartLink>
                </span>
              )}
              {res.canRecord && (
                <button type="button" className="alink" disabled={busy} onClick={() => go(true, res.canRecord!.data)} title="Sends the transaction anyway with a fixed gas limit, so the refusal is recorded on X Layer as a reverted transaction (costs gas).">
                  Record this on chain
                </button>
              )}
            </div>
          )}
        </section>
        <aside style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--line)" }}>
          <span className="lbl" style={{ padding: "14px 0" }}>Limits this wallet enforces{!safe ? " · demo Safe" : ""}</span>
          <div className="kv"><span>Max per buy</span><span className="mono muted">{!inst ? "…" : inst.set ? `${usdt0(inst.maxPerBuy)} USDT0` : "not set"}</span></div>
          <div className="kv"><span>Trades per clock hour (UTC)</span><span className="mono muted">{!inst ? "…" : inst.trades ? `${inst.trades.usedThisHour} of ${inst.trades.perHour} used` : "off"}</span></div>
          <div className="kv"><span>Quiet hours</span><span className="mono muted">coming soon</span></div>
          <div className="kv"><span>Hold lock on send</span><span className="mono muted">coming soon</span></div>
          <div className="kv"><span>Tilt-shield safe mode</span><span className="mono muted">coming soon</span></div>
          <span className="small" style={{ marginTop: 14 }}>
            This page builds the transaction; your Safe's guard decides. The same checks run when you use another app through this Safe, because they live
            in the wallet, not here. Refused attempts are simulated first and cost nothing unless you record them on chain.
          </span>
        </aside>
      </div>
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span className="lbl">Recent{!safe ? " · demo Safe" : ""}</span>
          <a className="alink" href={href("wallet", undefined, "activity")}>All activity</a>
        </div>
        <ActivityTable rows={recent.rows} err={recent.err} max={5} empty="No trades yet on this Safe." />
      </section>
      <style>{`@media (max-width: 900px) { .try-cols { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
    </main>
  );
}

mount("try", 1, <Try />);
