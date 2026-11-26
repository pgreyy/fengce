import { useEffect, useState } from "react";
import { LimitsEditor } from "../okun/LimitsEditor";
import { SafePicker } from "../okun/SafePicker";
import { readInstalled, type Installed } from "../okun/reads";
import { mount } from "../okun/ui";
import { connect, useWallet } from "../okun/wallet";

function Start() {
  const w = useWallet();
  const [installed, setInstalled] = useState<Installed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const step = !w.account ? 1 : !w.safe ? 2 : 3;
  useEffect(() => {
    setInstalled(null);
    if (w.safe) readInstalled(w.safe).then(setInstalled, (e) => setErr((e as Error).message));
  }, [w.safe]);
  const titles = ["Connect your wallet", "Choose your Safe", "Set your limits"];
  const bar = (n: number) => ({ height: 2, background: n <= step ? "var(--accent)" : "var(--line)" });
  return (
    <main className="pg w" style={{ paddingTop: 80, paddingBottom: 110, display: "flex", flexDirection: "column", gap: 26 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
        <span className="lbl">Get started · {step} / 3</span>
        <h1 className="disp" style={{ fontSize: 46 }}>{titles[step - 1]}</h1>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, maxWidth: 560 }}>
        <span style={bar(1)} />
        <span style={bar(2)} />
        <span style={bar(3)} />
      </div>
      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 560, borderTop: "1px solid var(--line)" }}>
          {w.wallets.length === 0 && <p className="body" style={{ padding: "18px 0" }}>No browser wallet found. Install OKX Wallet or MetaMask, then reload.</p>}
          {w.wallets.map((x) => (
            <button key={x.uuid} type="button" onClick={() => connect(x).catch((e) => setErr((e as Error).message))} style={{ display: "flex", justifyContent: "space-between", padding: "18px 0", border: 0, borderBottom: "1px solid var(--line)", background: "none", fontSize: 18 }}>
              {x.name} <span className="lbl">Detected</span>
            </button>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "18px 0", borderBottom: "1px solid var(--line)", fontSize: 18, color: "var(--muted)" }}>
            WalletConnect <span className="lbl">Coming soon</span>
          </div>
        </div>
      )}
      {step === 2 && <SafePicker />}
      {step === 3 && (
        <>
          <div className="card" style={{ padding: 20, maxWidth: 560 }}>
            <div className="kv"><span className="muted">Wallet</span><span className="mono">{w.safe}</span></div>
            <div className="kv"><span className="muted">Type</span><span className="mono">{installed ? `Safe ${installed.version} · ${installed.threshold} of ${installed.owners.length}` : "…"}</span></div>
            <div className="kv">
              <span className="muted">Enforcement</span>
              <span className="mono" style={{ color: installed?.set ? "var(--allow)" : "var(--muted)" }}>{installed ? (installed.set ? "limits installed" : "ready to install") : "…"}</span>
            </div>
          </div>
          {installed && <LimitsEditor key={`${installed.safe}:${installed.set}`} installed={installed} onDone={setInstalled} />}
        </>
      )}
      {err && <p className="err">{err}</p>}
    </main>
  );
}

mount("start", 1, <Start />);
