import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DEPLOYMENT, EXPLORER } from "../lib/chain";
import { WALLETS } from "../lib/wallets";
import { DEWEB, LINKS, RELEASE, href, mount, short } from "../ui/kit";
import "../landing.css";

/** Tests passing in CI for the release commit (docs/claims.json "tests-112"). */
const TESTS_PASSING = 112;
const CONTRACTS = Object.keys(DEPLOYMENT.contracts).length;
/** Wallet types with a tested adapter (docs/claims.json "wallet-types-8"). */
const WALLET_TYPES = WALLETS.filter((w) => w.tests !== "none").length;
/** The v2 mainnet demo (docs/claims.json "demo-denied", "demo-allowed"). */
const DENIED_TX = "0x9b70d386a2782e269ab1d3b1df6de767534a5b5b7904998abd92a651d2584a1b";
const ALLOWED_TX = "0x7a70f5c9713fd9236ecdd81287bcf775253d2cbea19c857524bb1047acfcccab";
const tx = (h: string) => `${EXPLORER}/tx/${h}`;
const DEMO_SAFE = DEPLOYMENT.demoSafe as string;

const TxLink = ({ h }: { h: string }) => (
  <a className="txl" href={tx(h)} target="_blank" rel="noreferrer noopener">
    {short(h)}
  </a>
);
const Ext = ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
  <a className={className} href={to} target="_blank" rel="noreferrer noopener">
    {children}
  </a>
);
const v = (o: Record<string, string | number>) => o as CSSProperties;

// ---------------------------------------------------------------- hero

function HeroLoop() {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    // Reduced motion: freeze the loop on its last frame (0.5 USDT0 executed).
    const svg = ref.current;
    if (svg && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      svg.pauseAnimations();
      svg.setCurrentTime(8.1);
    }
  }, []);
  const gate = "M430 55 h50 a45 45 0 0 1 0 90 h-50 z";
  return (
    <svg ref={ref} viewBox="0 0 1100 210" width="100%" role="img" aria-label="A 1.5 USDT0 transfer hits the rule circuit and reverts, then a 0.5 USDT0 transfer passes through to the wallet" className="loop">
      <g fill="none" stroke="var(--line)" strokeWidth="2">
        <path d="M150 70 H430" />
        <path d="M150 150 H340 V120 H430" />
        <path d="M525 100 H880" />
      </g>
      <g fill="none" stroke="var(--accent)" strokeWidth="2" opacity=".55">
        <path className="flow" d="M150 70 H430" />
        <path className="flow" d="M150 150 H340 V120 H430" />
        <path className="flow" d="M525 100 H880" />
      </g>
      <g className="svg-mono" fontSize="12" fill="var(--muted)">
        <rect x="10" y="52" width="140" height="36" rx="8" fill="var(--raised)" stroke="var(--line)" />
        <text x="80" y="75" textAnchor="middle">tx.amount</text>
        <rect x="10" y="132" width="140" height="36" rx="8" fill="var(--raised)" stroke="var(--line)" />
        <text x="80" y="155" textAnchor="middle">cap = 1 USDT0</text>
      </g>
      <path d={gate} fill="var(--raised)" stroke="var(--text)" strokeWidth="2" />
      <path d={gate} fill="none" stroke="var(--denied)" strokeWidth="4" opacity="0">
        <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;.21;.24;.34;1" dur="9s" repeatCount="indefinite" />
      </path>
      <path d={gate} fill="none" stroke="var(--allowed)" strokeWidth="4" opacity="0">
        <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;.64;.67;.78;1" dur="9s" repeatCount="indefinite" />
      </path>
      <text x="468" y="106" textAnchor="middle" className="svg-mono" fontSize="20" fill="var(--text)">≤</text>
      <text x="478" y="172" textAnchor="middle" className="svg-mono" fontSize="11" fill="var(--muted)">pinned TapeOut circuit</text>
      <rect x="880" y="72" width="210" height="56" rx="10" fill="var(--raised)" stroke="var(--line)" />
      <rect x="880" y="72" width="210" height="56" rx="10" fill="none" stroke="var(--allowed)" strokeWidth="2" opacity="0">
        <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;.8;.83;.93;.97;1" dur="9s" repeatCount="indefinite" />
      </rect>
      <text x="985" y="96" textAnchor="middle" className="svg-sans" fontSize="14" fontWeight="600" fill="var(--text)">Wallet</text>
      <text x="985" y="115" textAnchor="middle" className="svg-mono" fontSize="11" fill="var(--muted)">Safe {short(DEMO_SAFE)}</text>
      <g opacity="0">
        <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;.02;.25;.33;1" dur="9s" repeatCount="indefinite" />
        <animateMotion dur="9s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;.22;1" calcMode="linear" path="M210 70 H392" />
        <rect x="-46" y="-14" width="92" height="28" rx="14" fill="var(--surface)" stroke="var(--text)" />
        <text y="4" textAnchor="middle" className="svg-mono" fontSize="12" fill="var(--text)">1.5 USDT0</text>
      </g>
      <g opacity="0">
        <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;.22;.25;.4;.46;1" dur="9s" repeatCount="indefinite" />
        <rect x="398" y="10" width="140" height="26" rx="6" fill="var(--denied)" />
        <text x="468" y="27" textAnchor="middle" className="svg-mono" fontSize="12" fontWeight="500" fill="#fff">REVERTED · over cap</text>
      </g>
      <g opacity="0">
        <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;.47;.49;.9;.95;1" dur="9s" repeatCount="indefinite" />
        <animateMotion dur="9s" repeatCount="indefinite" keyPoints="0;0;.38;.48;1;1" keyTimes="0;.48;.62;.68;.82;1" calcMode="linear" path="M210 70 H440 L520 100 H830" />
        <rect x="-46" y="-14" width="92" height="28" rx="14" fill="var(--surface)" stroke="var(--allowed)" />
        <text y="4" textAnchor="middle" className="svg-mono" fontSize="12" fill="var(--text)">0.5 USDT0</text>
      </g>
      <g opacity="0">
        <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;.82;.84;.93;.97;1" dur="9s" repeatCount="indefinite" />
        <rect x="905" y="150" width="160" height="26" rx="6" fill="var(--allowed)" />
        <text x="985" y="167" textAnchor="middle" className="svg-mono" fontSize="12" fontWeight="500" fill="#04140C">EXECUTED</text>
      </g>
    </svg>
  );
}

