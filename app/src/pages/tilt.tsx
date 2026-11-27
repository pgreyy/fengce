import { useEffect, useState } from "react";
import m2 from "../../../deployments/m2-demo-xlayer-196.json";
import { readInstalled, type Installed } from "../fengce/reads";
import { CIRCUIT, circuitHref, href, mount, short } from "../fengce/ui";
import { V3 } from "../fengce/v3";
import { EXPLORER_TX, useWallet } from "../fengce/wallet";

const hhmm = (t: number) => new Date(t * 1000).toUTCString().slice(17, 22);

/** Live: the Milestone 2 demo Safe's real trip on X Layer mainnet (deployments/m2-demo-xlayer-196.json). */
function LiveTilt() {
  const w = useWallet();
  const [inst, setInst] = useState<Installed | null>(null);
  const [mine, setMine] = useState<Installed | null>(null);
  useEffect(() => {
    if (V3?.demoSafe) readInstalled(V3.demoSafe).then(setInst, () => setInst(null));
  }, []);
  useEffect(() => {
    setMine(null);
    if (w.safe) readInstalled(w.safe).then(setMine, () => setMine(null));
  }, [w.safe]);
  if (!V3?.demoSafe) return null;
  const t = inst?.v3?.tilt;
  const tilts = (m2.txs as Record<string, { hash: string }[]>).tilt ?? [];
  const paused = (m2.txs as Record<string, { hash: string }[]>).paused?.[0];
  return (
    <section className="ts-live">
      <div className="ts-live-h">
        <span className="lbl">Live on X Layer mainnet · demo Safe {short(V3.demoSafe)}</span>
        <span className={`tag ${t?.paused ? "r" : "g"}`}>{!inst ? "reading…" : !inst.v3?.rules.tiltOn ? "OFF" : t?.paused ? "TRIPPED · BUYS PAUSED" : "ON"}</span>
      </div>
      <div className="ts-live-b">
        <span>
          4 buys of 0.2 USDT0 in the same half hour tripped it at {hhmm(Number(m2.steps.tilt.tiltTrippedAt))} UTC:{" "}
          {tilts.map((x, i) => (
            <a key={x.hash} className="alink" href={EXPLORER_TX(x.hash)} target="_blank" rel="noreferrer noopener">
              buy {i + 1}{i < tilts.length - 1 ? " · " : ""}
            </a>
          ))}
        </span>
        {paused && (
          <span>
            The next buy was refused with reason TILT_SHIELD (code 5), recorded on chain:{" "}
            <a className="alink accent" href={EXPLORER_TX(paused.hash)} target="_blank" rel="noreferrer noopener">tx {short(paused.hash)}</a>
          </span>
        )}
        {t && (
          <span className="muted">
            Now: {t.paused ? `buys paused${t.resumesAt ? ` until ${hhmm(t.resumesAt)} UTC` : ""}` : `${t.count} of ${t.tripAt ?? 4} buys in this half hour`} (read from chain just now).
          </span>
        )}
        {mine && (
          <span className="muted">
            Your Safe {short(mine.safe)}: {mine.engine === "v3" ? (mine.v3?.rules.tiltOn ? (mine.v3.tilt?.paused ? "Tilt-shield tripped" : "Tilt-shield on") : "Tilt-shield off") : mine.engine === "v2" ? "guard v2 (Tilt-shield needs guard v3)" : "no Fengce guard yet"}.
          </span>
        )}
      </div>
    </section>
  );
}

/** The simulator follows FengceGuardV3 (src/safe/FengceRulesV3.sol): the buy that makes N buys in the same half hour (UTC), or a
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
      setMsg(big >= 3 ? "One buy at 3× your usual. Buying is paused." : `${n} buys in the same half hour. Buying is paused.`);
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
      setMsg(`${v} buys in the same half hour. Buying is paused.`);
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

      <LiveTilt />

      <div className="ts-steps">
        {[
          ["01 · Watches", "How fast and how big you buy", "Only your Safe's own transactions. No price feeds, no servers."],
          ["02 · Trips", `${n} buys in the same half hour, or one buy 3× your usual`, "circuits"],
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
            <span className="lbl">Try it · this half hour</span>
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
          <div className="ts-lane" role="img" aria-label={`${win.length} buys in this half hour; usual size and 3 times usual marked`}>
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
          <a className="pill accent big ts-cta" href={href("limits", { tpl: "tilt" })}>
            Turn on Tilt-shield
          </a>
          <div className="ts-soon">Runs in FengceGuard v3 on X Layer. On Limits it trips at 4 buys in the same half hour.</div>
        </aside>
      </section>
    </main>
  );
}

mount("tilt-shield", 1, <Tilt />);
