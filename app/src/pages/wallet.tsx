import { compareRules, currentRule, replaceSentence, ruleFromConfigure } from "../fengce/ruleSummary";
import { V3 } from "../fengce/v3";
import { useEffect, useState } from "react";
import { decodeFunctionData, encodeFunctionData, getAddress, isAddress, parseAbi, type Address, type Hex } from "viem";
import { FengceGuardArtifact } from "@fengce/sdk";
import { AGENT_EXECUTOR, DEPLOYMENT, client } from "../lib/chain";
import { ActivityTable, useActivity } from "../fengce/ActivityTable";
import { attempts, type Attempt } from "../fengce/activity";
import { ENGINE } from "../fengce/engine";
import { readInstalled, safeHistory, usdt0, type Installed } from "../fengce/reads";
import { CopyButton, href, mount, param, short } from "../fengce/ui";
import { EXPLORER_TX, sendFromWallet, simulateSafeTx, useWallet } from "../fengce/wallet";

const regAbi = parseAbi(["function isPinned(bytes32) view returns (bool)"]);
const guardAbi = FengceGuardArtifact.abi as any;
/** The Milestone 2 demo Safe (guard v3) when it exists, else the release v2 demo Safe. */
const DEMO = (V3?.demoSafe ?? getAddress(DEPLOYMENT.demoSafe)) as Address;

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

/** Plain words for a scheduled change: for a new policy, what the Safe will refuse and what gets through that is
 * refused today (fengce/ruleSummary.ts runs both rules on the same example transactions). */
function PendingSummary({ data, safe, guard }: { data: Hex; safe: Address; guard: Address }) {
  const [text, setText] = useState<{ main: string; looser: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const next = await ruleFromConfigure(data);
      if (!next) return { main: describe(data), looser: null };
      const c = await compareRules(next, await currentRule(safe, guard), [AGENT_EXECUTOR]);
      return { main: replaceSentence(c).replace("This replaces your current rule", "Replaces your current rule").replace("After the change", "Once applied"), looser: c.looser };
    })().then((t) => live && setText(t), () => live && setText({ main: describe(data), looser: null }));
    return () => void (live = false);
  }, [data, safe, guard]);
  if (!text) return <span className="small">Reading what this change does…</span>;
  return (
    <>
      <span style={{ fontSize: 15 }}>{text.main}</span>
      {text.looser && <span className="small" style={{ color: "var(--deny)" }}>Looser than now: {text.looser}.</span>}
    </>
  );
}

