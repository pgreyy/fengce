import { useEffect, useRef, useState } from "react";
import { getAddress, type Address, type Hex } from "viem";
import { safeActivity, type ActivityRow } from "../fengce/chainActivity";
import { MAX_BUY_CIRCUIT, TOKENS, multiSend, swapCalls } from "../fengce/engine";
import { PinnedIncidents } from "../fengce/incidents";
import { readInstalled } from "../fengce/reads";
import { CIRCUIT, CodeCard, circuitHref, href, mount, short, StartLink } from "../fengce/ui";
import { startVinyl } from "../fengce/vinyl-hero.js";
import { EXPLORER_TX, safeInfo, simulateSafeTx } from "../fengce/wallet";
import { DEMO, REASONS, guardOn, swapOfTx, type Swap } from "../fengce/proof";

/** The Safe of the mainnet acceptance test: its real allowed swap and a live check of an over-limit one. */
const LIVE_SAFE = getAddress("0x5641DA334011832Feec997875781a3D40239465e") as Address;

// ------------------------------------------------------------------ vinyl background (hero and closer)
function Vinyl({ veil, cls }: { veil: string; cls?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const opts = {
      isDark: () => document.documentElement.getAttribute("data-theme") !== "light",
      accent: () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#f0533f",
    };
    let stop = startVinyl(c, opts);
    const mo = new MutationObserver(() => (stop(), (stop = startVinyl(c, opts))));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => (mo.disconnect(), stop());
  }, []);
  return (
    <div aria-hidden="true" className={cls} style={{ position: "absolute", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
      <canvas ref={ref} style={{ display: "block" }} />
      <div style={{ position: "absolute", inset: 0, background: veil }} />
    </div>
  );
}
const mix = (pct: number) => `color-mix(in srgb, var(--bg) ${pct}%, transparent)`;

// ------------------------------------------------------------------ hero
function Hero() {
  return (
    <div className="hero">
      <Vinyl cls="hero-vinyl" veil={`linear-gradient(90deg, ${mix(94)} 0%, ${mix(70)} 42%, ${mix(0)} 70%)`} />
      <div className="w hero-in">
        <div className="hero-top">
          <span className="lbl">
            <span className="hide-m">On-chain limits for Safe and agent wallets · X Layer</span>
            <span className="show-m">On-chain limits · X Layer</span>
          </span>
          <h1 className="hero-h1">
            Limits your wallet keeps, <em>even on you.</em>
          </h1>
          <p className="hero-sub">Set a max per buy and trades per hour once. Your Safe refuses anything outside them, in every app and for every agent, because the check lives in the wallet, not in an app.</p>
          <div className="hero-cta">
            <StartLink className="pill accent big" to={href("limits")}>Set my limits</StartLink>
            <a className="pill line big" href={href("try")}>Test a limit</a>
          </div>
        </div>
        <ProofCard />
        <div className="works">
          <span>Works inside</span>
          <b>Safe{"{Wallet}"}</b>
          <span aria-hidden="true">·</span>
          <b>OKX Agentic Wallet</b>
          <span aria-hidden="true">·</span>
          <b>any app that routes through your Safe</b>
        </div>
      </div>
      <span className="hero-cue" aria-hidden="true" />
    </div>
  );
}

// ------------------------------------------------------------------ phones: live proof card inside the hero
interface Proof {
  on: boolean | null;
  swap: Swap | null;
  refused: Swap | null;
}
function ProofCard() {
  const [p, setP] = useState<Proof | null>(null);
  useEffect(() => {
    if (!DEMO || !window.matchMedia("(max-width: 767px)").matches) return;
    let alive = true;
    Promise.all([guardOn(DEMO.safe, DEMO.guard).catch(() => null), swapOfTx(DEMO.swapTx).catch(() => null), swapOfTx(DEMO.refuseTx).catch(() => null)]).then(
      ([on, swap, refused]) => alive && setP({ on, swap, refused }),
    );
    return () => void (alive = false);
  }, []);
  if (!DEMO) return null;
  const sk = <i className="sk" style={{ width: 150 }} />;
  return (
    <div className="proof">
      <div className="proof-h">
        <span className="mono">Safe {short(DEMO.safe)}</span>
        <span className={`proof-on${p?.on === false ? " off" : ""}`}>{p ? (p.on ? "● guard on" : p.on === false ? "○ guard off" : "") : ""}</span>
      </div>
      <a className="proof-r" href={EXPLORER_TX(DEMO.swapTx)} target="_blank" rel="noreferrer noopener">
        <span>{p ? (p.swap ? `Swap ${p.swap.amount} → ${p.swap.out}` : "Swap") : sk}</span>
        <span className="tag g">ALLOWED</span>
      </a>
      <a className="proof-r" href={EXPLORER_TX(DEMO.refuseTx)} target="_blank" rel="noreferrer noopener">
        <span>{p ? (p.refused ? `Swap ${p.refused.amount} → ${p.refused.out}` : "Swap") : sk}</span>
        <span className="tag r">REFUSED · {REASONS[DEMO.refusedCode] ?? `code ${DEMO.refusedCode}`}</span>
      </a>
      <span className="proof-f">X Layer mainnet · {DEMO.refusedCode === 1 ? "refused by the max per buy circuit, recorded on chain" : "refusal recorded on chain"}</span>
    </div>
  );
}

// ------------------------------------------------------------------ live strip (real data from the acceptance Safe)
interface Live {
  allowed: ActivityRow | null;
  stopped: { amount: string; reason: string; tx: Hex | null } | null;
  cap: number | null;
}
function useLive(): Live | null {
  const [v, setV] = useState<Live | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [rows, inst, info] = await Promise.all([
        safeActivity(LIVE_SAFE, 10).catch(() => [] as ActivityRow[]),
        readInstalled(LIVE_SAFE).catch(() => null),
        safeInfo(LIVE_SAFE).catch(() => null),
      ]);
      const cap = inst?.maxPerBuy != null ? Number(inst.maxPerBuy) / 1e6 : null;
      const allowed = rows.find((r) => r.ok === true && r.type.startsWith("Swap")) ?? null;
      const onChain = rows.find((r) => r.ok === false && r.type.startsWith("Swap"));
      let stopped: Live["stopped"] = onChain ? { amount: onChain.amount, reason: onChain.reason, tx: onChain.tx } : null;
      if (!stopped && cap !== null && info) {
        // no over-limit swap is recorded on chain for this Safe: run one against the live guard (eth_call, not sent)
        const amt = BigInt(Math.round((cap + 1) * 1e6));
        const sim = await simulateSafeTx(info.owners[0], LIVE_SAFE, multiSend(swapCalls(LIVE_SAFE, TOKENS.USDT0.address, TOKENS.WOKB.address, amt, 0n, 500)));
        stopped = sim.ok ? null : { amount: `${cap + 1} USDT0`, reason: sim.reason.text, tx: null };
      }
      if (alive) setV({ allowed, stopped, cap });
    })().catch(() => alive && setV({ allowed: null, stopped: null, cap: null }));
    return () => void (alive = false);
  }, []);
  return v;
}

