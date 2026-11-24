import { useEffect, useState, type ReactNode } from "react";
import { DEPLOYMENT, EXPLORER } from "../lib/chain";
import { catalog } from "../lib/data";
import type { Snapshot } from "../lib/events";
import { PRESETS } from "../lib/policies";
import { quoteFor } from "../lib/quotes";
import { WALLETS } from "../lib/wallets";
import { DEWEB, RELEASE, fmtInt, href, loadSnapshot, mount, short } from "../ui/kit";
import { Count, Words, useLandingMotion } from "../ui/motion";
import "../landing.css";

/** Tests passing in CI for the release commit (docs/claims.json "tests-112": 44 unit, 53 core and Safe fork, 15 wallet fork). */
const TESTS_PASSING = 112;
/** The v2 demo: the agent's two transfers (amounts are not in the events; the transactions are read from the snapshot). */
const DEMO = { cap: "1 USDT0", denied: "1.5 USDT0", allowed: "0.5 USDT0" };
const CONTRACTS = Object.keys(DEPLOYMENT.contracts).length;
const WALLET_TYPES = WALLETS.filter((w) => w.tests !== "none").length;
const NAND2_CLOSURE = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";

const tx = (h: string) => `${EXPLORER}/tx/${h}`;

function useDemo() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  useEffect(() => {
    loadSnapshot().then(setSnap);
  }, []);
  const denied = snap?.events.find((e) => e.event === "Denied" && e.safe?.toLowerCase() === DEPLOYMENT.demoSafe.toLowerCase());
  const allowed = snap?.events.find((e) => e.event === "AgentExecuted" && e.safe?.toLowerCase() === DEPLOYMENT.demoSafe.toLowerCase());
  const listed = snap ? snap.events.filter((e) => e.event === "Listed").length : PRESETS.length;
  return { denied: denied?.tx ?? null, allowed: allowed?.tx ?? null, listed };
}

// ---------------------------------------------------------------- hero

function HeroCircuit() {
  return (
    <svg className="hero-circuit" viewBox="0 0 1440 760" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
      <g stroke="var(--accent)" strokeWidth="1.6">
        <path className="flow" d="M0 140 H260 V300 H420" />
        <path className="flow" d="M0 420 H180 V340 H420" />
        <path d="M420 280 h46 a40 40 0 0 1 0 80 h-46 z" />
        <circle cx="514" cy="320" r="7" />
        <path className="flow" d="M521 320 H700 V220 H860" />
        <path className="flow" d="M600 520 H760 V260 H860" />
        <path d="M860 200 h46 a40 40 0 0 1 0 80 h-46 z" />
        <circle cx="954" cy="240" r="7" />
        <path className="flow" d="M961 240 H1440" />
        <path className="flow" d="M960 560 H1200 V420 H1440" />
        <path d="M1040 520 h46 a40 40 0 0 1 0 80 h-46 z" />
        <path className="flow" d="M780 640 H1040 V580" />
        <path className="flow" d="M1100 80 V200 H1240" />
      </g>
      <g fill="var(--accent)" fontFamily="Source Code Pro, monospace" fontSize="14">
        <text x="40" y="128">in: amount = {DEMO.denied}</text>
        <text x="40" y="408">in: cap = {DEMO.cap}</text>
        <text x="980" y="228">out: 0 → DENIED</text>
        <text x="1000" y="548">pinned · closure {short(NAND2_CLOSURE)}</text>
        <text x="560" y="508">NAND #2 · X Layer</text>
      </g>
    </svg>
  );
}

