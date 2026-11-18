"use client";
import { useState } from "react";

const TOKENS = ["0x779Ded0c9e1022225f8E0630b35a9b54bE713736", "0xe538905cf8410324e03A5A23C1c177a474D59b2b", "0xB6CEceAB302E2E4948951eE7843FC24E92933061"];
const SPENDERS = ["0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA", "0x182a927119d56008d921126764bf884221b10f59", "0xE3F3Caefdd7180F884c01E57f65Df979Af84f116"];

export default function Install() {
  const [form, setForm] = useState({
    safe: "",
    guard: "",
    pinId: "",
    preset: "nand-limit",
    cap: "100",
    tokens: TOKENS.join("\n"),
    spenders: SPENDERS.join("\n"),
    recoveryDelay: "172800",
    recoveryWindow: "172800",
    adminDelay: "86400",
  });
  const [keep, setKeep] = useState<string[]>([]);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setForm({ ...form, [k]: e.target.value });

  async function run(nextKeep = keep) {
    setBusy(true);
    const body = {
      ...form,
      guard: form.guard || undefined,
      tokens: form.tokens.split(/\s+/).filter(Boolean),
      spenders: form.spenders.split(/\s+/).filter(Boolean),
      keep: nextKeep,
    };
    const r = await fetch("/api/install", { method: "POST", body: JSON.stringify(body) });
    setRes(await r.json());
    setBusy(false);
  }

  function toggleKeep(key: string) {
    const next = keep.includes(key) ? keep.filter((k) => k !== key) : [...keep, key];
    setKeep(next);
    run(next);
  }

  return (
    <>
      <h1>Install</h1>
      <p className="muted">
        Enter the Safe, then run the preflight. Each token and spender pair is shown as checked (nothing found), found (an approval exists), not
        checked (the read failed), or kept (found, and you chose to keep it). With nothing left as found, this page produces a Safe Transaction
        Builder file: configure, setGuard, setModuleGuard, in that order. Safes with modules enabled are refused.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); run(); }}>
        <label>Safe</label><input className="mono" value={form.safe} onChange={set("safe")} required />
        <label>FengceGuard</label><input className="mono" value={form.guard} onChange={set("guard")} placeholder="empty: predicted CREATE2 address (not deployed)" />
        <label>Pin id</label><input className="mono" value={form.pinId} onChange={set("pinId")} required />
        <label>Policy</label>
        <select value={form.preset} onChange={set("preset")}>
          <option value="nand-limit">Stablecoin Transfer Limit</option>
          <option value="nor-swap">Protected Swap Policy</option>
        </select>
        <label>Cap</label><input value={form.cap} onChange={set("cap")} />
        <label>Tokens</label><textarea rows={3} value={form.tokens} onChange={set("tokens")} />
        <label>Spenders (Permit2 added)</label><textarea rows={3} value={form.spenders} onChange={set("spenders")} />
        <label>Recovery delay (s, min 172800)</label><input value={form.recoveryDelay} onChange={set("recoveryDelay")} />
        <label>Recovery window (s, min 86400)</label><input value={form.recoveryWindow} onChange={set("recoveryWindow")} />
        <label>Admin delay (s, min 86400)</label><input value={form.adminDelay} onChange={set("adminDelay")} />
        <span /><button disabled={busy}>{busy ? "Checking" : "Run preflight"}</button>
      </form>
      {res && (
        <>
          {res.error && <p className="deny">{res.error}</p>}
          {res.guardNote && <p className="muted">{res.guardNote}</p>}
          {res.preflight && (
            <>
              <h2>Preflight</h2>
              <table>
                <thead><tr><th>Token</th><th>Spender</th><th>Check</th><th>State</th><th>Amount</th><th></th></tr></thead>
                <tbody>
                  {res.preflight.map((r: any, i: number) => {
                    const key = `${r.token}:${r.spender}`.toLowerCase();
                    return (
                      <tr key={i}>
                        <td className="mono">{r.token}</td><td className="mono">{r.spender}</td><td>{r.check}</td>
                        <td className={r.state === "found" ? "deny" : r.state === "checked" ? "allow" : ""}>{r.state}</td>
                        <td>{r.amount ?? "-"}</td>
                        <td>{(r.state === "found" || r.state === "kept") && <button onClick={() => toggleKeep(key)}>{r.state === "kept" ? "undo keep" : "keep"}</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
          {res.transactionBuilder && (
            <>
              <h2>Safe Transaction Builder JSON</h2>
              <pre>{JSON.stringify(res.transactionBuilder, null, 2)}</pre>
            </>
          )}
        </>
      )}
    </>
  );
}
