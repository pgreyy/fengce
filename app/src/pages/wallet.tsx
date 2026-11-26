import { useEffect, useState } from "react";
import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import { FengceGuardArtifact } from "@fengce/sdk";
import { DEPLOYMENT, client } from "../lib/chain";
import { attempts, type Attempt } from "../okun/activity";
import { ENGINE } from "../okun/engine";
import { readInstalled, safeHistory, usdt0, type Installed } from "../okun/reads";
import { href, mount, short } from "../okun/ui";
import { EXPLORER_TX, sendFromWallet, simulateSafeTx, useWallet } from "../okun/wallet";

const regAbi = parseAbi(["function isPinned(bytes32) view returns (bool)"]);
const guardAbi = FengceGuardArtifact.abi as any;
const DEMO = getAddress(DEPLOYMENT.demoSafe) as Address;

interface Row {
  time: number;
  action: string;
  app: string;
  amount: string;
  ok: boolean | null;
  result: string;
  tx?: Hex;
}

const fmtTime = (t: number) => {
  const d = new Date(t * 1000);
  const days = (Date.now() - d.getTime()) / 86_400_000;
  return days < 1 ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
};

/** What a scheduled configure() would set, in words. */
function describe(data: Hex): string {
  try {
    const d = decodeFunctionData({ abi: guardAbi, data });
    if (d.functionName === "configure") {
      const b = (d.args![0] as any).bindings as { source: number; param: bigint }[];
      const cap = b.find((x) => Number(x.source) === 5);
      return cap ? `Set max per buy to ${usdt0(cap.param)} USDT0` : "Change the policy";
    }
    return `Call ${d.functionName}`;
  } catch {
    return "Change the limits";
  }
}

