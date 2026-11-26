import { useEffect, useState, type ReactNode } from "react";
import { LimitsEditor } from "../okun/LimitsEditor";
import { readInstalled, type Installed } from "../okun/reads";
import { href, mount, param, short } from "../okun/ui";
import { useWallet } from "../okun/wallet";

type Tab = "tpl" | "add" | "build";

function Soon({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="panel" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <span className="lbl">{title} · coming soon</span>
      <p className="body">{children}</p>
    </div>
  );
}

function Limits() {
  const w = useWallet();
  const [tab, setTab] = useState<Tab>(param("tab") === "add" ? "add" : param("tab") === "build" ? "build" : "tpl");
  const [installed, setInstalled] = useState<Installed | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setInstalled(null);
    if (!w.safe) return;
    setLoading(true);
    readInstalled(w.safe).then(setInstalled, () => setInstalled(null)).finally(() => setLoading(false));
  }, [w.safe]);
  return (
    <main className="pg w" style={{ paddingTop: 72, paddingBottom: 110, display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="lbl">{w.safe ? `Safe ${short(w.safe)}` : "No Safe chosen"}</span>
          <h1 className="disp" style={{ fontSize: 48 }}>Your limits</h1>
        </div>
        {!w.safe && <a className="pill accent" href={href("start")}>Get started</a>}
      </div>
      <div className="seg" role="tablist" aria-label="Rule source" style={{ alignSelf: "flex-start" }}>
        {([["tpl", "Templates"], ["add", "Add a circuit"], ["build", "Build your own"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "tpl" && (loading ? <p className="body">Reading your Safe from X Layer…</p> : <LimitsEditor key={`${installed?.safe}:${installed?.set}`} installed={installed} onDone={setInstalled} />)}
      {tab === "add" && (
        <Soon title="Add a circuit">
          Pick a circuit from the Fengce Catalog, or import one by its ID, connect its inputs to your wallet's facts, test it, and add it to
          your limits. The designer earns 80% of each install.
        </Soon>
      )}
      {tab === "build" && (
        <Soon title="Build your own">
          Combine one or two conditions (buy size, hour of day, trades in the last hour) into a rule. It is compiled into a new TapeOut
          circuit, checked on every input, and taped out from your wallet for a one-time fee.
        </Soon>
      )}
    </main>
  );
}

mount("limits", 1, <Limits />);
