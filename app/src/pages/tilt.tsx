import { useState } from "react";
import { mount } from "../okun/ui";

type Ev = "buy" | "wait" | "big";

function Tilt() {
  const [after, setAfter] = useState(4);
  const [cool, setCool] = useState(12);
  const [clear, setClear] = useState<"partner" | "cooldown">("partner");
  const [log, setLog] = useState<Ev[]>([]);
  const [tripped, setTripped] = useState(false);

  const lastWait = log.lastIndexOf("wait");
  const buys = log.slice(lastWait + 1).filter((x) => x === "buy" || x === "big").length;
  const add = (e: Ev) => {
    const next = [...log, e];
    if (!tripped) {
      const lw = next.lastIndexOf("wait");
      const n = next.slice(lw + 1).filter((x) => x === "buy" || x === "big").length;
      setTripped(e === "big" || (e === "buy" && n >= after));
    }
    setLog(next);
  };
  const explain = tripped
    ? `Tripped. Your wallet now refuses buys and any transfer to another address, on every supported app, until the ${cool}-hour cooldown ends${clear === "partner" ? " or your partner clears it" : ""}.`
    : buys
      ? `${buys} of ${after} buys in this 30-minute window. Keep going and the latch flips.`
      : "Add some buys to see when the latch flips.";
  const opt = (on: boolean) => ({ className: "chip", "aria-pressed": on });

  return (
    <main className="pg w" style={{ paddingTop: 64, paddingBottom: 110, display: "flex", flexDirection: "column", gap: 40 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
        <span className="lbl">Tilt shield</span>
        <h1 className="disp" style={{ fontSize: 52 }}>Stops the revenge trade</h1>
        <p className="body" style={{ color: "var(--text)" }}>"Tilt" is when a bad run pushes you into faster, bigger buys to win it back.</p>
        <p className="body">The shield watches how fast and how big you buy. When it trips, your wallet only sells or pays you back until the cooldown ends.</p>
      </div>
      <div className="cols-m" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", borderTop: "1px solid var(--line)" }}>
        {[
          ["01 · Watches", "How fast and how big you buy", "Only your wallet's own transactions. No price feeds, no servers."],
          ["02 · Trips", `After ${after} buys in 30 minutes, or a buy 3× your usual`, "A TapeOut latch circuit flips. Its state lives on chain."],
          ["03 · Safe mode", "Only sells and withdrawals to you", `Until a ${cool}-hour cooldown ends${clear === "partner" ? " or your partner clears it" : ""}.`],
        ].map(([k, t, d], i) => (
          <div key={k} style={{ padding: "22px 24px 22px 0", paddingLeft: i ? 24 : 0, borderLeft: i ? "1px solid var(--line)" : undefined, display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="lbl">{k}</span>
            <span style={{ fontSize: 18 }}>{t}</span>
            <span className="small">{d}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 380px)", gap: 40, alignItems: "start" }} className="tilt-cols">
        <section className="panel" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span className="lbl">Try it</span>
            <span className="mono" style={{ fontSize: 13, color: tripped ? "var(--deny)" : "var(--allow)" }}>{tripped ? "● TRIPPED · SAFE MODE" : "● OPEN"}</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minHeight: 34 }}>
            {log.slice(-8).map((x, i) => (
              <span key={i} className="mono" style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid var(--line)", fontSize: 12, color: x === "buy" ? "var(--text)" : x === "wait" ? "var(--muted)" : "var(--deny)" }}>
                {x === "buy" ? "buy" : x === "wait" ? "30 min later" : "3× buy"}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="pill line" onClick={() => add("buy")}>Buy (normal size)</button>
            <button type="button" className="pill line" onClick={() => add("wait")}>Wait 30 minutes</button>
            <button type="button" className="pill line" onClick={() => add("big")}>Buy 3× my usual</button>
            <button type="button" className="alink" onClick={() => (setLog([]), setTripped(false))}>Reset</button>
          </div>
          <span className="small">{explain}</span>
          <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>This demo runs in your browser. Nothing is sent.</span>
        </section>
        <aside style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <span className="lbl">Your settings</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 15 }}>Trip after</span>
            <div style={{ display: "flex", gap: 6 }}>
              {[3, 4, 5].map((n) => <button key={n} type="button" {...opt(after === n)} onClick={() => setAfter(n)}>{n} buys</button>)}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 15 }}>Cooldown</span>
            <div style={{ display: "flex", gap: 6 }}>
              {[6, 12, 24].map((n) => <button key={n} type="button" {...opt(cool === n)} onClick={() => setCool(n)}>{n}h</button>)}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 15 }}>Who can clear it early</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" {...opt(clear === "partner")} onClick={() => setClear("partner")}>Partner or cooldown</button>
              <button type="button" {...opt(clear === "cooldown")} onClick={() => setClear("cooldown")}>Cooldown only</button>
            </div>
          </div>
          <span className="small">Watch-only for the first 14 days: you see what it would have stopped before it can block. Turning it off waits 1 day.</span>
          <button type="button" className="pill accent big" disabled title="The tilt shield ships with the next Fengce guard">Turn on tilt shield</button>
          <span className="small">Coming with the next engine release, with partners and per-agent caps.</span>
        </aside>
      </div>
      <style>{`@media (max-width: 900px) { .tilt-cols { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
    </main>
  );
}

mount("tilt", 1, <Tilt />);
