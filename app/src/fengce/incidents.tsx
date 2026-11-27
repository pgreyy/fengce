// Real incidents where a wallet-level rule would have stood. One list, used by the home page (scroll-pinned row) and
// /docs (Incidents). Every entry keeps its date, amount, what happened, why it worked and the Fengce rule; real
// incidents keep their source. The last entry is an everyday example, not an incident, and says so.
import { useEffect, useRef, useState } from "react";

export interface Incident {
  name: string;
  loss: string;
  date: string;
  src?: string;
  host?: string;
  what: string;
  why: string;
  fengce: string;
  /** an illustration, not a reported incident */
  example?: boolean;
}

export const INCIDENTS: Incident[] = [
  { name: "Binance", loss: "~$6.3B", date: "Oct 2026", src: "https://socradar.io/blog/binance-hack-6-3b-hot-wallet-theft/", host: "socradar.io", what: "An attacker took over the internal signing service and drained hot wallets.", why: "Every withdrawal carried a valid signature, so nothing looked wrong.", fengce: "Plain key wallets can't be limited on chain. Held in Fengce-guarded Safes, an outflow limit would have capped each transfer, and raising it would have waited 1 day in public." },
  { name: "Bybit", loss: "~$1.5B", date: "Feb 2025", src: "https://blocksec.com/blog/bybit-incident-a-web2-breach-enables-the-largest-crypto-hack-in-history", host: "blocksec.com", what: "The Safe screen showed a normal transfer while signers approved a contract upgrade.", why: "Signers trusted what the interface showed them.", fengce: "FengceGuard refuses that kind of call outright (a delegatecall upgrade), and changes to the wallet's setup wait in public." },
  { name: "WazirX", loss: "~$230M", date: "Jul 2024", src: "https://www.theblock.co/post/306041/wazirx-exploit", host: "theblock.co", what: "Signers of a Safe multisig approved a transaction that pointed the wallet at attacker code.", why: "The signers could not see in full what they were signing.", fengce: "FengceGuard refuses a delegatecall that rewrites the wallet, whatever the signing screen showed, and changes to the wallet's setup wait in public." },
  { name: "Radiant", loss: "~$50M", date: "Oct 2024", src: "https://medium.com/@RadiantCapital/radiant-post-mortem-fecd6cd38081", host: "medium.com/@RadiantCapital", what: "Malware on signers' devices showed normal transactions while their hardware wallets signed an ownership transfer.", why: "The data on screen and the call being signed were different.", fengce: "A circuit that lists the calls the wallet may make refuses an ownership transfer to an unknown address; adding a new one waits 1 day in public." },
  { name: "AIXBT", loss: "~$106K", date: "Mar 2025", src: "https://www.theblock.co/post/346911/ai-crypto-bot-aixbt-lost-eth-hack-unauthorized-dashboard-access", host: "theblock.co", what: "An attacker got into the agent's dashboard and queued transfers.", why: "Whoever controls the dashboard controls the agent.", fengce: "Over-limit transfers revert, and loosening the rule waits 1 day in public." },
  { name: "Freysa", loss: "$47K", date: "Nov 2024", src: "https://www.theblock.co/post/328747/human-player-outwits-freysa-ai-agent-in-47000-crypto-challenge", host: "theblock.co", what: 'A player talked an AI agent out of its "never send funds" rule.', why: "The only rule lived in the agent's prompt.", fengce: "The circuit doesn't read prompts." },
  { name: "A bad night", loss: "Your stack", date: "Example", what: "Four revenge buys in twenty minutes after a loss.", why: "Nothing in the wallet notices a pattern.", fengce: "Tilt-shield pauses buying after 4 buys in the same half hour, or one buy 3× your usual. Sells and sends still go through (guard v3).", example: true },
];

export function IncidentCard({ x, width }: { x: Incident; width?: number | string }) {
  return (
    <article className="inc-card" style={{ width, flex: width ? "0 0 auto" : undefined, scrollSnapAlign: "start" }}>
      <span className="lbl">
        {x.name} · {x.date}
      </span>
      <span className="num" style={{ fontSize: 30, color: x.example ? "var(--text)" : "var(--deny)" }}>{x.loss}</span>
      <div><span className="lbl" style={{ display: "block" }}>What happened</span><span style={{ fontSize: 15 }}>{x.what}</span></div>
      <div><span className="lbl" style={{ display: "block" }}>Why it worked</span><span className="small">{x.why}</span></div>
      <div className="inc-rule">
        <span className="lbl accent" style={{ display: "block", marginBottom: 6 }}>Fengce rule</span>
        <span style={{ fontSize: 14.5 }}>{x.fengce}</span>
      </div>
      <span className="mono small src-line" style={{ marginTop: "auto" }}>
        {x.src ? (
          <a href={x.src} target="_blank" rel="noreferrer noopener" style={{ textDecoration: "underline" }}>{x.host}</a>
        ) : (
          "an everyday example, not a reported incident"
        )}
      </span>
    </article>
  );
}