function Wallet() {
  const w = useWallet();
  const safe = w.safe ?? DEMO;
  const demo = !w.safe;
  const [inst, setInst] = useState<Installed | null>(null);
  const [pinned, setPinned] = useState<boolean | null>(null);
  const [hist, setHist] = useState<Awaited<ReturnType<typeof safeHistory>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const reload = () => {
    readInstalled(safe).then(
      (i) => {
        setInst(i);
        if (i.pinId) client.readContract({ address: ENGINE.pinRegistry, abi: regAbi, functionName: "isPinned", args: [i.pinId] }).then(setPinned, () => setPinned(null));
      },
      (e) => setErr((e as Error).message),
    );
    safeHistory(safe).then(setHist, () => setHist(null));
  };
  useEffect(reload, [safe]);
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const local: Attempt[] = attempts(safe);
  const rows: Row[] = [
    ...local.map((a) => ({ time: Math.floor(a.time / 1000), action: a.action, app: a.app, amount: a.amount, ok: a.ok, result: a.ok ? "Allowed" : `Blocked · ${a.reason}`, tx: a.tx })),
    ...(hist?.ev.agentEvents ?? []).filter((e) => e.event === "AgentExecuted").map((e) => ({ time: 0, block: e.block, action: "Agent pays", app: `Agent ${short(String(e.args.agent))}`, amount: "–", ok: true, result: "Allowed", tx: e.tx })),
    ...(hist?.ev.deniedAgentCalls ?? []).map((e) => ({ time: 0, block: e.block, action: "Agent pays", app: `Agent ${short(String(e.args.agent))}`, amount: "–", ok: false, result: "Blocked · over the limit", tx: e.tx })),
    ...(hist?.ev.events ?? []).filter((e) => e.event === "Configured").map((e) => ({ time: 0, block: e.block, action: "Limits installed", app: "Fengce", amount: "–", ok: null, result: "Bound", tx: e.tx })),
    ...(hist?.scheduled ?? []).map((s) => ({ time: s.readyAt - Number(inst?.adminDelay ?? 86_400n), action: describe(s.data), app: "Change request", amount: "–", ok: null, result: s.done ? "Done" : "Waiting 1 day", tx: s.tx })),
  ].sort((a, b) => b.time - a.time);

  const pending = (hist?.scheduled ?? []).filter((s) => !s.done);
  const bound = !!inst && inst.set && inst.guardOn && inst.moduleGuardOn;
  const since = hist?.ev.events.find((e) => e.event === "Configured");
  const blocked7d = local.filter((a) => !a.ok && a.time > Date.now() - 7 * 86_400_000).length + (hist?.ev.deniedAgentCalls.length ?? 0);

  async function safeTx(label: string, to: Address, data: Hex) {
    setMsg(null);
    setBusy(true);
    try {
      if (!w.account || !w.safe) throw new Error("Connect your wallet first.");
      const sim = await simulateSafeTx(w.account, w.safe, { to, data, operation: 0 });
      if (!sim.ok) throw new Error(sim.reason.text);
      const r = await sendFromWallet(w.safe, sim.data);
      setMsg(`${label}: ${r.status === "success" ? "done" : "reverted"} · tx ${short(r.hash)}`);
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const metric = (k: string, v: string, s: string, red = false) => (
    <div style={{ padding: "18px 18px 18px 0", borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="lbl">{k}</span>
      <div className="num" style={{ fontSize: 32, color: red ? "var(--deny)" : undefined }}>{v}</div>
      <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{s}</span>
    </div>
  );
  const status = (label: string, color: string) => (
    <span className="lbl" style={{ color: "var(--text)", display: "inline-flex", gap: 8, alignItems: "center" }}>
      <span className="dot" style={{ background: color }} />
      {label}
    </span>
  );

  return (
    <main className="pg w" style={{ paddingTop: 64, paddingBottom: 110, display: "flex", flexDirection: "column", gap: 32 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="lbl">
            Safe {short(safe)}
            {since ? ` · bound since block ${Number(since.block).toLocaleString("en-US")}` : ""}
            {demo ? " · demo Safe (connect to see yours)" : ""}
          </span>
          <h1 className="disp" style={{ fontSize: 48 }}>My wallet</h1>
        </div>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
          {status(bound ? "Bound" : "Not bound", bound ? "var(--allow)" : "var(--muted)")}
          {status(pinned ? "Rules pinned" : pinned === false ? "Pin broken" : "Rules pinned ·", pinned ? "var(--allow)" : pinned === false ? "var(--deny)" : "var(--muted)")}
          {status("Alarm on", "var(--accent)")}
          {status("No partner", "var(--muted)")}
        </div>
      </div>
      {err && <p className="err">{err}</p>}
      <div className="scroll-x">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(150px, 1fr))", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
          {metric("Max buy", inst ? usdt0(inst.maxPerBuy) : "…", inst?.okunPolicy === false && inst?.set ? "USDT0 per send (demo policy)" : "USDT0 per buy")}
          {metric("Quiet hours", "Soon", "next engine release")}
          {metric("Per hour", inst?.trades ? `${inst.trades.usedThisHour} / ${inst.trades.perHour}` : "Off", inst?.trades ? `swaps this hour · resets ${new Date(inst.trades.resetsAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "no hourly limit")}
          {metric("Tilt shield", "Soon", "next engine release")}
          {metric("Blocked · 7d", String(blocked7d), "agent refusals + this browser", blocked7d > 0)}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 400px)", gap: 40, alignItems: "start" }} className="wallet-cols">
        <section style={{ minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <span className="lbl">Activity</span>
            <a className="alink" href={href("try")}>Try a trade</a>
          </div>
          <div className="scroll-x">
            <table className="rt" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>App</th>
                  <th className="r">Amount</th>
                  <th className="r">Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">{hist ? "Nothing yet. Try a trade to see your limits work." : "Reading X Layer…"}</td>
                  </tr>
                )}
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="mono muted" style={{ fontSize: 13 }}>{r.time ? fmtTime(r.time) : "on chain"}</td>
                    <td>{r.action}</td>
                    <td className="muted">{r.app}</td>
                    <td className="r num">{r.amount}</td>
                    <td className="r mono" style={{ fontSize: 13.5, color: r.ok === null ? "var(--muted)" : r.ok ? "var(--allow)" : "var(--deny)" }}>
                      {r.tx ? (
                        <a href={EXPLORER_TX(r.tx)} target="_blank" rel="noreferrer noopener">{r.result}</a>
                      ) : (
                        r.result
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <aside className="panel" style={{ overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between" }}>
            <span className="lbl">Safeguards</span>
            <span className="lbl">{short(safe)}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 14, padding: "18px 20px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span className="lbl">Changes</span>
              {pending.length === 0 ? (
                <>
                  <span style={{ fontSize: 16 }}>Nothing waiting</span>
                  <span className="small">A change to your limits waits 1 day and posts an on-chain alert. Removing the guard waits 2 days and needs every owner.</span>
                </>
              ) : (
                pending.map((p) => {
                  const left = Math.max(0, p.readyAt - now);
                  const hms = `${String(Math.floor(left / 3600)).padStart(2, "0")}:${String(Math.floor((left % 3600) / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
                  return (
                    <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 16 }}>{describe(p.data)}</span>
                      <span className="mono" style={{ fontSize: 13, color: "var(--accent)" }}>{left > 0 ? `${hms} left` : "ready to apply"}</span>
                      {!demo && (
                        <span style={{ display: "flex", gap: 14 }}>
                          {left === 0 && (
                            <button type="button" className="alink accent" disabled={busy} onClick={() => safeTx("Apply", ENGINE.guard, p.data)}>Apply</button>
                          )}
                          <button type="button" className="alink" disabled={busy} onClick={() => safeTx("Cancel", ENGINE.guard, encodeFunctionData({ abi: guardAbi, functionName: "cancelAdmin", args: [ENGINE.guard, p.data] }))}>Cancel</button>
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {pending.length === 0 && <a className="alink" href={href("limits")}>Request</a>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 14, padding: "18px 20px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span className="lbl">Partner</span>
              <span style={{ fontSize: 16 }}>Optional · coming soon</span>
              <span className="small">
                Someone you trust to co-approve loosening and clear a tripped tilt shield early. It never moves funds. On a Safe with 2 or more owners,
                the Safe's own approvals already apply.
              </span>
            </div>
          </div>
          <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 5 }}>
            <span className="lbl">Alarm</span>
            <span style={{ fontSize: 16 }}>On</span>
            <span className="small">Every scheduled change is posted on chain as an event and shown here, with its countdown.</span>
          </div>
          {msg && <div className="small" style={{ padding: "0 20px 18px" }}>{msg}</div>}
        </aside>
      </div>
      <style>{`@media (max-width: 900px) { .wallet-cols { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
    </main>
  );
}

mount("wallet", 1, <Wallet />);
