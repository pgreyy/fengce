import { useEffect, useRef, useState } from "react";
import { PRODUCT_NAME } from "../brand";
import { CodeCard, href, mount } from "../okun/ui";

/** The max-per-buy circuit as a TapeOut name: circuit . area (2 = X Layer) . processor number. */
export const NEEDLE = "2.2.0";
const still = () => typeof navigator !== "undefined" && (navigator.webdriver || matchMedia("(prefers-reduced-motion: reduce)").matches);

/** 0..1 progress of a tall section scrolled past its sticky inner area. */
function useScrollProgress(ref: React.RefObject<HTMLElement | null>) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const total = Math.max(1, r.height - innerHeight);
        setP(Math.round(Math.max(0, Math.min(1, -r.top / total)) * 1000) / 1000);
      });
    };
    on();
    addEventListener("scroll", on, { passive: true });
    addEventListener("resize", on);
    return () => (removeEventListener("scroll", on), removeEventListener("resize", on), cancelAnimationFrame(raf));
  }, [ref]);
  return p;
}

// ------------------------------------------------------------------ vinyl groove band
function Grooves() {
  const rows = 7;
  const groove = (i: number) => {
    const y = 14 + i * 19;
    return `M-40 ${y} C 300 ${y - 18}, 700 ${y + 22}, 1060 ${y + 2} S 1500 ${y - 10}, 1640 ${y}`;
  };
  const dots = [...Array(18).keys()].map((k) => {
    const row = k % rows;
    const deny = [2, 7, 11, 15].includes(k);
    const dur = 7 + ((k * 37) % 6);
    return { row, deny, dur, begin: -((k * 1.3) % dur) };
  });
  return (
    <div aria-hidden="true" style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", overflow: "hidden", height: 150, position: "relative" }}>
      <svg viewBox="0 0 1600 150" preserveAspectRatio="xMidYMid slice" width="100%" height="150" style={{ display: "block", position: "absolute", inset: 0 }}>
        {[...Array(rows).keys()].map((i) => (
          <path key={i} id={`g${i}`} d={groove(i)} stroke="var(--line)" strokeWidth="1" fill="none" />
        ))}
        {dots.map((d, k) => (
          <circle key={k} r="3" fill={d.deny ? "var(--deny)" : "var(--allow)"} opacity="0">
            {/* the needle sits at about 67% of the path: denied dots flash and fade there */}
            <animateMotion dur={`${d.dur}s`} begin={`${d.begin}s`} repeatCount="indefinite">
              <mpath href={`#g${d.row}`} />
            </animateMotion>
            <animate attributeName="opacity" dur={`${d.dur}s`} begin={`${d.begin}s`} repeatCount="indefinite" values={d.deny ? "0;.9;.9;1;0;0" : "0;.9;.9;.9;.9;0"} keyTimes="0;0.04;0.64;0.67;0.72;1" />
            {d.deny && <animate attributeName="r" dur={`${d.dur}s`} begin={`${d.begin}s`} repeatCount="indefinite" values="3;3;6;3;3" keyTimes="0;0.64;0.67;0.72;1" />}
          </circle>
        ))}
        <path d="M1300 -40 L1072 92" stroke="var(--text)" strokeWidth="2" opacity=".75" />
        <path d="M1300 -40 L1072 92" stroke="var(--accent)" strokeWidth="5" opacity=".18" />
        <circle cx="1300" cy="-40" r="22" fill="var(--panel)" stroke="var(--line)" />
        <rect x="1056" y="84" width="30" height="14" rx="2" fill="var(--accent)" transform="rotate(-30 1071 91)" />
      </svg>
      <div className="sheen" />
      <div style={{ position: "absolute", left: "66.5%", top: 0, bottom: 0, width: 120, transform: "translateX(-60px)", background: "radial-gradient(50% 50% at 50% 60%, rgba(240,83,63,.14), transparent 70%)", pointerEvents: "none" }} />
      <span className="lbl" style={{ position: "absolute", left: 24, bottom: 10 }}>Each groove is a wallet · each dot a transaction</span>
      <span className="lbl" style={{ position: "absolute", left: "calc(66.5% + 30px)", top: 12, color: "var(--accent)" }}>The needle is the circuit · {NEEDLE}</span>
      <span className="lbl" style={{ position: "absolute", right: 24, bottom: 10 }}>
        <span className="allow">●</span> plays through &nbsp; <span className="deny">●</span> skips · reverted
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ isometric building model (prototype geometry)
const S = 15, OX = 262, OY = 250;
const iso = (x: number, y: number, z: number): [number, number] => [OX + (x - y) * 0.866 * S, OY + (x + y) * 0.5 * S - z * S];
const poly = (pts: [number, number, number][]) => "M" + pts.map((q) => iso(...q).map((v) => v.toFixed(1)).join(" ")).join(" L") + " Z";
const BLOCKS = [
  { id: 3, x: 0, y: 0, w: 19, d: 13, z: 0, h: 0.7 }, // X Layer slab
  { id: 0, x: 1, y: 6, w: 6.5, d: 6, z: 0.7, h: 2.8 }, // Safe, floor 1
  { id: 0, x: 1, y: 6, w: 6.5, d: 6, z: 3.7, h: 2.8 }, // Safe, floor 2
  { id: 1, x: 8, y: 5, w: 4, d: 4, z: 0.7, h: 3.4 }, // limits
  { id: 1, x: 8.6, y: 5.6, w: 2.8, d: 2.8, z: 4.1, h: 1.6 },
  { id: 2, x: 13, y: 1, w: 4.6, d: 5.4, z: 0.7, h: 4.8 }, // circuit tower
  { id: 2, x: 13, y: 1, w: 4.6, d: 5.4, z: 5.7, h: 5.6 },
];
const ISO_GRID = (() => {
  let g = "";
  for (let k = -6; k <= 26; k += 2) {
    const [a1, a2, b1, b2] = [iso(k, -8, 0), iso(k, 26, 0), iso(-8, k, 0), iso(26, k, 0)];
    g += `M${a1[0].toFixed(1)} ${a1[1].toFixed(1)} L${a2[0].toFixed(1)} ${a2[1].toFixed(1)} M${b1[0].toFixed(1)} ${b1[1].toFixed(1)} L${b2[0].toFixed(1)} ${b2[1].toFixed(1)} `;
  }
  return g;
})();
const ANCHORS = [iso(4.25, 9, 6.5), iso(10, 7, 5.7), iso(15.3, 3.7, 11.3), iso(19, 0, 0.7)];
const LABELS = ["YOUR SAFE · 2 FLOORS", "2 LIMITS", "CIRCUITS · PINNED", "X LAYER 196"];
const TAGS = [iso(4, 14.6, 0), iso(10, 14.6, 0), iso(15.5, 14.6, 0), iso(18.5, 9, 0)];
const INFO = [
  ["01", "1 owner · nothing moves", "Works with Safe today,", "7579 and 6900 through Fengce"],
  ["02", "2 limits · changes wait 1 day", "Max per buy and", "trades per clock hour"],
  ["03", "pinned on X Layer", "Taped out on TapeOut,", "re-run by anyone"],
  ["04", "chain 196", "Every change public,", "verified on Sourcify"],
];
const LY = 104;

function IsoModel({ active }: { active: number }) {
  const faces: { d: string; fill: string; stroke: string; sw: number }[] = [];
  let hatch = "";
  [...BLOCKS]
    .sort((p, q) => p.x + p.y + p.z * 0.01 - (q.x + q.y + q.z * 0.01))
    .forEach((b) => {
      const on = b.id === active;
      const { x, y, w, d, z, h } = b;
      const st = on ? "var(--accent)" : "var(--text)";
      const sw = on ? 1.3 : 1;
      faces.push({ d: poly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]]), fill: on ? "rgba(240,83,63,.06)" : "var(--panel)", stroke: st, sw });
      faces.push({ d: poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]]), fill: on ? "rgba(240,83,63,.14)" : "var(--panel)", stroke: st, sw });
      faces.push({ d: poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]]), fill: on ? "rgba(240,83,63,.10)" : "var(--panel)", stroke: st, sw });
      const lines = on ? Math.max(3, Math.round(h * 2.4)) : 0;
      for (let li = 1; li < lines; li++) {
        const zz = z + (h * li) / lines;
        const [p1, p2, p3] = [iso(x, y + d, zz), iso(x + w, y + d, zz), iso(x + w, y, zz)];
        hatch += `M${p1[0].toFixed(1)} ${p1[1].toFixed(1)} L${p2[0].toFixed(1)} ${p2[1].toFixed(1)} L${p3[0].toFixed(1)} ${p3[1].toFixed(1)} `;
      }
      if (on && b.id === 3) {
        for (let hx = 1; hx < 19; hx++) {
          const [q1, q2] = [iso(hx, 13, 0), iso(hx, 13, 0.7)];
          hatch += `M${q1[0].toFixed(1)} ${q1[1].toFixed(1)} L${q2[0].toFixed(1)} ${q2[1].toFixed(1)} `;
        }
      }
    });
  const a = ANCHORS[active];
  const lr = a[0] > 470 ? -1 : 1; // flip the label left near the right edge
  const lead = `M${a[0].toFixed(1)} ${a[1].toFixed(1)} V${LY} H${(a[0] + 36 * lr).toFixed(1)}`;
  const info = INFO[active];
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 600, aspectRatio: "0.86", maxHeight: "calc(100vh - var(--headH) - 48px)" }}>
      <svg viewBox="0 0 600 700" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0 }} role="img" aria-label="Isometric model of your Safe, limits, circuit and X Layer, with the current layer highlighted">
        <path d={ISO_GRID} stroke="var(--line)" strokeWidth="1" fill="none" opacity=".9" />
        {faces.map((f, k) => (
          <path key={k} d={f.d} fill={f.fill} stroke={f.stroke} strokeWidth={f.sw} style={{ transition: "fill .5s, stroke .5s" }} />
        ))}
        <path d={hatch} stroke="var(--accent)" strokeWidth=".8" fill="none" opacity=".85" />
        <path d={lead} stroke="var(--text)" strokeWidth="1" fill="none" opacity=".8" />
        <circle cx={a[0]} cy={a[1]} r="3" fill="var(--accent)" />
      </svg>
      <span style={{ position: "absolute", ...(lr > 0 ? { left: `${((a[0] + 44) / 6).toFixed(2)}%` } : { right: `${((600 - a[0] + 44) / 6).toFixed(2)}%` }), top: `${((LY - 9) / 7).toFixed(2)}%`, fontSize: 13.75, fontWeight: 500, letterSpacing: ".04em", whiteSpace: "nowrap", transition: "left .5s, top .5s" }}>
        {LABELS[active]}
      </span>
      {TAGS.map((t, i) => {
        const on = i === active;
        return (
          <span key={i} className="mono" style={{ position: "absolute", left: `calc(${(t[0] / 6).toFixed(2)}% - 12px)`, top: `${((t[1] - 4) / 7).toFixed(2)}%`, width: 24, height: 24, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13.75, background: on ? "var(--accent)" : "var(--panel)", border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`, color: on ? "#fff" : "var(--muted)" }}>
            {i + 1}
          </span>
        );
      })}
      <div style={{ position: "absolute", left: 26, bottom: 24, display: "flex", flexDirection: "column", gap: 2, pointerEvents: "none" }}>
        <span style={{ fontSize: 16 }}>Layer</span>
        <span className="num" style={{ fontWeight: 300, fontSize: 77, lineHeight: 1 }}>{info[0]}</span>
        <span className="small" style={{ marginTop: 10 }}>{info[1]}</span>
      </div>
      <div style={{ position: "absolute", right: 26, bottom: 24, display: "flex", flexDirection: "column", alignItems: "flex-end", pointerEvents: "none" }}>
        <span className="small">{info[2]}</span>
        <span className="small">{info[3]}</span>
      </div>
    </div>
  );
}

const STEPS = [
  { kicker: "Your wallet", title: "Keep it", body: "The Safe you already use. Nothing moves, and your keys stay yours.", cta: null },
  { kicker: "Your limits", title: "Choose", body: "Max per buy and trades per hour today. Quiet hours and hold locks next. Your numbers.", cta: "Set my limits" },
  { kicker: "The circuit", title: "Enforce", body: "Each limit is a TapeOut circuit, pinned on X Layer. The wallet obeys its answer.", cta: "See the circuit" },
  { kicker: "X Layer", title: "Prove", body: "Every block and every change is public. Loosening waits 1 day.", cta: "How Fengce works" },
];

function Steps() {
  const ref = useRef<HTMLElement>(null);
  const p = useScrollProgress(ref);
  const active = Math.min(3, Math.floor(p * 4));
  const ctaHref = [null, href("start"), href("fengce", { tab: "judges" }), href("fengce")][active];
  return (
    <section ref={ref} className="steps-sec" style={{ borderTop: "1px solid var(--line)", height: "340vh", position: "relative" }}>
      <div className="steps-in" style={{ position: "sticky", top: "var(--headH)", height: "calc(100vh - var(--headH))", maxWidth: 1340, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <div style={{ padding: "0 48px", display: "flex", flexDirection: "column", justifyContent: "center", borderRight: "1px solid var(--line)" }}>
          <div style={{ position: "relative" }}>
            <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 22, bottom: 22, width: 1, background: "var(--line)" }}>
              <div style={{ width: 1, height: `${Math.min(100, p * 100)}%`, background: "var(--accent)" }} />
            </div>
            {STEPS.map((s, i) => {
              const on = i === active;
              return (
                <button
                  key={s.kicker}
                  type="button"
                  onClick={() => {
                    const el = ref.current;
                    if (!el) return;
                    const r = el.getBoundingClientRect();
                    scrollTo({ top: scrollY + r.top + ((i + 0.5) / 4) * Math.max(1, r.height - innerHeight), behavior: "smooth" });
                  }}
                  style={{ position: "relative", display: "flex", flexDirection: "column", gap: 10, textAlign: "left", background: "none", border: 0, padding: "18px 0 18px 26px", width: "100%" }}
                >
                  <span style={{ position: "absolute", left: -4, top: 23, width: 9, height: 9, borderRadius: 999, background: on ? "var(--accent)" : "var(--bg)", border: `1px solid ${on ? "var(--accent)" : "var(--line)"}` }} />
                  <span className="lbl" style={{ color: on ? "var(--text)" : "var(--muted)" }}>{String(i + 1).padStart(2, "0")} &nbsp;{s.kicker}</span>
                  {on && (
                    <>
                      <span className="disp" style={{ fontSize: 34 }}>{s.title}</span>
                      <span className="body" style={{ maxWidth: 340 }}>{s.body}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <div style={{ paddingLeft: 26, marginTop: 18, minHeight: 34 }}>
            {STEPS[active].cta && ctaHref && <a className="pill accent" href={ctaHref}>{STEPS[active].cta}</a>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <IsoModel active={active} />
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ who it helps
const USES = [
  {
    title: "Traders",
    body: "Cap your buys and limit trades per hour on your own wallet.",
    f: ["Follows your wallet across supported apps and transaction paths", "Raising a limit waits 1 day", "Optional partner approval, coming soon"],
    go: href("limits"),
    card: { h1: "YOUR SAFE", h2: "0x0BB9…0707", tag: "LIMITS ACTIVE", k0: "Max per buy", big: "50 USDT0", a1: "Per hour", b1: "5", a2: "Changes", b2: "wait 1 day", rows: [["Buy", "Uniswap", "+45.00", true], ["Buy", "Uniswap", "BLOCKED", false], ["Approve", "over cap", "BLOCKED", false], ["Buy", "Uniswap", "+12.50", true]] as [string, string, string, boolean][] },
    apiTitle: "limits",
    api: '{\n  "safe": "0x0bb9…0707",\n  "maxPerBuy": "50 USDT0",\n  "tradesPerHour": 5,\n  "changeDelay": "1 day"\n}',
  },
  {
    title: "AI agents",
    body: "Give your agent a wallet it can't overspend, even if it's tricked or buggy. The agent signs; the wallet decides.",
    f: ["Per-agent caps, next engine release", "Agents check before signing (MCP, SDK)", "An agent can never loosen its own limits"],
    go: href("fengce", { tab: "agents" }),
    card: { h1: "AGENT", h2: "AGENTEXECUTOR", tag: "BOUND", k0: "Limit", big: "1 USDT0", a1: "Checks", b1: "every call", a2: "Loosen", b2: "owners only", rows: [["Pay", "0.5 USDT0", "ALLOWED", true], ["Pay", "1.5 USDT0", "DENIED", false]] as [string, string, string, boolean][] },
    apiTitle: "mcp",
    api: '{\n  "tool": "preflight_transaction",\n  "enforced": true,\n  "decision": "deny",\n  "reason": "FengceDenied(…)"\n}',
  },
  {
    title: "Shared wallets",
    body: "Teams, couples and clubs on one Safe. Every owner keeps the same limits, and loosening needs the Safe's own approvals plus a public wait.",
    f: ["Works with your existing Safe threshold", "Loosening waits 1 day, visible to every owner", "Every scheduled change is an on-chain event"],
    go: href("wallet"),
    card: { h1: "TEAM SAFE", h2: "2 OF 3 OWNERS", tag: "LIMITS ACTIVE", k0: "Max per payment", big: "2,000 USDT0", a1: "Owners", b1: "3", a2: "Pending", b2: "1", rows: [["Pay", "payroll", "-1,200.00", true], ["Pay", "over cap", "BLOCKED", false], ["Raise cap", "scheduled", "23:59 left", true]] as [string, string, string, boolean][] },
    apiTitle: "change",
    api: '{\n  "change": "raise max per buy to 5,000",\n  "approvals": "Safe threshold",\n  "liveAt": "+1 day"\n}',
  },
  {
    title: "Apps and wallets",
    body: "Offer your users a safe mode without building one. Check a wallet's limits from your contract, or show them before your user signs.",
    f: ["SDK on npm (@fengce/sdk)", "isBound from any contract", "Roadmap: native wallet integrations"],
    go: href("fengce", { tab: "devs" }),
    card: { h1: "ISBOUND", h2: "0x0BB9…0707", tag: "TRUE", k0: "Rule", big: "pinned", a1: "Notice", b1: "1 day", a2: "Guard", b2: "FengceGuard", rows: [["DEX", "check", "TRUE", true], ["Lender", "check", "TRUE", true], ["Agent platform", "check", "TRUE", true]] as [string, string, string, boolean][] },
    apiTitle: "solidity",
    api: 'require(\n  binding.isBound(user, POLICY, 1 days),\n  "wallet not bound"\n);',
  },
];

function WhoItHelps() {
  const [idx, setIdx] = useState(0);
  const [api, setApi] = useState(false);
  const u = USES[idx];
  return (
    <section style={{ borderTop: "1px solid var(--line)" }}>
      <div className="who" style={{ maxWidth: 1340, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <div style={{ padding: "64px 40px", borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column" }}>
          <h2 className="disp" style={{ fontSize: 42, marginBottom: 14 }}>Who it helps</h2>
          <p className="body" style={{ marginBottom: 22 }}>
            {PRODUCT_NAME} puts your limits inside your smart wallet. Every transaction is checked against them before money moves, whichever app or agent sends it.
          </p>
          {USES.map((x, i) => (
            <div key={x.title} style={{ borderTop: "1px solid var(--line)", padding: "16px 0" }}>
              <button type="button" onClick={() => setIdx(i)} aria-expanded={i === idx} style={{ background: "none", border: 0, padding: 0, textAlign: "left", width: "100%", fontFamily: "var(--fd)", fontSize: 23, letterSpacing: "-0.01em", color: i === idx ? "var(--text)" : "var(--muted)" }}>
                {x.title}
              </button>
              {i === idx && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 10 }}>
                  <p className="body">{x.body}</p>
                  {x.f.map((f) => (
                    <span key={f} style={{ fontSize: 15.5, display: "flex", gap: 8, alignItems: "center" }}>
                      <span className="chk">✓</span>
                      {f}
                    </span>
                  ))}
                  <a className="pill line" href={x.go} style={{ alignSelf: "flex-start", marginTop: 6 }}>Learn more</a>
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ padding: "48px 32px", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 560 }}>
          <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
            {!api ? (
              <div className="card" style={{ width: "100%", padding: 16, display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 30px 60px -25px rgba(0,0,0,.6)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div className="mono" style={{ fontSize: 13, lineHeight: 1.4 }}>
                    <div>{u.card.h1}</div>
                    <div className="muted">{u.card.h2}</div>
                  </div>
                  <span className="mono allow" style={{ fontSize: 12.5, textAlign: "right" }}>{u.card.tag}</span>
                </div>
                <span className="small">{u.card.k0}</span>
                <span className="num" style={{ fontSize: 34, textAlign: "right" }}>{u.card.big}</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: "1px solid var(--line)" }}>
                  <div style={{ padding: "10px 0", display: "flex", justifyContent: "space-between", fontSize: 14, borderBottom: "1px solid var(--line)" }}><span className="muted">{u.card.a1}</span><span className="mono">{u.card.b1}</span></div>
                  <div style={{ padding: "10px 0 10px 10px", display: "flex", justifyContent: "space-between", fontSize: 14, borderBottom: "1px solid var(--line)" }}><span className="muted">{u.card.a2}</span><span className="mono">{u.card.b2}</span></div>
                </div>
                <span className="small">Example activity</span>
                {u.card.rows.map(([a, b, c, ok], i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                    <span>{a} <span className="muted">{b}</span></span>
                    <span className="mono" style={{ color: ok ? (c.startsWith("+") || c === "ALLOWED" || c === "TRUE" ? "var(--allow)" : "var(--text)") : "var(--deny)" }}>{c}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ width: "100%" }}>
                <CodeCard title={u.apiTitle} code={u.api} />
              </div>
            )}
            <button type="button" onClick={() => setApi(!api)} aria-label="Switch between UI and API view" style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--surface)" }}>
              <span className="mono" style={{ fontSize: 11.5, letterSpacing: ".08em" }}>UI</span>
              <span style={{ width: 28, height: 14, borderRadius: 999, background: "var(--raised)", border: "1px solid var(--line)", position: "relative", display: "inline-block" }}>
                <span style={{ position: "absolute", top: 1, left: api ? 15 : 1, width: 10, height: 10, borderRadius: 999, background: "var(--accent)", transition: "left .2s" }} />
              </span>
              <span className="mono" style={{ fontSize: 11.5, letterSpacing: ".08em" }}>API</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ what you can set: scatter to grid
const CARDS: [string, string, string, string, boolean][] = [
  ["01 · Max per buy", "50 USDT0", "No single buy over your number", href("limits"), false],
  ["02 · Quiet hours", "01–06", "No trades in the hours you pick · soon", href("limits"), true],
  ["03 · Trades per hour", "5", "Slows a losing streak", href("limits"), false],
  ["04 · Hold lock", "30 days", "A token can't leave early · soon", href("limits"), true],
  ["05 · Tilt shield", "Armed", "Sells-only after 4 buys in 30 min · soon", href("tilt"), true],
  ["06 · Agent cap", "100 / day", "Your bot can't overspend · soon", href("fengce", { tab: "agents" }), false],
  ["07 · Partner", "Optional", "Someone you trust co-approves · soon", href("wallet"), true],
  ["08 · Pinned", NEEDLE, "The exact circuit, locked to your wallet", href("fengce", { tab: "judges" }), false],
];
const SCAT: [number, number, number][] = [[1, 6, -9], [76, 3, 7], [5, 63, 6], [79, 60, -6], [27, 76, -4], [52, 72, 8], [-3, 33, -12], [83, 31, 10]];

function Scatter() {
  const ref = useRef<HTMLElement>(null);
  const p = useScrollProgress(ref);
  let e = Math.max(0, Math.min(1, (p - 0.12) / 0.6));
  e = e < 0.5 ? 2 * e * e : 1 - (-2 * e + 2) ** 2 / 2;
  if (still()) e = 1;
  const lerp = (a: number, b: number) => a + (b - a) * e;
  return (
    <section ref={ref} className="scatter" style={{ borderTop: "1px solid var(--line)", height: "260vh", position: "relative" }}>
      <div style={{ position: "sticky", top: "var(--headH)", height: "calc(100vh - var(--headH))", overflow: "hidden" }}>
        <div style={{ position: "relative", maxWidth: 1240, height: "100%", margin: "0 auto" }}>
          <div style={{ position: "absolute", left: "50%", width: 640, maxWidth: "90%", transform: "translateX(-50%)", top: `${lerp(38, 6)}%`, textAlign: "center", display: "flex", flexDirection: "column", gap: 14, alignItems: "center", zIndex: e < 0.5 ? 2 : 0 }}>
            <h2 className="disp" style={{ fontSize: 46 }}>What you can set</h2>
            <p className="body">Pick a limit, set your number, sign once. Your wallet keeps it across supported apps.</p>
          </div>
          {CARDS.map(([tag, val, desc, go, cream], i) => {
            const col = i % 4, row = Math.floor(i / 4);
            const [sx, sy, sr] = SCAT[i];
            return (
              <a
                key={tag}
                href={go}
                className="gcard"
                style={{ position: "absolute", left: `${lerp(sx, col * 25.6).toFixed(2)}%`, top: `${lerp(sy, 36 + row * 31).toFixed(2)}%`, width: "23.4%", height: "27%", transform: `rotate(${lerp(sr, 0).toFixed(2)}deg) scale(${lerp(0.9, 1).toFixed(3)})`, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 8, padding: "18px 20px", borderRadius: 12, boxShadow: "0 18px 40px -18px rgba(0,0,0,.55)", border: `1px solid ${cream ? "transparent" : "var(--line)"}`, background: cream ? "var(--cream)" : "var(--surface)", color: cream ? "#141414" : "var(--text)" }}
              >
                <span className="lbl" style={cream ? { color: "rgba(20,20,20,.55)" } : undefined}>{tag}</span>
                <span className="num" style={{ fontSize: 32 }}>{val}</span>
                <span style={{ fontSize: 14.5, lineHeight: 1.4, color: cream ? "rgba(20,20,20,.62)" : "var(--muted)" }}>{desc}</span>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ powered by Fengce
function Stack() {
  const plates = [
    { label: "You · apps · agents", sub: "send the transaction", style: "dash" },
    { label: PRODUCT_NAME, sub: "your limits", style: "raised" },
    { label: "Fengce", sub: "pin · check · timelock", style: "accent" },
    { label: "TapeOut", sub: "circuits", style: "plain" },
    { label: "X Layer", sub: "chain 196", style: "plain" },
  ];
  const plate = (y: number) => `M140 ${y} L250 ${y + 32} L140 ${y + 64} L30 ${y + 32} Z`;
  return (
    <div className="stack" style={{ position: "relative", width: 440, height: 360, marginTop: 18 }}>
      <svg viewBox="0 0 280 360" width="280" height="360" style={{ position: "absolute", left: 0, top: 0 }} aria-hidden="true">
        <defs>
          <pattern id="pbh" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--accent)" strokeWidth="1" opacity=".55" />
          </pattern>
        </defs>
        {[...plates].reverse().map((pl, ri) => {
          const i = plates.length - 1 - ri;
          const y = 8 + i * 66;
          return (
            <g key={pl.label}>
              <path
                d={plate(y)}
                fill={pl.style === "accent" ? "url(#pbh)" : pl.style === "raised" ? "var(--raised)" : pl.style === "dash" ? "transparent" : "var(--panel)"}
                stroke={pl.style === "accent" ? "var(--accent)" : "var(--muted)"}
                strokeWidth="1"
                strokeDasharray={pl.style === "dash" ? "4 4" : undefined}
              />
              {pl.style === "dash" && [100, 140, 180].map((x, k) => <circle key={x} cx={x} cy={y + 32} r="4" fill={k === 1 ? "var(--accent)" : "var(--muted)"} />)}
            </g>
          );
        })}
      </svg>
      {plates.map((pl, i) => (
        <div key={pl.label} className="stack-lab" style={{ position: "absolute", left: 264, top: 8 + i * 66 + 32 - 20, height: 40, display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, whiteSpace: "nowrap" }}>
          <span style={{ fontSize: 16, lineHeight: 1.2, color: pl.style === "accent" ? "var(--accent)" : "var(--text)" }}>{pl.label}</span>
          <span className="small" style={{ lineHeight: 1.2 }}>{pl.sub}</span>
        </div>
      ))}
    </div>
  );
}

function Powered() {
  const cells = [
    ["01", "Your wallet, or your agent's", "Installs on the Safe you or your AI agent already use. No new wallet, no moving funds."],
    ["02", "Rules are circuits", "Each limit is a TapeOut circuit on X Layer that anyone can re-run and check."],
    ["03", "Pinned so it can't be swapped", "The exact circuit and everything it depends on are fingerprinted. If any of it changes, the check fails safe."],
    ["04", "Changes wait in public", "A change to your limits waits 1 day, posted on chain. Removing the guard waits 2 days."],
  ];
  return (
    <section style={{ borderTop: "1px solid var(--line)" }}>
      <div className="w powered-grid" style={{ paddingTop: 72, paddingBottom: 72, display: "grid", gridTemplateColumns: "minmax(440px, 1fr) minmax(0, 1.6fr)", gap: 56, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 className="disp" style={{ fontSize: 46 }}>
            Powered by <em>Fengce</em>
          </h2>
          <p className="body">A limit only helps if it's still the same rule tomorrow. Fengce is the engine that makes sure it is.</p>
          <a className="alink" href={href("fengce")} style={{ alignSelf: "flex-start" }}>How Fengce works</a>
          <Stack />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", borderTop: "1px solid var(--line)" }}>
          {cells.map(([n, t, d], i) => (
            <div key={n} style={{ padding: i % 2 ? "20px 0 20px 20px" : "20px 20px 20px 0", borderBottom: i < 2 ? "1px solid var(--line)" : undefined, borderLeft: i % 2 ? "1px solid var(--line)" : undefined, display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="lbl">{n}</span>
              <span style={{ fontSize: 18 }}>{t}</span>
              <span className="small">{d}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Home() {
  return (
    <main className="pg">
      <div style={{ minHeight: "calc(100vh - var(--headH))", display: "flex", flexDirection: "column" }}>
        <section className="w" style={{ flex: "1 1 auto", paddingTop: 48, paddingBottom: 36, display: "flex", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 560 }}>
            <h1 className="disp" style={{ fontSize: 52 }}>
              Limits your wallet keeps,
              <br />
              <em>even on you</em>
            </h1>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p className="body" style={{ color: "var(--text)" }}>Set buy caps, quiet hours and hold locks inside your smart wallet.</p>
              <p className="body">Each limit is a TapeOut circuit on X Layer. It follows your wallet across supported apps and transaction paths.</p>
            </div>
            <div>
              <a className="pill accent big" href={href("start")}>Set my limits</a>
            </div>
          </div>
        </section>
        <Grooves />
        <section className="w strip">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", borderBottom: "1px solid var(--line)" }}>
            <div className="mono" style={{ padding: "16px 8px", fontSize: 13.5, textAlign: "center", borderRight: "1px solid var(--line)" }}>Safe</div>
            <div className="lbl" style={{ padding: "16px 8px", textAlign: "center", color: "var(--text)" }}>{PRODUCT_NAME} installs on Safe · Fengce also enforces on</div>
            <div className="mono" style={{ padding: "16px 8px", fontSize: 13.5, textAlign: "center", borderLeft: "1px solid var(--line)" }}>Kernel</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <div className="mono muted" style={{ padding: "16px 8px", fontSize: 13.5, textAlign: "center", borderRight: "1px solid var(--line)" }}>Alchemy MA v2</div>
            <div className="mono muted" style={{ padding: "16px 8px", fontSize: 13.5, textAlign: "center" }}>Safe7579 · Nexus · Etherspot</div>
            <div className="mono muted" style={{ padding: "16px 8px", fontSize: 13.5, textAlign: "center", borderLeft: "1px solid var(--line)" }}>Coinbase Smart Wallet (agents)</div>
          </div>
        </section>
      </div>
      <Steps />
      <WhoItHelps />
      <Scatter />
      <Powered />
      <section style={{ borderTop: "1px solid var(--line)" }}>
        <div className="w" style={{ paddingTop: 110, paddingBottom: 110, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 22 }}>
          <h2 className="disp" style={{ fontSize: 40, maxWidth: 520 }}>Set your limits in one signature.</h2>
          <a className="pill accent big" href={href("start")}>Get started</a>
        </div>
      </section>
      <style>{`
        .sheen { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(100deg, transparent 0%, rgba(255,255,255,.05) 45%, rgba(255,255,255,.09) 50%, rgba(255,255,255,.05) 55%, transparent 100%); width: 40%; animation: sheen 9s ease-in-out infinite; }
        @keyframes sheen { 0% { transform: translateX(-60%); } 100% { transform: translateX(260%); } }
        .gcard { transition: left .18s linear, top .18s linear, transform .18s linear; }
        @media (max-width: 900px) {
          .steps-sec { height: auto !important; }
          .steps-in { position: static !important; height: auto !important; grid-template-columns: minmax(0, 1fr) !important; }
          .steps-in > div:first-child { padding: 40px 16px !important; border-right: 0 !important; }
          .who { grid-template-columns: minmax(0, 1fr) !important; }
          .who > div:first-child { padding: 48px 16px !important; border-right: 0 !important; }
          .scatter { height: auto !important; }
          .scatter > div { position: static !important; height: auto !important; overflow: visible !important; }
          .scatter > div > div { height: auto !important; display: flex; flex-direction: column; gap: 12px; padding: 48px 16px; }
          .scatter > div > div > div { position: static !important; transform: none !important; max-width: 100% !important; width: 100% !important; }
          .scatter .gcard { position: static !important; width: 100% !important; height: auto !important; min-height: 140px; transform: none !important; }
          .powered-grid { grid-template-columns: minmax(0, 1fr) !important; }
          .stack { zoom: .78; }
          .strip > div { grid-template-columns: minmax(0, 1fr) !important; }
          .strip > div > div { border: 0 !important; }
        }
      `}</style>
    </main>
  );
}

mount("", 0, <Home />, { home: true });