function useMode() {
  const [mode, setMode] = useState<"pin" | "grid" | "swipe">("pin");
  useEffect(() => {
    const rm = matchMedia("(prefers-reduced-motion: reduce)");
    const mob = matchMedia("(max-width: 900px)");
    // scroll-linked on every screen, touch included; a static grid only for reduced motion
    const pick = () => setMode(rm.matches ? "grid" : "pin");
    pick();
    rm.addEventListener("change", pick);
    mob.addEventListener("change", pick);
    return () => (rm.removeEventListener("change", pick), mob.removeEventListener("change", pick));
  }, []);
  return mode;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Scroll-pinned row: the section sticks while the page scrolls, the cards move right to left, a progress bar and a
 * counter follow. Scales to any number of cards. Reduced motion: a static grid. Narrow screens: a normal swipe row. */
export function PinnedIncidents({ head }: { head: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const mode = useMode();
  const [dist, setDist] = useState(0);
  const [x, setX] = useState(0);
  const n = INCIDENTS.length;
  useEffect(() => {
    if (mode !== "pin") return;
    const measure = () => {
      const t = track.current;
      if (t?.parentElement) setDist(Math.max(0, t.scrollWidth - t.parentElement.clientWidth));
    };
    const onScroll = () => {
      const o = outer.current, s = pin.current;
      if (o && s) setX(Math.max(0, s.getBoundingClientRect().top - o.getBoundingClientRect().top));
    };
    measure();
    onScroll();
    const ro = typeof ResizeObserver !== "undefined" && track.current ? new ResizeObserver(measure) : null;
    if (ro && track.current) ro.observe(track.current);
    addEventListener("resize", measure);
    addEventListener("scroll", onScroll, { passive: true });
    return () => (ro?.disconnect(), removeEventListener("resize", measure), removeEventListener("scroll", onScroll));
  }, [mode]);
  const p = dist ? Math.min(1, x / dist) : 0;
  const narrow = typeof innerWidth !== "undefined" && innerWidth < 768;
  const counter = (
    <span className="lbl num" aria-live="off">
      {pad(Math.min(n, 1 + Math.floor(p * n * 0.999)))} / {pad(n)}
    </span>
  );
  const top = (
    <div className="w" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
      <div>{head}</div>
      {mode === "pin" && counter}
    </div>
  );
  if (mode === "grid")
    return (
      <section className="sec">
        {top}
        <div className="w" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16, marginTop: 34 }}>
          {INCIDENTS.map((i) => <IncidentCard key={i.name} x={i} />)}
        </div>
      </section>
    );
  if (mode === "swipe")
    return (
      <section className="sec">
        {top}
        <div className="w">
          <div className="scroll-x" style={{ display: "flex", gap: 16, scrollSnapType: "x mandatory", paddingBottom: 8, marginTop: 28 }}>
            {INCIDENTS.map((i) => <IncidentCard key={i.name} x={i} width="min(84vw, 340px)" />)}
          </div>
        </div>
      </section>
    );
  return (
    <section ref={outer} style={{ height: `calc(100vh - var(--headH) + ${dist}px)`, position: "relative", borderBottom: "1px solid var(--line)" }}>
      <div ref={pin} style={{ position: "sticky", top: "var(--headH)", height: "calc(100vh - var(--headH))", display: "flex", flexDirection: "column", justifyContent: "center", overflow: "hidden" }}>
        {top}
        <div className="w" style={{ marginTop: 40 }}>
          <div style={{ overflow: "visible" }}>
            <div ref={track} style={{ display: "flex", gap: 18, width: "max-content", transform: `translate3d(${-Math.min(x, dist)}px, 0, 0)`, willChange: "transform" }}>
              {INCIDENTS.map((i) => <IncidentCard key={i.name} x={i} width={narrow ? "min(80vw, 320px)" : 360} />)}
            </div>
          </div>
          <div style={{ height: 2, background: "var(--line)", marginTop: 34, borderRadius: 2 }}>
            <div style={{ height: 2, width: `${p * 100}%`, background: "var(--accent)" }} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Every incident, as a grid (/docs). */
export function IncidentGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
      {INCIDENTS.map((i) => <IncidentCard key={i.name} x={i} />)}
    </div>
  );
}