function LiveStrip() {
  const v = useLive();
  const wait = <span className="muted">reading X Layer…</span>;
  return (
    <section className="sec">
      <div className="w">
        <span className="lbl">Live on X Layer mainnet</span>
        <h2 className="h2">One allowed. One stopped. Same Safe, same limits.</h2>
        <div className="receipt">
          <div>
            <span className="lbl">{v?.allowed ? `Swap ${v.allowed.amount}` : "Swap within the cap"}</span>
            <div className="v"><span className="tag g">ALLOWED</span></div>
            <span className="small mono">
              {!v ? wait : v.allowed?.tx ? <a href={EXPLORER_TX(v.allowed.tx)} target="_blank" rel="noreferrer noopener" style={{ textDecoration: "underline" }}>tx {short(v.allowed.tx)}</a> : "no swap found"}
            </span>
          </div>
          <div>
            <span className="lbl">{v?.stopped ? `Swap ${v.stopped.amount} → OKB` : "Swap over the cap"}</span>
            <div className="v"><span className="tag r">REFUSED</span></div>
            <span className="small">
              {!v ? (
                wait
              ) : v.stopped ? (
                <>
                  {v.stopped.reason}
                  {v.stopped.tx ? (
                    <>
                      {" · "}
                      <a className="mono" href={EXPLORER_TX(v.stopped.tx)} target="_blank" rel="noreferrer noopener" style={{ textDecoration: "underline" }}>tx {short(v.stopped.tx)}</a>
                    </>
                  ) : (
                    " · checked against the guard just now (eth_call, not sent)"
                  )}
                </>
              ) : (
                "could not run the check just now"
              )}
            </span>
          </div>
          <div>
            <span className="lbl">Checked by</span>
            <div className="v num">FengceGuard</div>
            <span className="small">on Safe {short(LIVE_SAFE)}{v?.cap != null ? ` · max per buy ${v.cap} USDT0` : ""}</span>
          </div>
          <div>
            <span className="lbl">Rule ran on</span>
            <div className="v num">
              <a className="code-link" href={circuitHref(CIRCUIT.maxBuy)}>TapeOut circuit #{String(MAX_BUY_CIRCUIT.id)}</a>
            </div>
            <span className="small">pinned code, readable on chain</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ wallets
function Wallets() {
  return (
    <section className="sec" id="wallets">
      <div className="w">
        <span className="lbl">Bring your own wallet</span>
        <h2 className="h2">Nothing new to download.</h2>
        <div className="grid2" style={{ marginTop: 34 }}>
          <a className="card2" href={href("install")}>
            <span className="lbl">For people and teams</span>
            <span className="card2-t">Safe{"{Wallet}"}</span>
            <span className="body" style={{ fontSize: 16 }}>Install the guard from the Safe app in one batch. From then on every swap and send from that Safe is checked, whichever app sent it.</span>
            <span className="mono small">app.safe.global → Transaction Builder → load fengce-install.json → sign</span>
          </a>
          <a className="card2" href={href("agents")}>
            <span className="lbl">For AI agents</span>
            <span className="card2-t">OKX Agentic Wallet</span>
            <span className="body" style={{ fontSize: 16 }}>Your agent keeps its own key but acts through a Fengce-bound Safe. If it is tricked into overspending, the chain says no and returns a reason code the agent can read.</span>
            <span className="mono small">onchainos wallet contract-call → AgentExecutor → Safe → guard</span>
          </a>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ eight rules
const RULES: { name: string; short: string; status: "LIVE" | "GUARD V3" | "CATALOG"; long: string; example: string; to: string; circuit?: [string, string][] }[] = [
  { name: "Max per buy", short: "Any single swap or send above it is refused.", status: "LIVE", long: "You set 30 USDT0. A 31 USDT0 swap from any app is refused with MAX_PER_BUY before it moves a cent.", example: "30 USDT0", to: href("limits", { rule: "cap" }), circuit: [["NAND circuit #2", CIRCUIT.maxBuy]] },
  { name: "Trades per hour", short: "Counts swaps each UTC clock hour.", status: "LIVE", long: "Set 5 per hour. The 6th swap in the same clock hour is refused; the counter resets on the hour. Sends don't count.", example: "5 / hour", to: href("limits", { rule: "rate" }), circuit: [["Counter circuit #7", CIRCUIT.counter]] },
  { name: "Quiet hours", short: "No trading in the hours you choose.", status: "GUARD V3", long: "Pick a window like 01:00 to 07:00 UTC. Swaps inside it are refused with QUIET_HOURS. Sends still work.", example: "01:00 to 07:00", to: href("limits", { rule: "quiet" }), circuit: [["NAND circuit #2", CIRCUIT.maxBuy]] },
  { name: "Hold lock", short: "No selling a token within N hours of buying it.", status: "GUARD V3", long: "Buy a token and it can't be sold for the hours you set. Stops panic-selling the dip you just bought.", example: "24 hours", to: href("limits", { rule: "hold" }), circuit: [["NAND circuit #2", CIRCUIT.maxBuy]] },
  { name: "Tilt-shield", short: "4 buys in 30 minutes, or one buy 3× your usual, pauses buying.", status: "GUARD V3", long: "When the pattern trips, buying pauses for your cooldown. Sells and sends still go through.", example: "Pause 6 hours", to: href("tilt-shield"), circuit: [["Counter circuit #7", CIRCUIT.counter], ["Tilt-shield latch", CIRCUIT.tiltLatch]] },
  { name: "Agent cap", short: "A separate budget per agent key, with reason codes.", status: "GUARD V3", long: "Each agent key gets its own daily budget. Over it, the agent gets AGENT_CAP back and can tell you why.", example: "50 USDT0 / day", to: href("agents"), circuit: [["NAND circuit #2", CIRCUIT.maxBuy]] },
  { name: "Partner approval", short: "Optional. A partner can speed up loosening; silence falls back after 7 days.", status: "GUARD V3", long: "Name a friend. They can approve a looser limit early. If they never answer, it unlocks after 7 days anyway.", example: "Optional", to: href("limits", { rule: "partner" }) },
  { name: "Add a circuit", short: "Install a rule from the catalog, or build your own.", status: "CATALOG", long: "Pick a pinned TapeOut circuit from the Fengce catalog, or build one. Designers earn 80% of install fees.", example: "Catalog", to: href("limits", { tab: "add" }), circuit: [["Catalog circuits", CIRCUIT.catalog]] },
];

function Rules() {
  const [on, setOn] = useState(0);
  const r = RULES[on];
  return (
    <section className="sec">
      <div className="w">
        <span className="lbl">What you can set</span>
        <h2 className="h2">Eight rules. Tighten instantly, loosen slowly.</h2>
        <div className="g4" role="tablist" aria-label="Rules">
          {RULES.map((x, i) => (
            <button key={x.name} type="button" role="tab" aria-selected={i === on} className={`rule-btn${i === on ? " on" : ""}`} onClick={() => setOn(i)}>
              <span className="rule-t">{x.name}</span>
              <span className="rule-d">{x.short}</span>
              <span className="rule-s" style={x.status === "LIVE" ? { color: "var(--allow)" } : undefined}>{x.status}</span>
            </button>
          ))}
        </div>
        <div className="rdet" role="tabpanel">
          <div>
            <span className="lbl">
              {r.name} · {r.status}
            </span>
            <p style={{ fontSize: 16, lineHeight: 1.55, margin: "10px 0 0" }}>{r.long}</p>
          </div>
          <div>
            <span className="lbl">Example setting</span>
            <div className="num" style={{ fontSize: 24, marginTop: 8 }}>{r.example}</div>
            <div className="small" style={{ marginTop: 8 }}>
              {r.circuit ? "Decided on " : "Kept by the guard's timelock"}
              {r.circuit?.map(([label, anchor], i) => (
                <span key={anchor}>
                  {i ? " + " : ""}
                  <a className="code-link mono" href={circuitHref(anchor)}>{label}</a>
                </span>
              ))}
            </div>
          </div>
          <a className="pill accent big" href={r.to}>Set this</a>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ layer stack
function Holds() {
  const plates: [string, string, boolean?][] = [
    ["You · apps · agents", "ASK"],
    ["Your Safe", "HOLDS FUNDS"],
    ["Fengce guard", "DECIDES", true],
    ["TapeOut circuits (pinned)", "RULE LOGIC"],
    ["X Layer", "ENFORCES"],
  ];
  return (
    <section className="sec">
      <div className="w stack2">
        <div>
          <span className="lbl">How it holds</span>
          <h2 className="h2">The rule sits below every app.</h2>
          <p className="body" style={{ marginTop: 18, maxWidth: 480 }}>
            Apps and agents only ask. Your Safe sends every transaction through the guard, the guard asks a pinned TapeOut circuit, and X Layer keeps the answer. Removing the guard takes 2 days, so a stolen session or a bad moment can't switch it off.
          </p>
          <div className="holds-stats">
            {[
              ["0s", "to tighten"],
              ["1 day", "to loosen"],
              ["2 days", "to remove"],
            ].map(([a, b]) => (
              <div key={b}>
                <span className="num">{a}</span>
                <span className="lbl">{b}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="plates">
          {plates.map(([a, n, hl]) => (
            <div key={a} className={`plate${hl ? " hl" : ""}`}>
              <span>{a}</span>
              <span className="lbl" style={hl ? { color: "var(--accent)" } : undefined}>{n}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ compared
function Compared() {
  const rows: [string, string, string, string][] = [
    ["Holds if you use another app", "no", "yes", "yes"],
    ["Holds if the service is bypassed", "no", "yes", "yes"],
    ["Trades per hour", "varies", "no", "yes"],
    ["Quiet hours, hold lock, Tilt-shield", "varies", "no", "guard v3"],
    ["Per-agent caps with reason codes", "varies", "no", "guard v3"],
    ["Loosening is delayed", "no", "no", "1 day"],
    ["Rule code pinned and readable on chain", "no", "yes", "yes"],
  ];
  const cls = (v: string) => (v === "yes" || v === "1 day" ? "allow" : "muted");
  return (
    <section className="sec">
      <div className="w">
        <span className="lbl">Compared</span>
        <h2 className="h2">Limits in an app vs limits in the wallet.</h2>
        <div className="scroll-x" style={{ marginTop: 30 }}>
          <table className="rt stk cmp">
            <thead>
              <tr>
                <th />
                <th>App or wallet-service limits</th>
                <th>Safe allowance module</th>
                <th style={{ color: "var(--accent)" }}>Fengce</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([k, a, b, f]) => (
                <tr key={k}>
                  <td className="rowhead">{k}</td>
                  <td data-label="App limits" className={`mono ${cls(a)}`}>{a}</td>
                  <td data-label="Allowance module" className={`mono ${cls(b)}`}>{b}</td>
                  <td data-label="Fengce" className={`mono f ${cls(f)}`}>{f}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <a className="alink" href={href("docs", { tab: "cmp" })} style={{ display: "inline-block", marginTop: 18 }}>Full comparison</a>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ developers
function Developers() {
  return (
    <section className="sec" id="dev">
      <div className="w grid2">
        <div>
          <span className="lbl">For developers and agents</span>
          <h2 className="h2">Check a trade before you send it.</h2>
          <p className="body" style={{ maxWidth: 460, marginTop: 16 }}>One call tells your app or agent whether a Safe will allow a transaction, and why not. Install the agent skill, or use the SDK.</p>
          <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
            <a className="pill line big" href={href("docs", { tab: "devs" })}>Docs</a>
            <a className="pill line big" href="https://github.com/pgreyy/fengce" target="_blank" rel="noreferrer noopener">GitHub</a>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <CodeCard title="agent skill" code={"npx skills add pgreyy/fengce --skill fengce"} />
          <CodeCard title="sdk" code={'const r = await fengce.check(safe, tx)\n// { allowed: false, reason: "MAX_PER_BUY", limit: 30 }'} />
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ closer with the decision feed (an example)
const FEED: [string, string, "g" | "r"][] = [
  ["swap 1 USDT0 → OKB", "ALLOWED", "g"],
  ["swap 31 USDT0 → OKB", "MAX_PER_BUY", "r"],
  ["send 5 USDT0", "ALLOWED", "g"],
  ["agent buy 80 USDT0", "AGENT_CAP", "r"],
  ["swap at 03:10 UTC", "QUIET_HOURS", "r"],
  ["swap 12 USDT0 → OKB", "ALLOWED", "g"],
  ["4th buy in 30 min", "TILT_SHIELD", "r"],
  ["loosen max to 60", "WAITS 1 DAY", "r"],
];
function Feed() {
  const [rows, setRows] = useState(() => {
    const t = new Date().toISOString().slice(11, 16);
    return FEED.slice(0, 5)
      .reverse()
      .map((e, k) => ({ e, t, k }));
  });
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 5,
      k = 5;
    const id = setInterval(() => {
      const e = FEED[i++ % FEED.length];
      setRows((r) => [{ e, t: new Date().toISOString().slice(11, 16), k: k++ }, ...r].slice(0, 5));
    }, 2200);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="feed">
      <div className="fh">
        <span className="lbl">Example · Safe {short(LIVE_SAFE)}</span>
        <span className="lbl" style={{ color: "var(--allow)" }}>● guard on</span>
      </div>
      {rows.map(({ e, t, k }) => (
        <div key={k} className="fr">
          <span className="num muted" style={{ fontSize: 12 }}>{t}</span>
          <span>{e[0]}</span>
          <span className={`tag ${e[2]}`}>{e[1]}</span>
        </div>
      ))}
      <div className="fnote small">Example feed. Quiet hours, agent caps and Tilt-shield answer like this once guard v3 is live.</div>
    </div>
  );
}

function Closer() {
  return (
    <section className="closewrap">
      <Vinyl veil={`linear-gradient(90deg, ${mix(92)} 0%, ${mix(55)} 45%, ${mix(15)} 100%)`} />
      <div className="w closer">
        <div style={{ position: "relative" }}>
          <span className="lbl">Start on your own Safe</span>
          <div className="ch">
            Set it once.
            <br />
            <em>It holds.</em>
          </div>
          <p className="body" style={{ maxWidth: 380, marginTop: 18 }}>One signature installs your limits. After that, every app and agent gets the same answer.</p>
          <div className="hero-cta">
            <StartLink className="pill accent big" to={href("limits")}>Set my limits</StartLink>
            <a className="pill line big" href={href("try")}>Test a limit</a>
          </div>
        </div>
        <Feed />
      </div>
    </section>
  );
}

function Home() {
  return (
    <main className="pg home">
      <Hero />
      <LiveStrip />
      <Wallets />
      <Rules />
      <Holds />
      <PinnedIncidents
        head={
          <>
            <span className="lbl">Real incidents</span>
            <h2 className="h2">Where a wallet-level rule would have stood.</h2>
          </>
        }
      />
      <Compared />
      <Developers />
      <Closer />
    </main>
  );
}

mount("", 0, <Home />, { home: true });
