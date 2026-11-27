import { useEffect, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { guardOf, type GuardKind } from "../okun/addSafe";
import { installCalls } from "../okun/engine";
import { parseAmount } from "../okun/LimitsEditor";
import { PREPARED } from "../okun/reads";
import { Addr, href, mount, param, short } from "../okun/ui";
import { safeInfo, useWallet } from "../okun/wallet";

/** Safe{Wallet} Transaction Builder batch file (version 1.0). The builder groups the calls into one MultiSend. */
function batchFile(safe: Address, calls: ReturnType<typeof installCalls>, maxPerBuy: number, perHour: number) {
  return {
    version: "1.0",
    chainId: "196",
    createdAt: Date.now(),
    meta: {
      name: "Fengce: install limits",
      description: `Installs FengceGuard on this Safe with max per buy ${maxPerBuy} USDT0${perHour ? ` and ${perHour} trades per clock hour (UTC)` : ""}. Built at getfengce.vercel.app/install for ${safe}.`,
      txBuilderVersion: "1.16.5",
      createdFromSafeAddress: safe,
      createdFromOwnerAddress: "",
    },
    transactions: calls.map((c) => ({ to: c.to, value: c.value.toString(), data: c.data, contractMethod: null, contractInputsValues: null })),
  };
}

function Install() {
  const w = useWallet();
  const [addr, setAddr] = useState(param("safe") ?? w.safe ?? "");
  const [cap, setCap] = useState("2");
  const [perHour, setPerHour] = useState(5);
  const [state, setState] = useState<{ safe: Address; threshold: number; owners: number; guard: Address | null; kind: GuardKind } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setState(null);
    setErr(null);
    if (!isAddress(addr)) return;
    const safe = getAddress(addr) as Address;
    let live = true;
    Promise.all([safeInfo(safe), guardOf(safe)]).then(
      ([i, g]) => live && setState({ safe, threshold: i.threshold, owners: i.owners.length, ...g }),
      () => live && setErr("No Safe at this address on X Layer."),
    );
    return () => void (live = false);
  }, [addr]);

  const capN = parseAmount(cap);
  const calls = state && capN !== null && PREPARED ? installCalls(state.safe, { maxPerBuy: BigInt(Math.round(capN * 1e6)), tradesPerHour: perHour }, PREPARED) : null;

  const download = () => {
    if (!state || !calls || capN === null) return;
    const blob = new Blob([JSON.stringify(batchFile(state.safe, calls, capN, perHour), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fengce-install.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <main className="pg w" style={{ paddingTop: 64, paddingBottom: 110, display: "flex", flexDirection: "column", gap: 40 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
        <span className="lbl">Install with Safe{"{Wallet}"}</span>
        <h1 className="disp" style={{ fontSize: 50 }}>
          Your Safe, <em>your signatures.</em>
        </h1>
        <p className="body" style={{ color: "var(--text)" }}>For any X Layer Safe, including ones with several owners: load one batch file in the Safe app, sign it like any other Safe transaction, done.</p>
      </div>

      <div className="ts-steps">
        {[
          ["01 · Build", "Your Safe and your limits", "Enter the Safe and the limits below and download fengce-install.json. It is built in this page for this Safe only."],
          ["02 · Load", "app.safe.global → Apps → Transaction Builder", "Open your X Layer Safe, start the Transaction Builder, and drop the file on it. Review the calls; they match the list below."],
          ["03 · Sign", "Create batch, then sign and execute", "Every owner the Safe needs signs. After it runs, My wallet shows the limits read back from the chain."],
        ].map(([k, t, d]) => (
          <div key={k}>
            <span className="lbl">{k}</span>
            <div className="ts-st">{t}</div>
            <div className="ts-sd">{d}</div>
          </div>
        ))}
      </div>

      <section className="ts-panel">
        <div className="ts-sim" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <span className="lbl">1 · Your Safe and limits</span>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="small">Safe address on X Layer</span>
            <input className="field mono" value={addr} onChange={(e) => setAddr(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
          </label>
          {err && <span className="err">{err}</span>}
          {state && (
            <div className="small" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span>
                Safe <Addr value={state.safe} label="Copy Safe address" /> · {state.threshold} of {state.owners} owners
              </span>
              {state.kind === "none" && <span className="allow">No guard yet: ready to install.</span>}
              {(state.kind === "fengce-v2" || state.kind === "fengce-v3") && (
                <span className="deny">
                  Fengce is already installed. Change limits on <a className="alink" href={href("limits")}>Limits</a> instead (changes are timelocked).
                </span>
              )}
              {state.kind === "other" && state.guard && <span className="deny">This Safe runs another guard ({short(state.guard)}). Its own checks run on this batch; installing replaces it.</span>}
            </div>
          )}
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="small">Max per buy (USDT0)</span>
              <input className="field num" style={{ width: 140 }} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))} aria-invalid={capN === null} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="small">Trades per clock hour (UTC)</span>
              <select className="field" style={{ width: 140 }} value={perHour} onChange={(e) => setPerHour(Number(e.target.value))}>
                <option value={0}>off</option>
                {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          {capN === null && <span className="err" style={{ fontSize: 13 }}>Enter an amount above 0, with at most 2 decimals.</span>}
          {calls && (
            <div className="ts-log">
              {calls.map((c, i) => (
                <div key={i} className="ts-lr" style={{ gridTemplateColumns: "28px minmax(0, 1fr) auto" }}>
                  <span className="num muted" style={{ fontSize: 12 }}>{i + 1}</span>
                  <span>{c.label}</span>
                  <span className="mono muted" style={{ fontSize: 12 }}>{short(c.to)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <aside className="ts-set">
          <span className="lbl" style={{ marginBottom: 18 }}>2 · The file</span>
          <span className="small">
            One Transaction Builder batch: {calls ? calls.length : "–"} calls, chain X Layer (196). Nothing in it moves funds: it configures the guard and turns it on. Changes to limits later wait 1 day; removing the guard waits 2 days with every owner.
          </span>
          <div className="ts-bottom" style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            <button type="button" className="pill accent big" disabled={!calls || !state || state.kind === "fengce-v2" || state.kind === "fengce-v3"} onClick={download}>
              Download fengce-install.json
            </button>
            <a className="alink" href="https://app.safe.global/" target="_blank" rel="noreferrer noopener" style={{ textAlign: "center" }}>Open app.safe.global</a>
            {state && <a className="alink" href={href("wallet", { safe: state.safe })} style={{ textAlign: "center" }}>After signing: My wallet</a>}
          </div>
        </aside>
      </section>
    </main>
  );
}

mount("install", 1, <Install />);