function Wallet() {
  const w = useWallet();
  // ?safe=0x... opens any Safe read-only (for judges and shared links); otherwise the connected Safe, else the demo Safe
  const viewing = (() => {
    const q = param("safe");
    return q && isAddress(q) ? (getAddress(q) as Address) : null;
  })();
  const safe = viewing ?? w.safe ?? DEMO;
  const demo = !viewing && !w.safe;
  const [inst, setInst] = useState<Installed | null>(null);
  const [pinned, setPinned] = useState<boolean | null>(null);
  const [hist, setHist] = useState<Awaited<ReturnType<typeof safeHistory>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [bump, setBump] = useState(0);
  const reload = () => {
    setBump((x) => x + 1);
    readInstalled(safe).then(
      (i) => {
        setInst(i);
        if (i.pinId) client.readContract({ address: ENGINE.pinRegistry, abi: regAbi, functionName: "isPinned", args: [i.pinId] }).then(setPinned, () => setPinned(null));
      },
      (e) => setErr((e as Error).message),
    );
  };
  useEffect(reload, [safe]);
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const act = useActivity(safe, 100, bump);
  // the event history (scheduled changes) scans logs; start it once Activity has its rows, so they share no rate limit
  const actReady = act.rows !== null;
  useEffect(() => {
    if (!actReady) return;
    safeHistory(safe).then(setHist, () => setHist(null));
  }, [safe, actReady, bump]);
  const local: Attempt[] = attempts(safe);
  const pending = (hist?.scheduled ?? []).filter((s) => !s.done);
  const isOwner = !!w.account && !!inst?.owners.some((o) => o.toLowerCase() === w.account!.toLowerCase());
  const bound = !!inst && inst.set && inst.guardOn && inst.moduleGuardOn;
  const since = hist?.ev.events.find((e) => e.event === "Configured");
  const weekAgo = Date.now() / 1000 - 7 * 86_400;
  const blocked7d = act.rows ? act.rows.filter((r) => r.ok === false && (r.time ?? 0) > weekAgo).length : local.filter((a) => !a.ok && a.time > weekAgo * 1000).length;

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

  const metric = (k: string, v: string, s: string, red = false, i = 1, n = 5) => (
    <div style={{ padding: `20px ${i === n - 1 ? 0 : 24}px 20px ${i === 0 ? 0 : 24}px`, borderRight: i < n - 1 ? "1px solid var(--line)" : undefined, display: "flex", flexDirection: "column", gap: 6 }}>
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
          <span className="lbl" style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>Safe {short(safe)}</span> <CopyButton text={safe} label="Copy Safe address" />
            {(since || demo) && <span>{[since ? `bound since block ${Number(since.block).toLocaleString("en-US")}` : "", demo ? "demo Safe (connect to see yours)" : ""].filter(Boolean).join(" · ")}</span>}
          </span>
          <h1 className="disp" style={{ fontSize: 48 }}>My wallet</h1>
        </div>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
          {status(bound ? "Bound" : "Not bound", bound ? "var(--allow)" : "var(--muted)")}
          {status(pinned ? "Rules pinned" : pinned === false ? "Pin broken" : "Rules pinned ·", pinned ? "var(--allow)" : pinned === false ? "var(--deny)" : "var(--muted)")}
          {status("Alarm on", "var(--accent)")}
          {inst?.v3 && !/^0x0{40}$/i.test(inst.v3.rules.partner) ? status(`Partner ${short(inst.v3.rules.partner)}`, "var(--allow)") : status("No partner", "var(--muted)")}
          {inst?.engine && status(inst.engine === "v3" ? "Guard v3" : "Guard v2", "var(--muted)")}
          <a className="pill accent" href={href("try")}>Try a trade</a>
        </div>
      </div>
      {err && <p className="err">{err}</p>}
      <div className="scroll-x">
        <div className="metrics" style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(170px, 1fr))", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
          {metric("Max buy", inst ? usdt0(inst.maxPerBuy) : "…", inst?.limitsPolicy === false && inst?.set ? "USDT0 per send (demo policy)" : "USDT0 per buy", false, 0)}
          {inst?.engine === "v3" && inst.v3
            ? metric("Quiet hours", inst.v3.rules.quietOn ? `${String(inst.v3.rules.quietStart).padStart(2, "0")}–${String(inst.v3.rules.quietEnd).padStart(2, "0")}` : "Off", inst.v3.rules.quietOn ? "UTC · no buys" : inst.v3.rules.holdSeconds ? `hold lock ${inst.v3.rules.holdSeconds / 3600} h` : "guard v3", false, 1)
            : metric("Quiet hours", inst?.engine === "v2" ? "v3 only" : "…", "needs guard v3", false, 1)}
          {metric("Per hour", inst?.trades ? `${inst.trades.usedThisHour} / ${inst.trades.perHour}` : "Off", inst?.trades ? `swaps this hour · resets ${new Date(inst.trades.resetsAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "no hourly limit", false, 2)}
          {inst?.engine === "v3" && inst.v3
            ? metric(
                "Tilt-shield",
                !inst.v3.rules.tiltOn ? "Off" : inst.v3.tilt?.paused ? "Tripped" : `${inst.v3.tilt?.count ?? 0} / ${inst.v3.tilt?.tripAt ?? 4}`,
                !inst.v3.rules.tiltOn ? "guard v3" : inst.v3.tilt?.paused ? (inst.v3.tilt.resumesAt ? `buys paused until ${new Date(inst.v3.tilt.resumesAt * 1000).toUTCString().slice(17, 22)} UTC` : "buys paused") : "buys this half hour",
                !!inst.v3.tilt?.paused,
                3,
              )
            : metric("Tilt-shield", inst?.engine === "v2" ? "v3 only" : "…", "needs guard v3", false, 3)}
          {metric("Blocked · 7d", String(blocked7d), "refused in Activity", blocked7d > 0, 4)}
        </div>
      </div>
      <section id="activity" style={{ minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
          <span className="lbl">Activity</span>
          <span className="mono muted" style={{ fontSize: 12 }}>read from X Layer · newest first</span>
        </div>
        <ActivityTable rows={act.rows} err={act.err} pageSize={25} empty="Nothing yet. Try a trade to see your limits work." />
      </section>
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span className="lbl">Safeguards</span>
          <span className="lbl" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{short(safe)} <CopyButton text={safe} label="Copy Safe address" /></span>
        </div>
        <div className="guards" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
          <div className="guard" style={{ padding: "20px 24px 20px 0", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <span className="lbl">Changes</span>
              {pending.length === 0 && <a className="alink" href={href("limits")}>Request</a>}
            </div>
              {pending.length === 0 ? (
            <>
            <span style={{ fontSize: 16 }}>Nothing waiting</span>
              <span className="small">Raising a limit waits 1 day, in public. Removing the guard waits 2 days.</span>
            </>
              ) : (
            pending.map((p) => {
              const left = Math.max(0, p.readyAt - now);
              const hms = `${String(Math.floor(left / 3600)).padStart(2, "0")}:${String(Math.floor((left % 3600) / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
              return (
                <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <PendingSummary data={p.data} safe={safe} guard={inst?.guard ?? ENGINE.guard} />
                  <span className="mono" style={{ fontSize: 13, color: "var(--accent)" }}>{left > 0 ? `${hms} left` : "ready to apply"}</span>
                  {!demo && (
                    <span style={{ display: "flex", gap: 14 }}>
                      {left === 0 && (
                        <button type="button" className="alink accent" disabled={busy} onClick={() => safeTx("Apply", inst?.guard ?? ENGINE.guard, p.data)}>Apply</button>
                      )}
                      {isOwner && (
                        <button type="button" className="alink" disabled={busy} title="Takes effect at once: cancelling keeps the stricter rule you have now." onClick={() => safeTx("Cancel this change", inst?.guard ?? ENGINE.guard, encodeFunctionData({ abi: guardAbi, functionName: "cancelAdmin", args: [inst?.guard ?? ENGINE.guard, p.data] }))}>Cancel this change</button>
                      )}
                    </span>
                  )}
                </div>
              );
            })
              )}
          </div>
          <div className="guard" style={{ padding: "20px 24px", borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <span className="lbl">Partner</span>
              <a className="alink" href={href("tilt-shield")}>Learn more</a>
            </div>
            <span style={{ fontSize: 16 }}>Optional · coming soon</span>
            <span className="small">Co-approves loosening and can clear a tripped Tilt-shield. Never moves funds.</span>
          </div>
          <div className="guard" style={{ padding: "20px 0 20px 24px", borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <span className="lbl">Alarm</span>
              <a className="alink" href="#activity">See activity</a>
            </div>
            <span style={{ fontSize: 16 }}>On</span>
            <span className="small">Every scheduled change is posted on chain and shown here, with its countdown.</span>
          </div>
        </div>
        {msg && <div className="small" style={{ paddingTop: 12 }}>{msg}</div>}
      </section>
      <style>{`@media (max-width: 900px) { .guards { grid-template-columns: minmax(0, 1fr) !important; } .guards > .guard { padding: 18px 0 !important; border-left: 0 !important; } .guards > .guard + .guard { border-top: 1px solid var(--line); } }`}</style>
    </main>
  );
}

mount("wallet", 1, <Wallet />);