function Hero() {
  return (
    <section className="hero" data-spotlight>
      <div className="spot-layer" aria-hidden="true">
        <HeroCircuit />
      </div>
      <div className="chips para" aria-hidden="true">
        <span className="chip-float" style={{ left: "7%", top: "22%", animationDelay: "-1s" }}>
          <span className="chip denied">DENIED · 1.5</span>
        </span>
        <span className="chip-float" style={{ right: "8%", top: "18%", animationDelay: "-3s" }}>
          <span className="chip allowed">ALLOWED · 0.5</span>
        </span>
        <span className="chip-float" style={{ left: "12%", bottom: "20%", animationDelay: "-2s" }}>
          <span className="chip plain">isBound ✓</span>
        </span>
        <span className="chip-float" style={{ right: "11%", bottom: "24%", animationDelay: "-4s" }}>
          <span className="chip plain">cap · {DEMO.cap}</span>
        </span>
      </div>
      <div className="hero-inner">
        <span className="badge w-load" style={{ ["--d" as string]: "50ms" }}>
          <span className="pulse-dot">●</span> Live on X Layer mainnet · built on TapeOut
        </span>
        <h1 className="hero-title">
          <Words text="Set the rules." onLoad start={100} />{" "}
          <span className="accent">
            <Words text="Your wallet enforces them." onLoad start={380} />
          </span>
        </h1>
        <p className="hero-sub w-load" style={{ ["--d" as string]: "700ms" }}>
          Every transaction, from you or your AI agent, is checked against a TapeOut circuit on X Layer. Break the rule and it doesn't go through.
        </p>
        <div className="hero-cta w-load" style={{ ["--d" as string]: "850ms" }}>
          <a className="btn btn-lg" href={href("install")}>
            Protect a wallet
          </a>
          <a className="btn btn-lg btn-secondary" href={href("safe")}>
            See it on mainnet
          </a>
        </div>
        <span className="hero-hint w-load" style={{ ["--d" as string]: "1100ms" }}>
          Move your cursor over this area to see the circuit underneath
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- marquee

function Marquee({ demo }: { demo: ReturnType<typeof useDemo> }) {
  const items: ReactNode[] = [
    <>
      <span className="denied-text">DENIED</span> {DEMO.denied} · agent · {demo.denied ? short(demo.denied) : "…"}
    </>,
    <>
      <span className="allowed-text">ALLOWED</span> {DEMO.allowed} · agent · {demo.allowed ? short(demo.allowed) : "…"}
    </>,
    <>
      {CONTRACTS}/{CONTRACTS} contracts verified on Sourcify
    </>,
    <>Hosted on TapeOut · {DEWEB.name}</>,
    <>
      {demo.listed} policies listed · {RELEASE} · X Layer 196
    </>,
    <>isBound · 1 day minimum notice</>,
  ];
  return (
    <div className="marquee" aria-label="Live mainnet activity">
      <div className="marquee-track">
        {[0, 1].map((k) => (
          <div className="marquee-set" key={k} aria-hidden={k === 1 ? true : undefined}>
            {items.map((it, i) => (
              <span key={i}>{it}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- proof

function Proof({ demo }: { demo: ReturnType<typeof useDemo> }) {
  return (
    <section className="band proof-band">
      <div className="proof scale-in" data-replay>
        <div className="proof-well">
          <div className="proof-head mono">
            <span>
              Demo Safe {short(DEPLOYMENT.demoSafe)} · X Layer mainnet
            </span>
            <span>Rule: no payment over {DEMO.cap}</span>
          </div>
          <div className="proof-row rv">
            <span className="proof-what">AI agent sends {DEMO.denied}</span>
            <span className="proof-right">
              {demo.denied ? (
                <a className="mono muted" href={tx(demo.denied)} target="_blank" rel="noreferrer noopener">
                  {short(demo.denied)}
                </a>
              ) : (
                <span className="mono muted">…</span>
              )}
              <span className="chip denied replay-chip">DENIED</span>
            </span>
          </div>
          <div className="proof-row rv">
            <span className="proof-what">AI agent sends {DEMO.allowed}</span>
            <span className="proof-right">
              {demo.allowed ? (
                <a className="mono muted" href={tx(demo.allowed)} target="_blank" rel="noreferrer noopener">
                  {short(demo.allowed)}
                </a>
              ) : (
                <span className="mono muted">…</span>
              )}
              <span className="chip allowed replay-chip">ALLOWED</span>
            </span>
          </div>
          <div className="proof-note">The denied transfer reverted inside the wallet. No funds moved.</div>
        </div>
      </div>
      <div className="stats">
        <div className="stat rv">
          <span className="stat-v">{RELEASE}</span>
          <span className="stat-k">live on X Layer</span>
        </div>
        <div className="stat rv">
          <span className="stat-v">
            <Count to={CONTRACTS} />/{CONTRACTS}
          </span>
          <span className="stat-k">verified on Sourcify</span>
        </div>
        <div className="stat rv">
          <span className="stat-v">
            <Count to={TESTS_PASSING} />
          </span>
          <span className="stat-k">tests passing</span>
        </div>
        <div className="stat rv">
          <span className="stat-v">
            <Count to={WALLET_TYPES} />
          </span>
          <span className="stat-k">wallet types</span>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- what others can't do

const CARDS = [
  ["01", "The owners are bound too", "Session keys and role modules only limit a delegate. With Fengce, the rule covers everyone, owners included."],
  ["02", "It reverts, not warns", "Pre-sign checkers advise. Fengce sits in the wallet's own execution path, so a failing transaction never happens."],
  ["03", "Other contracts can check it", "One call, isBound, lets a vault or lender confirm your wallet is bound to a rule that can't change without notice."],
];
const TABLE: [string, string, string, string, string][] = [
  ["Binds the owners too", "No", "No", "No", "Yes"],
  ["Wallet enforces it when the transaction runs", "Yes", "Depends on their signer", "No, warns only", "Yes, reverts"],
  ["Rule can't be swapped quietly", "No", "Lives off-chain", "n/a", "Yes, timelocked"],
  ["Other contracts can verify it", "No", "No", "No", "Yes, isBound"],
  ["Rule is a TapeOut circuit", "No", "No", "No", "Yes"],
];

function Others() {
  return (
    <section className="band">
      <div className="container stack-center">
        <h2 className="h2 center">
          <Words text="What others can't do" />
        </h2>
        <div className="fan">
          {CARDS.map(([n, t, d], i) => (
            <div key={n} className={`card fan-${["l", "c", "r"][i]}${i === 1 ? " card-accent" : ""}`}>
              <span className="label-mono">{n}</span>
              <span className="card-title">{t}</span>
              <span className="card-text">{d}</span>
            </div>
          ))}
        </div>
        <div className="table-box rv">
          <table className="compare">
            <thead>
              <tr>
                <th />
                <th>Session keys / role modules</th>
                <th>Off-chain policy engines</th>
                <th>Pre-sign checkers</th>
                <th className="accent">Fengce</th>
              </tr>
            </thead>
            <tbody>
              {TABLE.map((r) => (
                <tr key={r[0]} className="rv">
                  <td>{r[0]}</td>
                  <td className="muted">{r[1]}</td>
                  <td className="muted">{r[2]}</td>
                  <td className="muted">{r[3]}</td>
                  <td className="sweep">{r[4]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- how it works

const STEPS = [
  ["01 · Choose", "Pick a policy, set the numbers", "From the Catalog or your own TapeOut circuit. For example: no payment over 100 USDT, 1,000 per day."],
  ["02 · Pin", "The circuit is locked in", "The circuit and every circuit it depends on are recorded on-chain. Change any of them and the rule stops matching."],
  ["03 · Attach", "One batch on your existing wallet", "No new wallet, no moving funds. Works with Safe, Kernel, Modular Account and more."],
  ["04 · Enforce", "Fail the circuit, the transaction reverts", "Owners, modules, agents and signed permits are all checked. Changing the rule takes days, in public."],
];

function How() {
  return (
    <section className="band" id="how">
      <div className="container how">
        <div className="how-left">
          <span className="label-mono">How it works</span>
          <h2 className="h2">
            <Words text="Pick a rule. Attach it. Every transaction is checked." />
          </h2>
          <svg className="draw" width="100%" height="120" viewBox="0 0 420 120" fill="none" aria-hidden="true">
            <path d="M0 60 H90" stroke="var(--accent)" strokeWidth="2" pathLength={1} />
            <path d="M90 30 h40 a30 30 0 0 1 0 60 h-40 z" stroke="var(--accent)" strokeWidth="2" pathLength={1} />
            <path d="M166 60 H260" stroke="var(--accent)" strokeWidth="2" pathLength={1} />
            <path d="M260 30 h40 a30 30 0 0 1 0 60 h-40 z" stroke="var(--accent)" strokeWidth="2" pathLength={1} />
            <path d="M336 60 H420" stroke="var(--accent)" strokeWidth="2" pathLength={1} />
          </svg>
        </div>
        <div className="how-steps">
          {STEPS.map(([l, t, d]) => (
            <div key={l} className="card rv">
              <span className="label-mono">{l}</span>
              <span className="card-title">{t}</span>
              <span className="card-text">{d}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- policies

interface PolicyCard {
  key: string;
  name: string;
  description: string;
  tier: string;
  gas: number | null;
  gasLabel: string;
  installs: number | null;
  processor: string;
  id: string;
}

const GREEN_LIMIT = 1_000_000;

/** Local data first (presets and Quote certificates), then the live Catalog replaces it. */
function initialCards(): PolicyCard[] {
  return PRESETS.map((p) => {
    const q = quoteFor(p.processor, p.id);
    const full = q?.fullPath ? Number(q.fullPath) : null;
    return {
      key: p.key,
      name: p.name,
      description: p.description,
      tier: p.stateful ? "Stateful" : (q?.tier ?? "Green"),
      gas: full,
      gasLabel: full ? `${fmtInt(full)} gas` : "stateful",
      installs: null,
      processor: p.processor,
      id: p.id.toString(),
    };
  });
}

function Policies() {
  const [cards, setCards] = useState<PolicyCard[]>(initialCards);
  useEffect(() => {
    let alive = true;
    loadSnapshot()
      .then((s) => catalog(s))
      .then((c: any) => {
        if (!alive || !c?.entries) return;
        setCards(
          c.entries.map((e: any) => {
            const p = PRESETS.find((x) => x.processor.toLowerCase() === e.processor.toLowerCase() && x.id.toString() === e.circuitId);
            const full = e.fullPathGas ? Number(e.fullPathGas) : null;
            const gas = full ?? Number(e.measuredGas);
            return {
              key: e.pinId,
              name: e.name ?? `#${e.circuitId}`,
              description: p?.description ?? e.description,
              tier: p?.stateful ? "Stateful" : e.tier,
              gas,
              gasLabel: full ? `${fmtInt(full)} gas` : `${fmtInt(e.measuredGas)} eval gas`,
              installs: e.installs,
              processor: e.processor,
              id: e.circuitId,
            };
          }),
        );
      })
      .catch(() => {
        /* keep the local cards */
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <section className="band">
      <div className="container stack">
        <div className="row-between">
          <h2 className="h2">
            <Words text="Ready-made policies" />
          </h2>
          <a className="link-accent" href={href("catalog")}>
            Browse the catalog
          </a>
        </div>
        <div className="grid3">
          {cards.map((c) => (
            <a key={c.key} className="card policy-card rv" href={href("policy", { processor: c.processor, id: c.id })}>
              <div className="row-between">
                <span className="policy-name">{c.name}</span>
                <span className={`tier ${c.tier === "Green" ? "green" : "other"}`}>{c.tier}</span>
              </div>
              <span className="card-text small">{c.description}</span>
              <div className="gasbar">
                <div className="gasbar-fill bar" style={{ width: `${c.gas ? Math.max(2, Math.min(100, (c.gas / GREEN_LIMIT) * 100)) : 0}%` }} />
              </div>
              <span className="mono muted small">
                {c.gasLabel}
                {c.installs !== null ? ` · ${c.installs} install${c.installs === 1 ? "" : "s"}` : ""}
              </span>
            </a>
          ))}
          <div className="card card-dashed rv">
            <span className="policy-name">Bring your own circuit</span>
            <span className="card-text small">List it with test vectors and earn 80% of install fees.</span>
          </div>
        </div>
        <span className="mono muted small">
          Bars show full Safe path gas against the 1M Green limit. Full Safe path = Safe overhead + pre-check + outcome check.
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- developers, closing

function Developers() {
  return (
    <section className="band" id="developers">
      <div className="container dev">
        <div className="dev-text rv">
          <h2 className="h2">
            <Words text="For developers and agents" />
          </h2>
          <p className="lead-muted">Check a transaction before signing, let AI agents ask Fengce through MCP, or accept only bound accounts in your contract.</p>
          <div className="tags">
            {["SDK", "REST API", "MCP server", "isBound"].map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        </div>
        <pre className="code rv">{`const d = await fengce.preSign(tx)   // ALLOWED | DENIED

require(
  binding.isBound(msg.sender, POLICY_HASH, 1 days),
  "account not bound"
);`}</pre>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="closing expand">
      <div className="closing-inner">
        <h2 className="closing-title rv">Give your agent a wallet it can't empty.</h2>
        <a className="btn btn-lg btn-inverse rv" href={href("install")}>
          Protect a wallet
        </a>
      </div>
    </section>
  );
}

function Landing() {
  const demo = useDemo();
  useLandingMotion();
  return (
    <>
      <Hero />
      <Marquee demo={demo} />
      <Proof demo={demo} />
      <Others />
      <How />
      <Policies />
      <Developers />
      <Closing />
    </>
  );
}

mount("", 0, <Landing />, { landing: true });