function Hero() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      const x = e.clientX - b.left;
      const y = e.clientY - b.top;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--mx", `${Math.round(x)}px`);
        el.style.setProperty("--my", `${Math.round(y)}px`);
        el.classList.add("hover");
      });
    };
    const leave = () => el.classList.remove("hover");
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, []);
  const word = (w: string, d: number, extra?: string) => (
    <span className="mask">
      <span className={extra} style={v({ animationDelay: `${d}s` })}>
        {w}
      </span>
    </span>
  );
  return (
    <section className="hero" ref={ref}>
      <div className="hero-grid" aria-hidden="true" />
      <div className="hero-glow" aria-hidden="true" />
      <div className="hero-inner">
        <span className="fi mono badge" style={v({ animationDelay: ".05s" })}>
          <span className="pulse" style={{ color: "var(--allowed)" }}>●</span> Wallet-level enforcement layer for TapeOut · X Layer mainnet
        </span>
        <h1 className="hero-h1">
          {word("The", 0.1)} {word("wallet-level", 0.18, "ul accent")} {word("enforcement", 0.26)}
          <br />
          {word("layer", 0.36)} {word("for", 0.44)} {word("TapeOut.", 0.52)}
        </h1>
        <p className="fi hero-sub" style={v({ animationDelay: ".75s" })}>
          Your rules run as TapeOut circuits on X Layer, and the wallet itself enforces them, for owners and AI agents alike.
        </p>
        <div className="fi hero-cta" style={v({ animationDelay: ".9s" })}>
          <a className="cta" href={href("install")}>
            Protect a wallet
          </a>
          <a className="cta ghost" href={href("safe")}>
            See it on mainnet
          </a>
        </div>
        <p className="fi hero-note" style={v({ animationDelay: "1.05s" })}>
          Fengce makes any TapeOut circuit enforceable: in your wallet today, in markets with Verdict, and anywhere a circuit's answer needs to be trusted on-chain.
        </p>
        <div className="fi card loop-card" style={v({ animationDelay: "1.25s" })}>
          <div className="mono loop-head">
            <span>live loop · two real mainnet transactions</span>
            <span>rule: amount ≤ 1 USDT0</span>
          </div>
          <HeroLoop />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- ticker

function Ticker() {
  const items: ReactNode[] = [
    <>
      <span style={{ color: "var(--denied)" }}>DENIED</span> 1.5 USDT0 · agent · <TxLink h={DENIED_TX} />
    </>,
    <>
      <span style={{ color: "var(--allowed)" }}>ALLOWED</span> 0.5 USDT0 · agent · <TxLink h={ALLOWED_TX} />
    </>,
    <>
      {CONTRACTS}/{CONTRACTS} contracts verified on Sourcify
    </>,
    <>Hosted on TapeOut · {DEWEB.name}</>,
    <>npm · @fengce/sdk</>,
    <>isBound · 1 day minimum notice</>,
  ];
  return (
    <div className="ticker" aria-label="Live mainnet activity">
      <div className="ticker-track mono">
        {[0, 1].map((k) =>
          items.map((it, i) => (
            <span key={`${k}-${i}`} aria-hidden={k === 1 ? true : undefined}>
              {it}
            </span>
          )),
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- try the rule

function Count({ to }: { to: number }) {
  return (
    <span className="fg-count" style={v({ "--to": to })}>
      <span className="fg-num">{to}</span>
    </span>
  );
}

function TryRule() {
  const [amt, setAmt] = useState(1.5);
  const ok = amt <= 1.0001;
  const label = `${amt.toFixed(1)} USDT0`;
  const note =
    amt === 1.5 ? (
      <>
        Same as the real denied transfer: <TxLink h={DENIED_TX} /> on X Layer.
      </>
    ) : amt === 0.5 ? (
      <>
        Same as the real allowed transfer: <TxLink h={ALLOWED_TX} /> on X Layer.
      </>
    ) : (
      "The rule is a pinned TapeOut circuit, so this answer is the same one the wallet gets on-chain."
    );
  const tone = ok ? "var(--allowed)" : "var(--denied)";
  return (
    <section className="band">
      <div className="try-grid">
        <div className="lrv card try-card">
          <span className="eyebrow">Try the rule</span>
          <span className="try-title">Drag the amount. Watch the wallet decide.</span>
          <label htmlFor="amt" className="mono try-label">
            <span>Agent sends</span>
            <span className="try-val">{label}</span>
          </label>
          <input id="amt" type="range" min="0.1" max="2" step="0.1" value={amt.toFixed(1)} onChange={(e) => setAmt(Math.round(parseFloat(e.target.value) * 10) / 10)} />
          <div className="mono try-scale">
            <span>0.1</span>
            <span>cap 1.0</span>
            <span>2.0</span>
          </div>
          <span className="try-note">{note}</span>
        </div>
        <div className="lrv card try-card try-out">
          <svg viewBox="0 0 420 160" width="100%" aria-hidden="true">
            <path d="M10 50 H170" stroke={tone} strokeWidth="3" fill="none" className="tr" />
            <path d="M10 115 H120 V85 H170" stroke="var(--line)" strokeWidth="3" fill="none" />
            <path d="M170 35 h44 a45 45 0 0 1 0 90 h-44 z" fill="var(--raised)" stroke={tone} strokeWidth="3" className="tr" />
            <text x="206" y="87" textAnchor="middle" className="svg-mono" fontSize="18" fill="var(--text)">≤</text>
            <path d="M259 80 H410" stroke={ok ? "var(--allowed)" : "var(--line)"} strokeWidth="3" fill="none" strokeDasharray={ok ? "0" : "6 8"} className="tr" />
            <text x="10" y="40" className="svg-mono" fontSize="11" fill="var(--muted)">{label}</text>
            <text x="10" y="140" className="svg-mono" fontSize="11" fill="var(--muted)">cap 1 USDT0</text>
          </svg>
          <div className="try-res">
            <span className="mono mark" style={{ color: tone, borderColor: tone, background: `color-mix(in srgb, ${tone} 10%, transparent)` }} aria-live="polite">
              {ok ? "ALLOWED" : "DENIED · reverts"}
            </span>
            <span className="mono muted" style={{ fontSize: 12 }}>
              {ok ? "wallet executes" : "no funds move"}
            </span>
          </div>
        </div>
      </div>
      <div className="stats">
        <div className="lrv card lift stat">
          <span className="stat-v">{RELEASE}</span>
          <span className="stat-k">live on X Layer</span>
        </div>
        <div className="lrv card lift stat">
          <span className="stat-v">
            <Count to={CONTRACTS} />/{CONTRACTS}
          </span>
          <span className="stat-k">verified on Sourcify</span>
        </div>
        <div className="lrv card lift stat">
          <span className="stat-v">
            <Count to={TESTS_PASSING} />
          </span>
          <span className="stat-k">tests passing</span>
        </div>
        <div className="lrv card lift stat">
          <span className="stat-v">
            <Count to={WALLET_TYPES} />
          </span>
          <span className="stat-k">wallet types</span>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- why this matters

const INCIDENTS = [
  {
    name: "Binance",
    loss: "~$6.3B",
    date: "Oct 2026",
    what: "Attacker took over the internal signing service and drained hot wallets.",
    why: "Every withdrawal carried a valid signature, so nothing looked wrong.",
    fengce: "Plain key wallets can't be restricted on-chain. As Fengce-guarded smart wallets, a per-hour outflow rule would have capped the loss, and the limit couldn't be raised in the same 20 minutes.",
    src: "https://socradar.io/blog/binance-hack-6-3b-hot-wallet-theft/",
  },
  {
    name: "Bybit",
    loss: "~$1.5B",
    date: "Feb 2025",
    what: "The Safe screen showed a normal transfer while signers approved a contract upgrade.",
    why: "Signers trusted what the interface showed them.",
    fengce: "FengceGuard refuses that kind of call outright; wallet setup changes wait days, in public.",
    src: "https://blocksec.com/blog/bybit-incident-a-web2-breach-enables-the-largest-crypto-hack-in-history",
  },
  {
    name: "Freysa",
    loss: "$47K",
    date: "Nov 2024",
    what: 'A player talked an AI agent out of its "never send funds" rule.',
    why: "The only rule lived in the agent's prompt.",
    fengce: "The circuit doesn't read prompts.",
    src: "https://www.theblock.co/post/328747/human-player-outwits-freysa-ai-agent-in-47000-crypto-challenge",
  },
  {
    name: "AIXBT",
    loss: "~$106K",
    date: "Mar 2025",
    what: "Attacker got into the agent's dashboard and queued transfers.",
    why: "Whoever controls the dashboard controls the agent.",
    fengce: "Over-limit transfers revert, and the rule can't be changed for days.",
    src: "https://www.theblock.co/post/346911/ai-crypto-bot-aixbt-lost-eth-hack-unauthorized-dashboard-access",
  },
];

function Incidents() {
  return (
    <section className="inc-outer">
      <div className="inc-sticky">
        <div className="wrap3 inc-head">
          <div className="head-col">
            <span className="eyebrow">Why this matters</span>
            <h2 className="h2">Each of these passed a check that only looked, or only asked.</h2>
          </div>
          <div className="inc-meter">
            <span className="mono inc-count">
              <span className="fg-num">04 incidents</span>
            </span>
            <div className="inc-rail">
              <div className="inc-bar" />
            </div>
          </div>
        </div>
        <div className="wrap3 inc-viewport">
          <div className="inc-track">
            {INCIDENTS.map((i, k) => (
              <article className="card inc" key={i.name}>
                <span className={`stamp st${k + 1}`} aria-hidden="true">
                  FENGCE · REVERTS
                </span>
                <span className="mono muted" style={{ fontSize: 12 }}>
                  {i.date}
                </span>
                <span className="inc-name">{i.name}</span>
                <span className={`mono inc-loss strike st${k + 1}`}>{i.loss}</span>
                <div className="inc-body">
                  <div>
                    <span className="mono k">WHAT HAPPENED</span>
                    {i.what}
                  </div>
                  <div>
                    <span className="mono k">WHY THE CHECK FAILED</span>
                    {i.why}
                  </div>
                  <div className="with">
                    <span className="mono k">WITH FENGCE</span>
                    {i.fengce}
                  </div>
                </div>
                <Ext to={i.src} className="mono src">
                  Source
                </Ext>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- comparison tables

type Tone = "good" | "mid" | "bad" | "na";
type Row = [string, [string, Tone], [string, Tone], [string, Tone], string];

const AGENT_COLS = ["Prompt rules (agent instructions)", "Pocket Universe, Wallet Guard, Rabby, Blockaid", "Coinbase CDP, Privy, Turnkey"];
const AGENT_ROWS: Row[] = [
  ["Agent talked out of its rule (Freysa)", ["Bypassed", "bad"], ["No human to read the warning; it signs", "bad"], ["Blocked if the policy was set", "mid"], "Blocked: the circuit doesn't read prompts"],
  ["Agent's dashboard hijacked (AIXBT)", ["Bypassed", "bad"], ["Not involved", "na"], ["Blocked unless the attacker also reaches the policy admin", "mid"], "Blocked, and the rule can't change for days"],
  ["Rogue co-owner or stolen owner key", ["n/a", "na"], ["Warning, clicked through", "bad"], ["Owner can change the policy", "bad"], "Blocked: owners are bound too"],
  ["Vendor's servers down or compromised", ["n/a", "na"], ["n/a", "na"], ["Exposed", "bad"], "Not affected: no vendor in the loop"],
];
const DIFF_COLS = ["Coinbase CDP, Privy, Turnkey", "Hypernative Guardian (Safe Shield)", "MetaMask Delegation Toolkit, Zodiac Roles"];
const DIFF_ROWS: Row[] = [
  ["Who runs the check", ["The vendor's enclave", "mid"], ["Hypernative's service plus a Safe guard", "mid"], ["On-chain contract", "good"], "On-chain, a public TapeOut circuit"],
  ["Company in the middle", ["Yes", "bad"], ["Yes", "bad"], ["No", "good"], "No"],
  ["Binds the owners too", ["Owners control the policy", "bad"], ["Policy-dependent", "mid"], ["No, delegates only", "bad"], "Yes"],
  ["Can the rule change quietly", ["Yes, instantly through the API", "bad"], ["Through their dashboard", "bad"], ["Owner can change it", "bad"], "No: changes wait days, in public"],
  ["Other contracts can check it", ["No", "bad"], ["No", "bad"], ["No", "bad"], "Yes (isBound)"],
  ["Works on the wallet you already have", ["No, their wallet", "bad"], ["Safe only", "mid"], ["Their account types", "mid"], "Safe, Kernel, Alchemy and others"],
  ["Rule format", ["Their JSON rules", "mid"], ["Their policies", "mid"], ["Fixed caveat types", "mid"], "Any TapeOut circuit"],
  ["Chains", ["Many", "good"], ["Many", "good"], ["Many", "good"], "X Layer today"],
];
const DOT: Record<Tone, string> = { good: "var(--allowed)", mid: "var(--warn)", bad: "var(--denied)", na: "var(--line)" };

function Compare({ label, cols, rows }: { label: string; cols: string[]; rows: Row[] }) {
  return (
    <div className="card beam scroll-x">
      <div className="gt" role="table" aria-label={label}>
        <div className="gt-row" role="row">
          <div className="hd" role="columnheader" />
          {cols.map((c) => (
            <div className="hd" role="columnheader" key={c}>
              {c}
            </div>
          ))}
          <div className="fgh" role="columnheader">
            Fengce
          </div>
        </div>
        {rows.map((r) => (
          <div className="gt-row" role="row" key={r[0]}>
            <div className="lb" role="rowheader">
              {r[0]}
            </div>
            {[r[1], r[2], r[3]].map(([t, tone], k) => (
              <div role="cell" key={k}>
                <span className="dot" style={{ background: DOT[tone] }} />
                <span>{t}</span>
              </div>
            ))}
            <div className="fg" role="cell">
              <span className="dot pop" style={{ background: "var(--allowed)" }} />
              <span>{r[4]}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Agents() {
  return (
    <section className="band">
      <div className="wrap3 col">
        <div className="lrv head-col">
          <span className="eyebrow">For AI agents</span>
          <h2 className="h2">When an AI agent goes wrong</h2>
        </div>
        <Compare label="AI agent failure scenarios compared" cols={AGENT_COLS} rows={AGENT_ROWS} />
      </div>
    </section>
  );
}

function Different() {
  return (
    <section className="band" id="compare">
      <div className="wrap3 col">
        <div className="lrv head-col" style={{ maxWidth: 840 }}>
          <span className="eyebrow">Compared</span>
          <h2 className="h2">Where Fengce is different</h2>
          <p className="lead">Others enforce rules too. Fengce is the one where the rule is a public circuit on-chain, binds the owners, and can't be changed quietly.</p>
        </div>
        <Compare label="Fengce compared with other enforcement tools" cols={DIFF_COLS} rows={DIFF_ROWS} />
        <div className="mono legend">
          <span>
            <i style={{ background: "var(--allowed)" }} /> holds
          </span>
          <span>
            <i style={{ background: "var(--warn)" }} /> depends
          </span>
          <span>
            <i style={{ background: "var(--denied)" }} /> fails
          </span>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- how it works

const STEPS = [
  ["01 · Choose", "Pick a circuit, set the numbers", "From the Catalog or your own TapeOut circuit."],
  ["02 · Pin", "The circuit is locked in", "It and every circuit it depends on are recorded on-chain."],
  ["03 · Attach", "One batch on your wallet", "No new wallet, no moving funds."],
  ["04 · Enforce", "Fail the circuit, it reverts", "Owners, modules, agents and permits are all checked. Rule changes wait days, in public."],
];

function How() {
  return (
    <section className="how-outer">
      <div className="how-sticky">
        <div className="wrap3 col how-col">
          <div className="head-col" style={{ maxWidth: 760 }}>
            <span className="eyebrow">How it works</span>
            <h2 className="h2">Pick a rule. Attach it. Every transaction is checked.</h2>
          </div>
          <div className="how-rail" aria-hidden="true">
            <div className="how-fill" />
            <div className="how-dot" />
          </div>
          <div className="how-grid">
            {STEPS.map(([e, t, d], k) => (
              <div className={`how-step hs${k + 1} card`} key={e}>
                <span className="eyebrow">{e}</span>
                <span className="step-t">{t}</span>
                <span className="step-d">{d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- any circuit

const CIRCUITS = [
  ["Approved recipients only", "Funds can only go to addresses on a pinned list."],
  ["No unlimited approvals", "Token approvals must stay under a set amount."],
  ["Swaps return to the wallet", "A swap's output must land back in this wallet, size capped."],
  ["Shared team budget", "One budget per period across several wallets and agents."],
  ["Company floor", "A company-wide cap teams can tighten, never loosen."],
  ["Your own circuit", "Design any TapeOut circuit, list it with test vectors, earn 80% of install fees."],
];

function AnyCircuit() {
  return (
    <section className="band">
      <div className="wrap3 col">
        <div className="lrv any-head">
          <div className="head-col">
            <span className="eyebrow">Any circuit</span>
            <h2 className="h2">
              Any circuit, <span className="word">not just spending limits</span>
            </h2>
          </div>
          <a className="link-accent" href={href("catalog")}>
            Browse the catalog
          </a>
        </div>
        <div className="circ-grid">
          {CIRCUITS.map(([t, d]) => (
            <div className="lrv card lift circ" key={t}>
              <svg width="56" height="24" viewBox="0 0 56 24" fill="none" aria-hidden="true">
                <path d="M0 8 H18 M0 16 H18" stroke="var(--muted)" strokeWidth="1.5" />
                <path d="M18 3 h10 a9 9 0 0 1 0 18 h-10 z" stroke="var(--accent)" strokeWidth="1.5" />
                <path className="flow" d="M37 12 H56" stroke="var(--accent)" strokeWidth="1.5" />
              </svg>
              <span className="circ-t">{t}</span>
              <span className="circ-d">{d}</span>
            </div>
          ))}
        </div>
        <div className="lrv next">
          <span className="mono accent" style={{ fontSize: 12 }}>
            NEXT · VERDICT
          </span>
          <span className="muted">Prediction markets that settle on a pinned TapeOut circuit, using the same engine.</span>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- wallet coverage

type Cov = "Full" | "Partial" | "Agent only";
/** Mock order; adapter and coverage follow docs/WALLETS.md (status Mainnet/Fork-tested = Full). */
const COVERAGE: [string, string, string, Cov][] = [
  ["safe", "Safe 1.5", "FengceGuard (transaction + module guard)", "Full"],
  ["kernel", "Kernel (ERC-7579)", "FengceHook, timelocked validator changes", "Full"],
  ["mav2", "Alchemy Modular Account v2", "FengceHook6900", "Full"],
  ["safe7579", "Safe7579", "FengceHook", "Partial"],
  ["nexus", "Biconomy Nexus", "FengceHook", "Partial"],
  ["etherspot", "Etherspot", "FengceHook", "Partial"],
  ["coinbase", "Coinbase Smart Wallet", "FengceAgentOwner", "Agent only"],
  ["7702", "EIP-7702 wallets (SemiModularAccount7702)", "FengceHook6900", "Agent only"],
];
const COV_TONE: Record<Cov, string> = { Full: "var(--allowed)", Partial: "var(--muted)", "Agent only": "var(--accent)" };

function Wallets() {
  return (
    <section className="band" id="wallets">
      <div className="wrap3 col">
        <div className="lrv head-col">
          <span className="eyebrow">Wallet coverage</span>
          <h2 className="h2">Works on the wallet you already have</h2>
        </div>
        <div className="card scroll-x">
          <div className="wt" role="table" aria-label="Wallet coverage">
            <div className="gt-row" role="row">
              <div className="hd" role="columnheader">Wallet</div>
              <div className="hd" role="columnheader">How</div>
              <div className="hd" role="columnheader">Coverage</div>
            </div>
            {COVERAGE.map(([k, w, how, c]) => (
              <div className="gt-row" role="row" key={k}>
                <div className="lb lrvl" role="rowheader">{w}</div>
                <div className="lrvl" role="cell">{how}</div>
                <div className="lrvl" role="cell">
                  <span className="mono badge-c" style={{ color: COV_TONE[c], borderColor: COV_TONE[c] }}>
                    {c}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- developers

function Developers() {
  return (
    <section className="band" id="developers">
      <div className="wrap3 dev">
        <div className="lrv dev-text">
          <span className="eyebrow">Developers</span>
          <h2 className="h2">Check before signing. Verify on-chain.</h2>
          <p className="lead">Preflight a transaction from your app or agent, let agents ask Fengce through MCP, or accept only bound accounts in your contract.</p>
          <div className="dev-tags">
            <Ext to="https://www.npmjs.com/package/@fengce/sdk" className="mono lift tag">@fengce/sdk</Ext>
            <Ext to={LINKS.api} className="mono lift tag">REST API</Ext>
            <Ext to={`${LINKS.repo}/tree/main/mcp`} className="mono lift tag">MCP server</Ext>
            <Ext to={`${LINKS.repo}/tree/main/src/binding`} className="mono lift tag">isBound</Ext>
          </div>
        </div>
        <div className="lrv mono term">
          <div className="term-bar">
            <span />
            <span />
            <span />
          </div>
          <div className="term-body">
            <span>
              <span className="accent">$ </span>
              <span className="type" style={v({ "--n": 17, animationRange: "entry 20% entry 50%" })}>npm i @fengce/sdk</span>
            </span>
            <span>
              <span className="accent">&gt; </span>
              <span className="type" style={v({ "--n": 39, animationRange: "entry 50% entry 80%" })}>await preSign(client, policy, safe, tx)</span>
            </span>
            <span className="tres" style={{ color: "var(--denied)" }}>
              {"  "}"deny" · 1.5 USDT0 over the 1 USDT0 cap
            </span>
            <span className="muted" style={{ marginTop: 10 }}>
              // in your contract
            </span>
            <span className="type" style={v({ "--n": 49, animationRange: "entry 100% cover 25%" })}>require(binding.isBound(msg.sender, POLICY, 1 days));</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Landing() {
  return (
    <>
      <Hero />
      <Ticker />
      <TryRule />
      <Incidents />
      <Agents />
      <Different />
      <How />
      <AnyCircuit />
      <Wallets />
      <Developers />
    </>
  );
}

mount("", 0, <Landing />, { landing: true });
