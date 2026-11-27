import { useState } from "react";
import { CIRCUIT, circuitHref, mount } from "../okun/ui";

/** The simulator follows FengceGuardV3 (src/safe/FengceRulesV3.sol): the buy that makes N buys within 30 minutes, or a
 * buy of 3x the usual size, goes through and trips the shield; later buys are refused (TILT_SHIELD) until the cooldown
 * ends. Sells and sends are never paused. Time is simulated minutes. */
type Row = { t: number; text: string; tag: string; tone: "g" | "r" };

function Tilt() {
  const [n, setN] = useState(4);
  const [cd, setCd] = useState(12);
  const [clear, setClear] = useState<"partner" | "cooldown">("partner");
  const [now, setNow] = useState(0);
  const [buys, setBuys] = useState<{ t: number; s: number }[]>([]);
  const [tripped, setTripped] = useState(false);
  const [log, setLog] = useState<Row[]>([]);
  const [msg, setMsg] = useState("Add a few buys and watch the shield.");

  const win = buys.filter((b) => now - b.t < 30);
  const biggest = win.reduce((a, b) => Math.max(a, b.s), 0);
  const add = (rows: Row[]) => setLog((l) => [...rows, ...l].slice(0, 4));

  function buy(s: number) {
    if (tripped) {
      add([{ t: now, text: `Buy ${s}× usual`, tag: "TILT_SHIELD", tone: "r" }]);
      setMsg("Refused: TILT_SHIELD. Sells and sends to you still work.");
      return;
    }
    const next = [...buys, { t: now, s }];
    setBuys(next);
    const w = next.filter((b) => now - b.t < 30);
    const big = w.reduce((a, b) => Math.max(a, b.s), 0);
    if (w.length >= n || big >= 3) {
      setTripped(true);
      add([
        { t: now, text: "Shield trips · safe mode on", tag: "SAFE MODE", tone: "r" },
        { t: now, text: `Buy ${s}× usual`, tag: "TRIPS SHIELD", tone: "r" },
      ]);
      setMsg(big >= 3 ? "One buy at 3× your usual. Buying is paused." : `${n} buys inside 30 minutes. Buying is paused.`);
    } else {
      add([{ t: now, text: `Buy ${s}× usual`, tag: "ALLOWED", tone: "g" }]);
      setMsg("Buy allowed.");
    }
  }
  const wait = () => {
    setNow((x) => x + 10);
    if (!tripped) setMsg("Ten minutes pass. Old buys slide out of the window.");
  };
  const reset = () => {
    setBuys([]);
    setNow(0);
    setTripped(false);
    setLog([]);
    setMsg("Add a few buys and watch the shield.");
  };
  const pickN = (v: number) => {
    setN(v);
    if (!tripped && win.length >= v && win.length > 0) {
      setTripped(true);
      add([{ t: now, text: "Shield trips · safe mode on", tag: "SAFE MODE", tone: "r" }]);
      setMsg(`${v} buys inside 30 minutes. Buying is paused.`);
    }
  };

  const seg = <T extends string | number>(value: T, set: (v: T) => void, opts: [T, string][]) => (
    <div className="ts-seg" role="radiogroup">
      {opts.map(([v, l]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} onClick={() => set(v)}>
          {l}
        </button>
      ))}
    </div>
  );

  return (
    <main className="pg w" style={{ paddingBottom: 88 }}>
      <div className="ts-top">
        <div>
          <span className="lbl">Tilt-shield · Guard v3</span>
          <h1 className="ts-h1">
            A circuit breaker
            <br />
            for bad nights.
          </h1>
        </div>
        <p className="ts-lead">When you start buying too fast or too big, your Safe stops buying for a while. Selling and sending to yourself still work. It runs on your Safe, so no app can skip it.</p>
      </div>

      <div className="ts-steps">
        {[
          ["01 · Watches", "How fast and how big you buy", "Only your Safe's own transactions. No price feeds, no servers."],
          ["02 · Trips", `${n} buys in 30 min, or one buy 3× your usual`, "circuits"],
          ["03 · Safe mode", "Only sells and sends to you", clear === "partner" ? "Until the cooldown ends, or your partner clears it early." : "Until the cooldown ends."],
        ].map(([k, t, d]) => (
          <div key={k}>
            <span className="lbl">{k}</span>
            <div className="ts-st">{t}</div>
            <div className="ts-sd">
              {d === "circuits" ? (
                <>
                  <a className="code-link mono" href={circuitHref(CIRCUIT.counter)}>Counter circuit #7</a> counts buys in the window; the{" "}
                  <a className="code-link mono" href={circuitHref(CIRCUIT.tiltLatch)}>Tilt-shield latch</a> circuit flips. Its state lives on chain.
                </>
              ) : (
                d
              )}
            </div>
          </div>
        ))}
      </div>

      <section className="ts-panel">
        <div className="ts-sim">
          <div className="ts-row">
            <span className="lbl">Try it · last 30 minutes</span>
            <span className={`ts-state ${tripped ? "trip" : "open"}`}>
              <span className="ts-dot" />
              {tripped ? "SAFE MODE" : "OPEN"}
            </span>
          </div>
          <div className="ts-big">
            <div>
              <div className="ts-n">
                {win.length}
                <small> / {n}</small>
              </div>
              <div className="lbl">Buys in window</div>
            </div>
            <div>
              <div className="ts-n">
                {biggest}×<small> usual</small>
              </div>
              <div className="lbl">Biggest buy</div>
            </div>
            <div>
              <div className="ts-n">
                {tripped ? (
                  <>
                    {cd}
                    <small>h</small>
                  </>
                ) : (
                  "–"
                )}
              </div>
              <div className="lbl">Cooldown left</div>
            </div>
          </div>
          <div className="ts-lane" role="img" aria-label={`${win.length} buys in the last 30 minutes; usual size and 3 times usual marked`}>
            {[0, 5, 10, 15, 20, 25, 30].map((m) => {
              const x = (m / 30) * 100;
              return (
                <span key={m}>
                  <span className="ts-tick" style={{ left: `${x}%` }} />
                  <span className="ts-tl" style={{ left: `${Math.min(97, Math.max(3, x))}%` }}>{m === 30 ? "now" : `-${30 - m}m`}</span>
                </span>
              );
            })}
            <div className="ts-u" style={{ bottom: 54 }}>
              <span>usual</span>
            </div>
            <div className="ts-u x3" style={{ bottom: 114 }}>
              <span>3×</span>
            </div>
            {win.map((b, i) => {
              const same = win.filter((c, j) => j < i && c.t === b.t).length;
              const x = Math.min(96, Math.max(4, Math.min(95, ((30 - (now - b.t)) / 30) * 100) - same * 2.4));
              return <div key={i} className={`ts-buy${b.s >= 3 ? " big3" : ""}`} style={{ left: `${x}%`, height: b.s * 30 }} />;
            })}
          </div>
          <div className="ts-acts">
            <button type="button" className="ts-b" onClick={() => buy(1)}>Buy normal size</button>
            <button type="button" className="ts-b" onClick={wait}>Wait 10 min</button>
            <button type="button" className="ts-b" onClick={() => buy(3)}>Buy 3× usual</button>
            <button type="button" className="ts-b ghost" onClick={reset}>Reset</button>
          </div>
          <div className="ts-log" aria-live="polite">
            {log.length === 0 && (
              <div className="ts-lr">
                <span className="num muted">–</span>
                <span className="muted">No buys yet</span>
                <span />
              </div>
            )}
            {log.map((r, i) => (
              <div key={i} className="ts-lr">
                <span className="num muted" style={{ fontSize: 12 }}>t+{r.t}m</span>
                <span>{r.text}</span>
                <span className={`tag ${r.tone}`}>{r.tag}</span>
              </div>
            ))}
          </div>
          <div className="ts-msg">
            <span>{msg}</span>
            <span className="mono muted" style={{ fontSize: 11 }}>Runs in your browser · nothing is sent</span>
          </div>
        </div>
        <aside className="ts-set">
          <span className="lbl" style={{ marginBottom: 18 }}>Your settings</span>
          <div className="ts-f">
            <div className="ts-t">Trip after</div>
            {seg(n, pickN, [[3, "3 buys"], [4, "4 buys"], [5, "5 buys"]])}
          </div>
          <div className="ts-f">
            <div className="ts-t">Cooldown</div>
            {seg(cd, setCd, [[6, "6h"], [12, "12h"], [24, "24h"]])}
          </div>
          <div className="ts-f">
            <div className="ts-t">Who can clear it early</div>
            {seg(clear, setClear, [["partner", "Partner or cooldown"], ["cooldown", "Cooldown only"]])}
          </div>
          <div className="ts-note">Turning it on is instant. Turning it off or loosening it waits 1 day, or 7 days with a partner unless they approve sooner.</div>
          <button type="button" className="pill accent big ts-cta" disabled title="Tilt-shield runs in FengceGuard v3, which is not deployed yet">
            Turn on Tilt-shield
          </button>
          <div className="ts-soon">Live with Guard v3</div>
        </aside>
      </section>
    </main>
  );
}

mount("tilt-shield", 1, <Tilt />);
