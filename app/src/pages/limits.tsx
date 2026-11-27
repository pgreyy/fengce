import { useEffect, useState } from "react";
import { BuildPanel } from "../okun/BuildPanel";
import { CatalogPanel } from "../okun/CatalogPanel";
import { LimitsEditor } from "../okun/LimitsEditor";
import { readInstalled, type Installed } from "../okun/reads";
import { href, mount, param, short, StartLink } from "../okun/ui";
import { useWallet } from "../okun/wallet";

type Tab = "tpl" | "add" | "build";

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
        {!w.safe && <StartLink className="pill accent">Get started</StartLink>}
      </div>
      <div className="seg" role="tablist" aria-label="Rule source" style={{ alignSelf: "flex-start" }}>
        {([["tpl", "Templates"], ["add", "Add a circuit"], ["build", "Build your own"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "tpl" && (loading ? <p className="body">Reading your Safe from X Layer…</p> : <LimitsEditor key={`${installed?.safe}:${installed?.set}`} installed={installed} onDone={setInstalled} />)}
      {tab === "add" && <CatalogPanel />}
      {tab === "build" && <BuildPanel />}
    </main>
  );
}

mount("limits", 1, <Limits />);
